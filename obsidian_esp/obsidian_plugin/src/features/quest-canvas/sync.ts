import { type App, Modal, Notice, Plugin, Setting, TFile } from 'obsidian';
import { refreshCardFromNote } from './actions';
import { getCardMeta } from './card-meta';
import {
	applySyncPlanToCanvas,
	type CanvasData,
	deriveQuestContext,
	describeEdgeGesture,
	diffCanvasEdgeGestures,
	diffCanvasTextEdits,
	type EdgeGestureEdit,
	hashCanvasContent,
	parseCanvasData,
	planEdgeGestures,
	planSyncFromEdits,
	type SyncPlan,
} from './sync-core';

const SYNC_DEBOUNCE_MS = 500;

/**
 * Watches open quest canvases and translates card edits into note edits
 * (canvas_editing_internals.md, "Sync engine"). The heavy lifting is in sync-core.ts; this
 * class owns the vault wiring: snapshots, debounce, loop guards, and writes.
 */
export class QuestCanvasSyncEngine {
	private readonly snapshots = new Map<string, CanvasData>();
	private readonly lastWrittenHash = new Map<string, string>();
	private readonly applying = new Set<string>();
	private readonly rerunRequested = new Set<string>();
	private readonly debounceTimers = new Map<string, number>();

	constructor(private readonly plugin: Plugin) {}

	register(): void {
		const { app } = this.plugin;
		this.plugin.registerEvent(
			app.vault.on('modify', (file) => {
				if (!(file instanceof TFile)) {
					return;
				}
				if (file.extension === 'canvas') {
					this.scheduleSync(file);
				} else if (file.extension === 'md') {
					this.scheduleNoteRefresh(file);
				}
			}),
		);
		this.plugin.registerEvent(
			app.workspace.on('file-open', (file) => {
				if (file instanceof TFile && file.extension === 'canvas') {
					void this.seedSnapshot(file);
				}
			}),
		);
		this.plugin.registerEvent(
			app.vault.on('rename', (file, oldPath) => {
				this.snapshots.delete(oldPath);
				this.lastWrittenHash.delete(oldPath);
				if (file instanceof TFile && file.extension === 'canvas') {
					void this.seedSnapshot(file);
				}
			}),
		);
		this.plugin.registerEvent(
			app.vault.on('delete', (file) => {
				this.snapshots.delete(file.path);
				this.lastWrittenHash.delete(file.path);
			}),
		);

		app.workspace.onLayoutReady(() => {
			for (const leaf of app.workspace.getLeavesOfType('canvas')) {
				const state: unknown = leaf.getViewState().state?.file;
				if (typeof state === 'string') {
					const file = app.vault.getAbstractFileByPath(state);
					if (file instanceof TFile) {
						void this.seedSnapshot(file);
					}
				}
			}
		});
	}

	/** Reads a canvas and stores it as the diff baseline (no sync pass). */
	private async seedSnapshot(file: TFile): Promise<void> {
		if (this.snapshots.has(file.path)) {
			return;
		}

		const parsed = parseCanvasData(await this.plugin.app.vault.read(file));
		if (parsed && this.isQuestCanvas(parsed)) {
			this.snapshots.set(file.path, parsed);
		}
	}

	private isQuestCanvas(canvas: CanvasData): boolean {
		return canvas.nodes.some((node) => getCardMeta(node) !== null);
	}

	private scheduleSync(file: TFile): void {
		const existing = this.debounceTimers.get(file.path);
		if (existing !== undefined) {
			window.clearTimeout(existing);
		}
		this.debounceTimers.set(
			file.path,
			window.setTimeout(() => {
				this.debounceTimers.delete(file.path);
				void this.runSync(file);
			}, SYNC_DEBOUNCE_MS),
		);
	}

	private async runSync(file: TFile): Promise<void> {
		if (this.applying.has(file.path)) {
			this.rerunRequested.add(file.path);
			return;
		}

		const { app } = this.plugin;
		const content = await app.vault.read(file);
		const contentHash = hashCanvasContent(content);
		const parsed = parseCanvasData(content);
		if (!parsed || !this.isQuestCanvas(parsed)) {
			return;
		}

		// Loop guard: ignore the modify event caused by our own write.
		if (contentHash === this.lastWrittenHash.get(file.path)) {
			this.snapshots.set(file.path, parsed);
			return;
		}

		const snapshot = this.snapshots.get(file.path);
		if (!snapshot) {
			this.snapshots.set(file.path, parsed);
			return;
		}

		const noteContents = await this.readReferencedNotes(parsed);
		const readNote = (path: string): string | null => noteContents.get(path) ?? null;
		const context = deriveQuestContext(parsed, readNote);

		const edits = diffCanvasTextEdits(snapshot, parsed);
		const edgeEdits = diffCanvasEdgeGestures(snapshot, parsed, context);
		const additions = edgeEdits.filter((edit) => edit.kind === 'add');
		const removals = edgeEdits.filter((edit) => edit.kind === 'remove');
		if (edits.length === 0 && additions.length === 0 && removals.length === 0) {
			this.snapshots.set(file.path, parsed);
			return;
		}

		this.applying.add(file.path);
		try {
			const textPlan = planSyncFromEdits(edits, readNote, context);
			const readAfterText = (path: string): string | null => textPlan.noteUpdates.get(path) ?? readNote(path);
			const edgePlan = planEdgeGestures(additions, readAfterText, context, parsed);
			const plan: SyncPlan = {
				noteUpdates: new Map([...textPlan.noteUpdates, ...edgePlan.noteUpdates]),
				cardUpdates: new Map([...textPlan.cardUpdates, ...edgePlan.cardUpdates]),
				failures: [...textPlan.failures, ...edgePlan.failures],
			};

			for (const [path, nextContent] of plan.noteUpdates) {
				const noteFile = app.vault.getAbstractFileByPath(path);
				if (noteFile instanceof TFile) {
					await app.vault.process(noteFile, () => nextContent);
				}
			}

			for (const failure of plan.failures) {
				new Notice(`Quest canvas: ${failure.message}`, 8000);
			}

			if (applySyncPlanToCanvas(parsed, plan)) {
				const nextJson = JSON.stringify(parsed, null, '\t');
				this.lastWrittenHash.set(file.path, hashCanvasContent(nextJson));
				await app.vault.process(file, () => nextJson);
			}

			this.snapshots.set(file.path, parsed);
		} finally {
			this.applying.delete(file.path);
		}

		// Deleting an edge deletes note data, so it is gated behind an
		// explicit confirmation naming the exact frontmatter change. On
		// cancel the data stays; a refresh restores the edge.
		if (removals.length > 0) {
			this.confirmEdgeRemovals(file, removals);
		}

		if (this.rerunRequested.delete(file.path)) {
			this.scheduleSync(file);
		}
	}

	private confirmEdgeRemovals(file: TFile, removals: EdgeGestureEdit[]): void {
		const descriptions = removals.map((edit) => describeEdgeGesture(edit));
		new ConfirmEdgeRemovalModal(this.plugin.app, descriptions, () => {
			void this.applyEdgeRemovals(file, removals);
		}).open();
	}

	private async applyEdgeRemovals(file: TFile, removals: EdgeGestureEdit[]): Promise<void> {
		const { app } = this.plugin;
		const content = await app.vault.read(file);
		const parsed = parseCanvasData(content);
		if (!parsed) {
			return;
		}

		this.applying.add(file.path);
		try {
			const noteContents = await this.readReferencedNotes(parsed);
			const readNote = (path: string): string | null => noteContents.get(path) ?? null;
			const context = deriveQuestContext(parsed, readNote);
			const plan = planEdgeGestures(removals, readNote, context, parsed);

			for (const [path, nextContent] of plan.noteUpdates) {
				const noteFile = app.vault.getAbstractFileByPath(path);
				if (noteFile instanceof TFile) {
					await app.vault.process(noteFile, () => nextContent);
				}
			}
			for (const failure of plan.failures) {
				new Notice(`Quest canvas: ${failure.message}`, 8000);
			}
			if (applySyncPlanToCanvas(parsed, plan)) {
				const nextJson = JSON.stringify(parsed, null, '\t');
				this.lastWrittenHash.set(file.path, hashCanvasContent(nextJson));
				await app.vault.process(file, () => nextJson);
			}
			this.snapshots.set(file.path, parsed);
		} finally {
			this.applying.delete(file.path);
		}
	}

	/**
	 * Note-side live refresh: external edits to a dialogue note re-render
	 * its cards on every tracked quest canvas. Notes win by definition, so
	 * this needs no diffing — just a projection refresh.
	 */
	private scheduleNoteRefresh(file: TFile): void {
		const referencesNote = [...this.snapshots.values()].some((canvas) => (
			canvas.nodes.some((node) => getCardMeta(node)?.file === file.path)
		));
		if (!referencesNote) {
			return;
		}

		const timerKey = `note:${file.path}`;
		const existing = this.debounceTimers.get(timerKey);
		if (existing !== undefined) {
			window.clearTimeout(existing);
		}
		this.debounceTimers.set(
			timerKey,
			window.setTimeout(() => {
				this.debounceTimers.delete(timerKey);
				void this.runNoteRefresh(file.path);
			}, SYNC_DEBOUNCE_MS),
		);
	}

	private async runNoteRefresh(notePath: string): Promise<void> {
		const { app } = this.plugin;
		for (const canvasPath of [...this.snapshots.keys()]) {
			const snapshot = this.snapshots.get(canvasPath);
			if (!snapshot || !snapshot.nodes.some((node) => getCardMeta(node)?.file === notePath)) {
				continue;
			}
			const canvasFile = app.vault.getAbstractFileByPath(canvasPath);
			if (!(canvasFile instanceof TFile) || this.applying.has(canvasPath)) {
				continue;
			}

			this.applying.add(canvasPath);
			try {
				const parsed = parseCanvasData(await app.vault.read(canvasFile));
				if (!parsed) {
					continue;
				}
				const noteContents = await this.readReferencedNotes(parsed);
				const readNote = (path: string): string | null => noteContents.get(path) ?? null;
				const context = deriveQuestContext(parsed, readNote);

				let changed = false;
				for (const node of parsed.nodes) {
					if (getCardMeta(node)?.file === notePath) {
						changed = refreshCardFromNote(parsed, node.id, readNote, context) || changed;
					}
				}
				if (changed) {
					const nextJson = JSON.stringify(parsed, null, '\t');
					this.lastWrittenHash.set(canvasPath, hashCanvasContent(nextJson));
					await app.vault.process(canvasFile, () => nextJson);
				}
				this.snapshots.set(canvasPath, parsed);
			} finally {
				this.applying.delete(canvasPath);
			}
		}
	}

	/** Preloads every note the canvas references (cards and journal nodes). */
	private async readReferencedNotes(canvas: CanvasData): Promise<Map<string, string>> {
		const paths = new Set<string>();
		for (const node of canvas.nodes) {
			const meta = getCardMeta(node);
			if (meta?.file) {
				paths.add(meta.file);
			}
		}

		const contents = new Map<string, string>();
		for (const path of paths) {
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				contents.set(path, await this.plugin.app.vault.read(file));
			}
		}
		return contents;
	}
}

/** Confirmation dialog naming the exact frontmatter changes an edge deletion performs. */
class ConfirmEdgeRemovalModal extends Modal {
	constructor(
		app: App,
		private readonly descriptions: string[],
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText('Remove dialogue data?');
		this.contentEl.createEl('p', {
			text: 'Deleting these edges removes the following from the notes:',
		});
		const list = this.contentEl.createEl('ul');
		for (const description of this.descriptions) {
			list.createEl('li', { text: description });
		}
		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText('Cancel').onClick(() => {
					this.close();
				});
			})
			.addButton((button) => {
				button.setButtonText('Remove').setWarning().onClick(() => {
					this.close();
					this.onConfirm();
				});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

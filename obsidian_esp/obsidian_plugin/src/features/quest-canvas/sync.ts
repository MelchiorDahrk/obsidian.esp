import { Notice, Plugin, TFile } from 'obsidian';
import { getCardMeta } from './card-meta';
import {
	applySyncPlanToCanvas,
	type CanvasData,
	deriveQuestContext,
	diffCanvasTextEdits,
	hashCanvasContent,
	parseCanvasData,
	planSyncFromEdits,
} from './sync-core';

const SYNC_DEBOUNCE_MS = 500;

/**
 * Watches open quest canvases and translates card edits into note edits
 * (canvas_editing_plan.md §5). The heavy lifting is in sync-core.ts; this
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
				if (file instanceof TFile && file.extension === 'canvas') {
					this.scheduleSync(file);
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

		const edits = diffCanvasTextEdits(snapshot, parsed);
		if (edits.length === 0) {
			this.snapshots.set(file.path, parsed);
			return;
		}

		this.applying.add(file.path);
		try {
			const noteContents = await this.readReferencedNotes(parsed);
			const readNote = (path: string): string | null => noteContents.get(path) ?? null;
			const context = deriveQuestContext(parsed, readNote);
			const plan = planSyncFromEdits(edits, readNote, context);

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

		if (this.rerunRequested.delete(file.path)) {
			this.scheduleSync(file);
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

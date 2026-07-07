/**
 * @file Quest inspector side panel and the UI for generative node actions.
 *
 * Registers a workspace view that, for the selected canvas card, shows the
 * backing note and offers the action planners from actions.ts (add choice
 * branch, add speaker variant, link journal milestone, renumber choice).
 * This module is the Obsidian glue — modals, menus, and vault writes — around
 * those pure planners.
 */
import {
	type App,
	type EventRef,
	FuzzySuggestModal,
	ItemView,
	type Menu,
	Modal,
	Notice,
	Plugin,
	Setting,
	TFile,
	TFolder,
	type WorkspaceLeaf,
} from 'obsidian';
import {
	type ActionResult,
	type ActionPlan,
	applyActionPlanToCanvas,
	planAddChoiceBranch,
	planAddSpeakerVariant,
	planLinkJournalMilestone,
	planRenumberChoice,
	refreshCardFromNote,
} from './actions';
import { getCardMeta } from './card-meta';
import {
	FILTER_KINDS,
	type GateLine,
	parseGateLine,
	parseResultCardText,
	SPEAKER_FIELDS,
} from './cards';
import { applyGateLines } from './frontmatter-surgeon';
import { type CanvasNode, type EspCardMeta, type MilestoneLink } from './model';
import {
	applyResultCardLines,
	type CanvasData,
	deriveQuestContext,
	editableCardText,
	parseCanvasData,
	type QuestSyncContext,
	renameChoiceInResult,
} from './sync-core';

export const QUEST_INSPECTOR_VIEW_TYPE = 'esp-quest-inspector';

// The canvas workspace events and node objects below exist at runtime but
// are absent from obsidian.d.ts; type them locally at the call site (a
// module augmentation of Workspace.on would perturb overload resolution for
// every other event) and access every member defensively
// (canvas_editing_internals.md, "Inspector and node actions").
interface CanvasViewNode {
	getData?: () => CanvasNode | undefined;
	canvas?: { view?: { file?: TFile | null } };
}

interface CanvasWorkspaceEvents {
	on(name: 'canvas:node-menu', callback: (menu: Menu, node: CanvasViewNode) => void): EventRef;
}

interface InspectedCard {
	canvasPath: string;
	nodeId: string;
	meta: EspCardMeta;
}

/**
 * Right-sidebar structured editor for the selected quest-canvas card, plus
 * the canvas context-menu wiring that feeds it. Edits reuse the same
 * grammar and surgeon paths as the sync engine, and only the canvas file is
 * touched — never canvas view internals.
 */
export class QuestInspectorView extends ItemView {
	private card: InspectedCard | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return QUEST_INSPECTOR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Quest inspector';
	}

	getIcon(): string {
		return 'list-tree';
	}

	async inspect(card: InspectedCard): Promise<void> {
		this.card = card;
		await this.render();
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	private async render(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('esp-quest-inspector');

		const card = this.card;
		if (!card) {
			container.createEl('p', { text: 'Select a quest card and use its context menu to edit it here.' });
			return;
		}

		const { meta } = card;
		container.createEl('h4', { text: `${(meta.role[0] ?? '').toUpperCase()}${meta.role.slice(1)} card` });
		if (meta.file) {
			const link = container.createEl('a', { text: meta.file, cls: 'esp-inspector-file' });
			link.addEventListener('click', () => {
				void this.app.workspace.openLinkText(meta.file ?? '', '', false);
			});
		}

		const cardText = editableCardText((await this.currentCardText()) ?? '');
		switch (meta.role) {
			case 'gate':
				this.renderGateEditor(container, card, cardText);
				break;
			case 'result':
				this.renderResultEditor(container, card, cardText);
				break;
			case 'choice':
				this.renderChoiceEditor(container, card, cardText);
				break;
			default:
				container.createEl('p', { text: 'This card type has no structured editor; edit the note directly.' });
				break;
		}
	}

	// --- gate editor -------------------------------------------------------

	private renderGateEditor(container: HTMLElement, card: InspectedCard, cardText: string): void {
		const rows = cardText
			.split('\n')
			.filter((line) => line.trim().length > 0)
			.map((line) => gateLineToRow(line));

		const listEl = container.createDiv({ cls: 'esp-inspector-rows' });
		const renderRows = (): void => {
			listEl.empty();
			rows.forEach((row, index) => {
				const setting = new Setting(listEl);
				setting.addDropdown((dropdown) => {
					dropdown.addOption('expression', 'Expression');
					dropdown.addOption('Choice', 'Choice');
					for (const field of SPEAKER_FIELDS) {
						dropdown.addOption(`speaker:${field}`, field);
					}
					for (const kind of FILTER_KINDS) {
						if (kind !== 'Function') {
							dropdown.addOption(`filter:${kind}`, kind);
						}
					}
					dropdown.setValue(row.kind).onChange((value) => {
						row.kind = value;
					});
				});
				setting.addText((text) => {
					text.setValue(row.expression).onChange((value) => {
						row.expression = value;
					});
					text.inputEl.addClass('esp-inspector-expression');
				});
				setting.addExtraButton((button) => {
					button.setIcon('trash').setTooltip('Remove condition').onClick(() => {
						rows.splice(index, 1);
						renderRows();
					});
				});
			});
		};
		renderRows();

		new Setting(container)
			.addButton((button) => {
				button.setButtonText('Add condition').onClick(() => {
					rows.push({ kind: 'expression', expression: '' });
					renderRows();
				});
			})
			.addButton((button) => {
				button.setButtonText('Apply').setCta().onClick(() => {
					void this.applyGateRows(card, rows);
				});
			});
	}

	private async applyGateRows(card: InspectedCard, rows: Array<{ kind: string; expression: string }>): Promise<void> {
		const gateLines: GateLine[] = [];
		for (const row of rows) {
			const line = rowToGateText(row);
			if (line.trim().length === 0) {
				continue;
			}
			const parsed = parseGateLine(line);
			if ('error' in parsed) {
				new Notice(`Quest inspector: ${parsed.error}`, 8000);
				return;
			}
			gateLines.push(parsed);
		}

		const file = card.meta.file ? this.app.vault.getAbstractFileByPath(card.meta.file) : null;
		if (!(file instanceof TFile)) {
			return;
		}
		await this.app.vault.process(file, (content) => applyGateLines(content, gateLines));
		await refreshCanvasCard(this.app, card);
		await this.render();
		new Notice('Conditions updated.');
	}

	// --- result editor -----------------------------------------------------

	private renderResultEditor(container: HTMLElement, card: InspectedCard, cardText: string): void {
		const rows = cardText
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);

		const listEl = container.createDiv({ cls: 'esp-inspector-rows' });
		const renderRows = (): void => {
			listEl.empty();
			rows.forEach((row, index) => {
				const setting = new Setting(listEl);
				setting.addText((text) => {
					text.setValue(row).onChange((value) => {
						rows[index] = value;
					});
					text.inputEl.addClass('esp-inspector-expression');
				});
				setting.addExtraButton((button) => {
					button.setIcon('arrow-up').setTooltip('Move up').setDisabled(index === 0).onClick(() => {
						const [line] = rows.splice(index, 1);
						rows.splice(index - 1, 0, line ?? '');
						renderRows();
					});
				});
				setting.addExtraButton((button) => {
					button.setIcon('arrow-down').setTooltip('Move down').setDisabled(index === rows.length - 1).onClick(() => {
						const [line] = rows.splice(index, 1);
						rows.splice(index + 1, 0, line ?? '');
						renderRows();
					});
				});
				setting.addExtraButton((button) => {
					button.setIcon('trash').setTooltip('Remove action').onClick(() => {
						rows.splice(index, 1);
						renderRows();
					});
				});
			});
		};
		renderRows();

		new Setting(container)
			.addButton((button) => {
				button.setButtonText('Add action').onClick(() => {
					rows.push('');
					renderRows();
				});
			})
			.addButton((button) => {
				button.setButtonText('Apply').setCta().onClick(() => {
					void this.applyResultRows(card, rows);
				});
			});
	}

	private async applyResultRows(card: InspectedCard, rows: string[]): Promise<void> {
		const file = card.meta.file ? this.app.vault.getAbstractFileByPath(card.meta.file) : null;
		if (!(file instanceof TFile)) {
			return;
		}
		const lines = parseResultCardText(rows.filter((row) => row.trim().length > 0).join('\n'));
		await this.app.vault.process(file, (content) => applyResultCardLines(content, lines));
		await refreshCanvasCard(this.app, card);
		await this.render();
		new Notice('Result updated.');
	}

	// --- choice editor -----------------------------------------------------

	private renderChoiceEditor(container: HTMLElement, card: InspectedCard, cardText: string): void {
		if (card.meta.choiceValue === undefined) {
			return;
		}
		let prompt = cardText.trim();
		let value = card.meta.choiceValue;

		new Setting(container)
			.setName('Prompt')
			.addText((text) => {
				text.setValue(prompt).onChange((next) => {
					prompt = next;
				});
				text.inputEl.addClass('esp-inspector-expression');
			});
		new Setting(container)
			.setName('Choice value')
			.setDesc('Renumbering rewrites the parent choice line and every matching choice filter on this topic.')
			.addText((text) => {
				text.setValue(String(value)).onChange((next) => {
					value = Number.parseInt(next, 10);
				});
			});
		new Setting(container).addButton((button) => {
			button.setButtonText('Apply').setCta().onClick(() => {
				void this.applyChoiceEdit(card, prompt, value);
			});
		});
	}

	private async applyChoiceEdit(card: InspectedCard, prompt: string, newValue: number): Promise<void> {
		const oldValue = card.meta.choiceValue;
		const parentPath = card.meta.file;
		if (oldValue === undefined || !parentPath) {
			return;
		}
		if (prompt.trim().length === 0 || prompt.includes('"')) {
			new Notice('Quest inspector: choice prompts must be non-empty and cannot contain double quotes.', 8000);
			return;
		}
		const parentFile = this.app.vault.getAbstractFileByPath(parentPath);
		if (!(parentFile instanceof TFile)) {
			return;
		}

		await this.app.vault.process(parentFile, (content) => (
			renameChoiceInResult(content, oldValue, prompt.trim()) ?? content
		));

		if (Number.isInteger(newValue) && newValue !== oldValue) {
			const parentContent = await this.app.vault.read(parentFile);
			const topicNotes = await readTopicSiblings(this.app, parentFile);
			await runActionOnCanvas(this.app, card.canvasPath, (canvas, context) => planRenumberChoice({
				parentPath,
				parentContent,
				oldValue,
				newValue,
				topicNotes,
				canvas,
				context,
			}));
			card.meta = { ...card.meta, choiceValue: newValue };
		}

		await refreshCanvasCard(this.app, card);
		await this.render();
		new Notice('Choice updated.');
	}

	// --- shared ---------------------------------------------------------------

	private async currentCardText(): Promise<string | null> {
		const card = this.card;
		if (!card) {
			return null;
		}
		const canvas = await readCanvas(this.app, card.canvasPath);
		const node = canvas?.nodes.find((candidate) => candidate.id === card.nodeId);
		return node?.text ?? null;
	}
}

// --- vault plumbing shared by the view and the context menu -------------------

async function readCanvas(app: App, path: string): Promise<CanvasData | null> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return null;
	}
	return parseCanvasData(await app.vault.read(file));
}

async function readNote(app: App, path: string): Promise<string | null> {
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? app.vault.read(file) : null;
}

async function readTopicSiblings(app: App, noteFile: TFile): Promise<Map<string, string>> {
	const notes = new Map<string, string>();
	const folder = noteFile.parent;
	if (!(folder instanceof TFolder)) {
		return notes;
	}
	for (const child of folder.children) {
		if (child instanceof TFile && child.extension === 'md') {
			notes.set(child.path, await app.vault.read(child));
		}
	}
	return notes;
}

/** Preloads every note the canvas references so core functions can read synchronously. */
async function loadCanvasNotes(app: App, canvas: CanvasData): Promise<Map<string, string>> {
	const notes = new Map<string, string>();
	for (const node of canvas.nodes) {
		const meta = getCardMeta(node);
		if (meta?.file && !notes.has(meta.file)) {
			const content = await readNote(app, meta.file);
			if (content !== null) {
				notes.set(meta.file, content);
			}
		}
	}
	return notes;
}

/** Runs a pure action planner against the canvas and applies its plan through the vault. */
async function runActionOnCanvas(
	app: App,
	canvasPath: string,
	makePlan: (canvas: CanvasData, context: QuestSyncContext) => ActionResult,
): Promise<void> {
	const canvasFile = app.vault.getAbstractFileByPath(canvasPath);
	if (!(canvasFile instanceof TFile)) {
		return;
	}
	const canvas = parseCanvasData(await app.vault.read(canvasFile));
	if (!canvas) {
		return;
	}
	const notes = await loadCanvasNotes(app, canvas);
	const context = deriveQuestContext(canvas, (path) => notes.get(path) ?? null);
	const result = makePlan(canvas, context);
	if ('error' in result) {
		new Notice(`Quest canvas: ${result.error}`, 8000);
		return;
	}
	await applyActionPlan(app, canvasFile, canvas, result);
}

/** Applies an action plan through the vault: notes first, then the canvas. */
async function applyActionPlan(app: App, canvasFile: TFile, canvas: CanvasData, plan: ActionPlan): Promise<void> {
	for (const [path, content] of plan.noteUpdates) {
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await app.vault.process(file, () => content);
		}
	}
	for (const [path, content] of plan.noteCreations) {
		await app.vault.create(path, content);
	}
	if (applyActionPlanToCanvas(canvas, plan)) {
		await app.vault.process(canvasFile, () => JSON.stringify(canvas, null, '\t'));
	}
}

/** Re-renders one card from its note and writes the canvas (context-menu "Refresh card"). */
async function refreshCanvasCard(app: App, card: InspectedCard): Promise<void> {
	const canvasFile = app.vault.getAbstractFileByPath(card.canvasPath);
	if (!(canvasFile instanceof TFile)) {
		return;
	}
	const canvas = parseCanvasData(await app.vault.read(canvasFile));
	if (!canvas) {
		return;
	}
	const notes = await loadCanvasNotes(app, canvas);
	const readCached = (path: string): string | null => notes.get(path) ?? null;
	const context = deriveQuestContext(canvas, readCached);
	if (refreshCardFromNote(canvas, card.nodeId, readCached, context)) {
		await app.vault.process(canvasFile, () => JSON.stringify(canvas, null, '\t'));
	}
}

function gateLineToRow(line: string): { kind: string; expression: string } {
	const parsed = parseGateLine(line);
	if ('error' in parsed) {
		return { kind: 'expression', expression: line.trim() };
	}
	switch (parsed.kind) {
		case 'speaker':
			return { kind: `speaker:${parsed.field}`, expression: parsed.value };
		case 'choice':
			return { kind: 'Choice', expression: String(parsed.choiceValue) };
		case 'filter':
			return parsed.filterKind === 'Function'
				? { kind: 'expression', expression: parsed.variable }
				: { kind: `filter:${parsed.filterKind}`, expression: parsed.variable };
	}
}

function rowToGateText(row: { kind: string; expression: string }): string {
	const expression = row.expression.trim();
	if (row.kind === 'Choice') {
		return `Choice = ${expression}`;
	}
	if (row.kind.startsWith('speaker:')) {
		return `${row.kind.slice('speaker:'.length)} = ${expression}`;
	}
	if (row.kind.startsWith('filter:')) {
		return `${row.kind.slice('filter:'.length)} ${expression}`;
	}
	return expression;
}

/** A one-field prompt modal for generative actions. */
class TextPromptModal extends Modal {
	private value = '';

	constructor(
		app: App,
		private readonly title: string,
		private readonly placeholder: string,
		private readonly onSubmit: (value: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.title);
		new Setting(this.contentEl).addText((text) => {
			text.setPlaceholder(this.placeholder).onChange((value) => {
				this.value = value;
			});
			text.inputEl.addClass('esp-inspector-expression');
		});
		new Setting(this.contentEl).addButton((button) => {
			button.setButtonText('Create').setCta().onClick(() => {
				this.close();
				this.onSubmit(this.value);
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class MilestoneSuggestModal extends FuzzySuggestModal<MilestoneLink> {
	constructor(
		app: App,
		private readonly milestones: MilestoneLink[],
		private readonly onPick: (milestone: MilestoneLink) => void,
	) {
		super(app);
	}

	getItems(): MilestoneLink[] {
		return this.milestones;
	}

	getItemText(milestone: MilestoneLink): string {
		return `${milestone.questId} ${milestone.index}`;
	}

	onChooseItem(milestone: MilestoneLink): void {
		this.onPick(milestone);
	}
}

/**
 * Registers the inspector view and the canvas context-menu items. The
 * `canvas:node-menu` event is unofficial; registering it is harmless on
 * versions that never fire it, and node internals are feature-detected.
 */
export function registerQuestInspector(plugin: Plugin): void {
	plugin.registerView(QUEST_INSPECTOR_VIEW_TYPE, (leaf) => new QuestInspectorView(leaf));

	const canvasEvents = plugin.app.workspace as unknown as CanvasWorkspaceEvents;
	plugin.registerEvent(
		canvasEvents.on('canvas:node-menu', (menu, node) => {
			try {
				addCanvasNodeMenuItems(plugin, menu, node);
			} catch (error) {
				console.error('[Obsidian ESP] canvas node menu failed', error);
			}
		}),
	);
}

async function openInspector(plugin: Plugin, card: InspectedCard): Promise<void> {
	const { workspace } = plugin.app;
	const existing = workspace.getLeavesOfType(QUEST_INSPECTOR_VIEW_TYPE);
	const leaf = existing[0] ?? workspace.getRightLeaf(false);
	if (!leaf) {
		return;
	}
	await leaf.setViewState({ type: QUEST_INSPECTOR_VIEW_TYPE, active: true });
	await workspace.revealLeaf(leaf);
	if (leaf.view instanceof QuestInspectorView) {
		await leaf.view.inspect(card);
	}
}

function addCanvasNodeMenuItems(plugin: Plugin, menu: Menu, node: CanvasViewNode): void {
	const data = typeof node.getData === 'function' ? node.getData() : undefined;
	const canvasFile = node.canvas?.view?.file;
	if (!data || !(canvasFile instanceof TFile)) {
		return;
	}
	const meta = getCardMeta(data);
	if (!meta) {
		return;
	}

	const { app } = plugin;
	const card: InspectedCard = { canvasPath: canvasFile.path, nodeId: data.id, meta };

	if (meta.file) {
		menu.addItem((item) => {
			item.setTitle('Open source note').setIcon('file-text').onClick(() => {
				void app.workspace.openLinkText(meta.file ?? '', '', false);
			});
		});
	}
	if (meta.role === 'gate' || meta.role === 'result' || meta.role === 'choice') {
		menu.addItem((item) => {
			item.setTitle('Edit in inspector').setIcon('list-tree').onClick(() => {
				void openInspector(plugin, card);
			});
		});
		menu.addItem((item) => {
			item.setTitle('Refresh card').setIcon('refresh-cw').onClick(() => {
				void refreshCanvasCard(app, card);
			});
		});
	}
	if (meta.role === 'dialogue' && meta.file) {
		const parentPath = meta.file;
		menu.addItem((item) => {
			item.setTitle('Add choice branch').setIcon('git-branch').onClick(() => {
				new TextPromptModal(app, 'Add choice branch', 'Choice prompt shown to the player', (prompt) => {
					void (async () => {
						const parentContent = await readNote(app, parentPath);
						if (parentContent === null) {
							return;
						}
						await runActionOnCanvas(app, card.canvasPath, (canvas, context) => planAddChoiceBranch({
							parentNodeId: card.nodeId,
							parentPath,
							parentContent,
							prompt,
							responseText: '',
							canvas,
							context,
							existingNotePaths: new Set(app.vault.getFiles().map((file) => file.path)),
						}));
					})();
				}).open();
			});
		});
		menu.addItem((item) => {
			item.setTitle('Add speaker variant').setIcon('users').onClick(() => {
				void (async () => {
					const sourceContent = await readNote(app, parentPath);
					if (sourceContent === null) {
						return;
					}
					await runActionOnCanvas(app, card.canvasPath, (canvas, context) => planAddSpeakerVariant({
						sourcePath: parentPath,
						sourceContent,
						canvas,
						context,
						existingNotePaths: new Set(app.vault.getFiles().map((file) => file.path)),
					}));
				})();
			});
		});
		menu.addItem((item) => {
			item.setTitle('Link journal milestone').setIcon('milestone').onClick(() => {
				void (async () => {
					const canvas = await readCanvas(app, card.canvasPath);
					if (!canvas) {
						return;
					}
					const notes = await loadCanvasNotes(app, canvas);
					const context = deriveQuestContext(canvas, (path) => notes.get(path) ?? null);
					new MilestoneSuggestModal(app, context.milestones, (milestone) => {
						void runActionOnCanvas(app, card.canvasPath, (freshCanvas, freshContext) => {
							const dialogueContent = notes.get(parentPath);
							if (dialogueContent === undefined) {
								return { error: `Note not found: ${parentPath}` };
							}
							return planLinkJournalMilestone({
								dialoguePath: parentPath,
								dialogueContent,
								questId: milestone.questId,
								index: milestone.index,
								canvas: freshCanvas,
								context: freshContext,
							});
						});
					}).open();
				})();
			});
		});
	}
}

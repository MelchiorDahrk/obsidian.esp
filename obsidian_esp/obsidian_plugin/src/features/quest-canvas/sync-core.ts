import { getCardMeta } from './card-meta';
import {
	type GateLine,
	parseConditions,
	parseGateCardText,
	parseGateLine,
	parseResultCardText,
	parseResultActions,
	renderConditionBlock,
	renderResultAction,
	renderResultNoteLine,
	type ResultLine,
} from './cards';
import { applyGateLines, parseStructuredFrontmatter, setResultLines } from './frontmatter-surgeon';
import {
	type CanvasEdge,
	type CanvasNode,
	type EspCardMeta,
	type MilestoneLink,
} from './model';
import { getStringValue, measureTextHeight, stableHash } from './utils';

// ---------------------------------------------------------------------------
// Sync core — pure canvas→note translation.
//
// Everything here is synchronous and free of Obsidian APIs so the whole
// engine can be exercised headlessly (scripts/canvas-harness/sync-test.mjs).
// The Obsidian wiring (watchers, debounce, vault writes) lives in sync.ts.
//
// Invariants (see canvas_editing_internals.md, "Sync engine"):
// - Notes are the source of truth; the canvas is a projection.
// - A parse failure never writes anything; the card is re-rendered with a
//   leading ⚠️ line and the user's text preserved below it.
// - Deleting nodes is a layout action; it never deletes note data.
// ---------------------------------------------------------------------------

export interface CanvasData {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	[key: string]: unknown;
}

export const CARD_WARNING_PREFIX = '⚠️';

export function parseCanvasData(content: string): CanvasData | null {
	try {
		const parsed: unknown = JSON.parse(content);
		if (
			typeof parsed === 'object'
			&& parsed !== null
			&& Array.isArray((parsed as CanvasData).nodes)
			&& Array.isArray((parsed as CanvasData).edges)
		) {
			return parsed as CanvasData;
		}
	} catch {
		// Mid-edit canvas writes can be momentarily unparseable; skip them.
	}
	return null;
}

export function hashCanvasContent(content: string): string {
	return stableHash(content);
}

/** Strips the leading ⚠️ error line a previous failed sync may have added. */
export function editableCardText(text: string): string {
	const lines = text.split('\n');
	let start = 0;
	while (start < lines.length && (lines[start] ?? '').trimStart().startsWith(CARD_WARNING_PREFIX)) {
		start += 1;
	}
	return lines.slice(start).join('\n');
}

const SYNCABLE_ROLES = new Set<EspCardMeta['role']>(['gate', 'result', 'choice']);

export interface CardTextEdit {
	nodeId: string;
	meta: EspCardMeta;
	previousText: string;
	nextText: string;
}

/**
 * Semantic text diff between two canvas states: text changes on gate,
 * result, and choice cards that carry provenance metadata. Everything else
 * (positions, sizes, user-created notes, node deletions) is layout-only.
 */
export function diffCanvasTextEdits(previous: CanvasData, next: CanvasData): CardTextEdit[] {
	const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
	const edits: CardTextEdit[] = [];

	for (const node of next.nodes) {
		if (node.type !== 'text') {
			continue;
		}
		const meta = getCardMeta(node);
		if (!meta || !SYNCABLE_ROLES.has(meta.role)) {
			continue;
		}

		const previousNode = previousById.get(node.id);
		if (!previousNode) {
			continue;
		}

		const previousText = editableCardText(previousNode.text ?? '');
		const nextText = editableCardText(node.text ?? '');
		if (previousText !== nextText) {
			edits.push({ nodeId: node.id, meta, previousText, nextText });
		}
	}

	return edits;
}

export interface QuestSyncContext {
	milestones: MilestoneLink[];
	questIds: string[];
}

/**
 * Reconstructs the quest scope needed for rendering (milestone wikilinks,
 * journal condition classification) from the canvas itself: every journal
 * node carries its note path and quest id in espCard.
 */
export function deriveQuestContext(
	canvas: CanvasData,
	readNote: (path: string) => string | null,
): QuestSyncContext {
	const milestones: MilestoneLink[] = [];
	const questIds: string[] = [];

	for (const node of canvas.nodes) {
		const meta = getCardMeta(node);
		if (meta?.role !== 'journal' || !meta.file) {
			continue;
		}

		const content = readNote(meta.file);
		if (content === null) {
			continue;
		}

		const frontmatter = parseStructuredFrontmatter(frontmatterSection(content));
		const questId = getStringValue(frontmatter, 'Topic') ?? meta.questId;
		const indexValue = getStringValue(frontmatter, 'Index');
		const index = indexValue === undefined ? Number.NaN : Number.parseInt(indexValue, 10);
		if (!questId || !Number.isFinite(index)) {
			continue;
		}

		milestones.push({ questId, index, file: { path: meta.file } });
		if (!questIds.includes(questId)) {
			questIds.push(questId);
		}
	}

	milestones.sort((left, right) => left.index - right.index || left.file.path.localeCompare(right.file.path));
	return { milestones, questIds };
}

export interface SyncFailure {
	nodeId: string;
	message: string;
	userText: string;
}

export interface SyncPlan {
	/** Full new note contents, keyed by path (only notes that changed). */
	noteUpdates: Map<string, string>;
	/** Canonical card texts to echo back onto the canvas, keyed by node id. */
	cardUpdates: Map<string, string>;
	failures: SyncFailure[];
}

/**
 * Translates card text edits into note edits (via the frontmatter surgeon)
 * plus the echo-refresh card texts re-rendered from the updated notes.
 */
export function planSyncFromEdits(
	edits: CardTextEdit[],
	readNote: (path: string) => string | null,
	context: QuestSyncContext,
): SyncPlan {
	const workingNotes = new Map<string, string>();
	const failures: SyncFailure[] = [];
	const appliedEdits: CardTextEdit[] = [];

	const readWorking = (path: string): string | null => workingNotes.get(path) ?? readNote(path);

	for (const edit of edits) {
		const path = edit.meta.file;
		if (!path) {
			continue;
		}

		const content = readWorking(path);
		if (content === null) {
			failures.push({ nodeId: edit.nodeId, message: `Note not found: ${path}`, userText: edit.nextText });
			continue;
		}

		switch (edit.meta.role) {
			case 'gate': {
				const parsed = parseGateCardText(edit.nextText);
				if (!parsed.ok) {
					failures.push({ nodeId: edit.nodeId, message: parsed.error, userText: edit.nextText });
					continue;
				}
				workingNotes.set(path, applyGateLines(content, parsed.lines));
				appliedEdits.push(edit);
				break;
			}
			case 'result': {
				const lines = parseResultCardText(edit.nextText);
				workingNotes.set(path, applyResultCardLines(content, lines));
				appliedEdits.push(edit);
				break;
			}
			case 'choice': {
				if (edit.meta.choiceValue === undefined) {
					continue;
				}
				const prompt = edit.nextText.trim();
				if (prompt.length === 0) {
					failures.push({ nodeId: edit.nodeId, message: 'Choice prompt cannot be empty.', userText: edit.nextText });
					continue;
				}
				if (prompt.includes('"')) {
					failures.push({
						nodeId: edit.nodeId,
						message: 'Choice prompts cannot contain double quotes.',
						userText: edit.nextText,
					});
					continue;
				}
				const renamed = renameChoiceInResult(content, edit.meta.choiceValue, prompt);
				if (renamed === null) {
					failures.push({
						nodeId: edit.nodeId,
						message: `No Choice ${edit.meta.choiceValue} line found in ${path}.`,
						userText: edit.nextText,
					});
					continue;
				}
				workingNotes.set(path, renamed);
				appliedEdits.push(edit);
				break;
			}
			default:
				break;
		}
	}

	// Drop notes whose content did not actually change.
	const noteUpdates = new Map<string, string>();
	for (const [path, content] of workingNotes) {
		if (content !== readNote(path)) {
			noteUpdates.set(path, content);
		}
	}

	// Echo refresh: re-render every touched card from the (new) note content
	// so accepted edits come back in canonical form.
	const cardUpdates = new Map<string, string>();
	for (const edit of appliedEdits) {
		const path = edit.meta.file;
		if (!path) {
			continue;
		}
		const content = workingNotes.get(path) ?? readNote(path);
		if (content === null) {
			continue;
		}
		const rendered = renderCardFromNote(edit.meta, content, context);
		if (rendered !== null) {
			cardUpdates.set(edit.nodeId, rendered);
		}
	}

	return { noteUpdates, cardUpdates, failures };
}

/**
 * Applies a sync plan's card texts (echo refresh + ⚠️ failures) onto the
 * parsed canvas in place. Returns true when any node changed.
 */
export function applySyncPlanToCanvas(canvas: CanvasData, plan: SyncPlan): boolean {
	let changed = false;
	const nodesById = new Map(canvas.nodes.map((node) => [node.id, node]));

	for (const [nodeId, text] of plan.cardUpdates) {
		const node = nodesById.get(nodeId);
		if (!node || node.text === text) {
			continue;
		}
		node.text = text;
		node.height = measureTextHeight(text, node.width);
		changed = true;
	}

	for (const failure of plan.failures) {
		const node = nodesById.get(failure.nodeId);
		if (!node) {
			continue;
		}
		const text = `${CARD_WARNING_PREFIX} ${failure.message}\n${failure.userText}`;
		if (node.text === text) {
			continue;
		}
		node.text = text;
		node.height = measureTextHeight(text, node.width);
		changed = true;
	}

	return changed;
}

/** Renders the canonical projection of one card from its note. */
export function renderCardFromNote(
	meta: EspCardMeta,
	noteContent: string,
	context: QuestSyncContext,
): string | null {
	const frontmatter = parseStructuredFrontmatter(frontmatterSection(noteContent));
	switch (meta.role) {
		case 'gate':
			return renderConditionBlock(parseConditions(frontmatter, context.questIds));
		case 'result': {
			const actions = parseResultActions(getStringValue(frontmatter, 'Result') ?? '', context.questIds);
			return actions
				.filter((action) => action.kind !== 'choice-set')
				.map((action) => renderResultAction(action, context.milestones))
				.join('\n');
		}
		case 'choice': {
			if (meta.choiceValue === undefined) {
				return null;
			}
			const actions = parseResultActions(getStringValue(frontmatter, 'Result') ?? '', context.questIds);
			const action = actions.find(
				(candidate) => candidate.kind === 'choice-set' && candidate.choiceValue === meta.choiceValue,
			);
			return action?.choiceText ?? null;
		}
		default:
			return null;
	}
}

/**
 * Merges edited result-card lines back into the note's `Result:` block.
 * `Choice` lines are not shown on result cards, so the original ones keep
 * their positions; card lines replace the non-choice lines around them
 * (line surgery). A card that explicitly contains choice lines becomes
 * authoritative for the whole block instead.
 */
export function applyResultCardLines(content: string, cardLines: ResultLine[]): string {
	const frontmatter = parseStructuredFrontmatter(frontmatterSection(content));
	const originalLines = (getStringValue(frontmatter, 'Result') ?? '')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	const renderedCardLines = cardLines.map((line) => renderResultNoteLine(line));
	const cardHasChoiceLines = cardLines.some((line) => line.kind === 'choice');

	let nextLines: string[];
	if (cardHasChoiceLines) {
		nextLines = renderedCardLines;
	} else {
		const isChoiceLine = (line: string): boolean => /^Choice\s/i.test(line);
		nextLines = [];
		let cardIndex = 0;
		for (const original of originalLines) {
			if (isChoiceLine(original)) {
				nextLines.push(original);
				continue;
			}
			if (cardIndex < renderedCardLines.length) {
				nextLines.push(renderedCardLines[cardIndex] as string);
				cardIndex += 1;
			}
			// Original non-choice lines beyond the card's line count were
			// deleted on the card; drop them.
		}
		for (; cardIndex < renderedCardLines.length; cardIndex += 1) {
			nextLines.push(renderedCardLines[cardIndex] as string);
		}
	}

	return setResultLines(content, nextLines);
}

/**
 * Rewrites the `"text" n` pair for one choice value inside the note's
 * `Choice` result line(s). Returns null when no such pair exists.
 */
export function renameChoiceInResult(content: string, choiceValue: number, prompt: string): string | null {
	const frontmatter = parseStructuredFrontmatter(frontmatterSection(content));
	const resultText = getStringValue(frontmatter, 'Result') ?? '';
	if (resultText.trim().length === 0) {
		return null;
	}

	const lines = resultText
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	let found = false;
	const nextLines = lines.map((line) => {
		if (!/^Choice\s/i.test(line)) {
			return line;
		}
		return line.replace(/"([^"]*)"(\s+)(-?\d+)/g, (pair: string, _text: string, spacing: string, value: string) => {
			if (Number.parseInt(value, 10) !== choiceValue) {
				return pair;
			}
			found = true;
			return `"${prompt}"${spacing}${value}`;
		});
	});

	if (!found) {
		return null;
	}
	return setResultLines(content, nextLines);
}

function frontmatterSection(content: string): string {
	return content.match(/^---\n[\s\S]*?\n---(?:\n|$)/)?.[0] ?? '';
}

// ---------------------------------------------------------------------------
// Functional edges (canvas_editing_internals.md, "Functional edges").
// Only the whitelisted, unambiguous
// gestures below have semantic meaning; every other edge change is visual
// and regeneration restores it. Edges marked espCard.role 'derived' by the
// generator are never interpreted.
// ---------------------------------------------------------------------------

export type EdgeGesture =
	| { type: 'journal-advance'; sourceFile: string; questId: string; index: number }
	| { type: 'offer-choice'; sourceFile: string; choiceValue: number; prompt: string }
	| { type: 'choice-gate'; targetFile: string; choiceValue: number }
	| { type: 'availability-gate'; targetFile: string; questId: string; index: number };

export interface EdgeGestureEdit {
	kind: 'add' | 'remove';
	edgeId: string;
	gesture: EdgeGesture;
}

export function describeEdgeGesture(edit: EdgeGestureEdit): string {
	const { gesture } = edit;
	const verb = edit.kind === 'add' ? 'add' : 'remove';
	switch (gesture.type) {
		case 'journal-advance':
			return `${gesture.sourceFile}: ${verb} result line 'Journal "${gesture.questId}" ${gesture.index}'`;
		case 'offer-choice':
			return `${gesture.sourceFile}: ${verb} result line 'Choice "${gesture.prompt}" ${gesture.choiceValue}'`;
		case 'choice-gate':
			return `${gesture.targetFile}: ${verb} filter 'Choice = ${gesture.choiceValue}'`;
		case 'availability-gate':
			return `${gesture.targetFile}: ${verb} filter 'Journal ${gesture.questId} = ${gesture.index}'`;
	}
}

/**
 * Interprets added/removed edges between provenance-tracked nodes as the
 * whitelisted gestures. Ambiguous edges (unknown endpoints, derived edges,
 * user wires) are ignored.
 */
export function diffCanvasEdgeGestures(
	previous: CanvasData,
	next: CanvasData,
	context: QuestSyncContext,
): EdgeGestureEdit[] {
	const previousEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
	const nextEdges = new Map(next.edges.map((edge) => [edge.id, edge]));
	const edits: EdgeGestureEdit[] = [];

	for (const edge of next.edges) {
		if (!previousEdges.has(edge.id)) {
			const gesture = classifyEdgeGesture(edge, next, context);
			if (gesture) {
				edits.push({ kind: 'add', edgeId: edge.id, gesture });
			}
		}
	}
	for (const edge of previous.edges) {
		if (!nextEdges.has(edge.id)) {
			const gesture = classifyEdgeGesture(edge, previous, context);
			if (gesture) {
				edits.push({ kind: 'remove', edgeId: edge.id, gesture });
			}
		}
	}

	return edits;
}

function classifyEdgeGesture(
	edge: CanvasEdge,
	canvas: CanvasData,
	context: QuestSyncContext,
): EdgeGesture | null {
	if (edge.espCard?.role === 'derived') {
		return null;
	}

	const nodesById = new Map(canvas.nodes.map((node) => [node.id, node]));
	const fromNode = nodesById.get(edge.fromNode);
	const toNode = nodesById.get(edge.toNode);
	const fromMeta = fromNode ? getCardMeta(fromNode) : null;
	const toMeta = toNode ? getCardMeta(toNode) : null;
	if (!fromNode || !toNode || !fromMeta || !toMeta) {
		return null;
	}

	if (fromMeta.role === 'dialogue' && toMeta.role === 'journal' && fromMeta.file && toMeta.file) {
		const milestone = context.milestones.find((candidate) => candidate.file.path === toMeta.file);
		if (!milestone) {
			return null;
		}
		return { type: 'journal-advance', sourceFile: fromMeta.file, questId: milestone.questId, index: milestone.index };
	}

	if (fromMeta.role === 'dialogue' && toMeta.role === 'choice' && fromMeta.file && toMeta.choiceValue !== undefined) {
		return {
			type: 'offer-choice',
			sourceFile: fromMeta.file,
			choiceValue: toMeta.choiceValue,
			prompt: editableCardText(toNode.text ?? '').trim(),
		};
	}

	if (
		fromMeta.role === 'choice'
		&& fromMeta.choiceValue !== undefined
		&& (toMeta.role === 'gate' || toMeta.role === 'dialogue')
		&& toMeta.file
	) {
		return { type: 'choice-gate', targetFile: toMeta.file, choiceValue: fromMeta.choiceValue };
	}

	if (fromMeta.role === 'journal' && toMeta.role === 'gate' && fromMeta.file && toMeta.file) {
		const milestone = context.milestones.find((candidate) => candidate.file.path === fromMeta.file);
		if (!milestone) {
			return null;
		}
		return { type: 'availability-gate', targetFile: toMeta.file, questId: milestone.questId, index: milestone.index };
	}

	return null;
}

/** Parses a note's full gate back into grammar lines (speaker + filters). */
export function gateLinesFromNote(content: string, questIds: string[]): GateLine[] {
	const frontmatter = parseStructuredFrontmatter(frontmatterSection(content));
	const lines: GateLine[] = [];
	for (const condition of parseConditions(frontmatter, questIds)) {
		const parsed = parseGateLine(condition.displayText);
		if (!('error' in parsed)) {
			lines.push(parsed);
		}
	}
	return lines;
}

/** Inserts or replaces the `Journal <questId> …` line in a Result block. */
function upsertJournalResultLine(content: string, questId: string, index: number): string {
	const lines = resultLinesOfContent(content);
	const pattern = journalLinePattern(questId);
	const newLine = `Journal "${questId}" ${index}`;
	const existing = lines.findIndex((line) => pattern.test(line));
	if (existing === -1) {
		lines.push(newLine);
	} else {
		lines[existing] = newLine;
	}
	return setResultLines(content, lines);
}

function removeJournalResultLine(content: string, questId: string, index: number): string {
	const pattern = new RegExp(`^Journal\\s+"?${escapeRegExp(questId)}"?\\s+${index}$`, 'i');
	const lines = resultLinesOfContent(content).filter((line) => !pattern.test(line));
	return setResultLines(content, lines);
}

function upsertChoiceResultPair(content: string, prompt: string, choiceValue: number): string {
	const lines = resultLinesOfContent(content);
	const hasPair = lines.some((line) => /^Choice\s/i.test(line) && choicePairValues(line).includes(choiceValue));
	if (hasPair) {
		return content;
	}
	lines.push(`Choice "${prompt}" ${choiceValue}`);
	return setResultLines(content, lines);
}

function removeChoiceResultPair(content: string, choiceValue: number): string {
	const lines: string[] = [];
	for (const line of resultLinesOfContent(content)) {
		if (!/^Choice\s/i.test(line)) {
			lines.push(line);
			continue;
		}
		const stripped = line
			.replace(/"([^"]*)"\s+(-?\d+)\s*/g, (pair: string, _text: string, value: string) => (
				Number.parseInt(value, 10) === choiceValue ? '' : pair.endsWith(' ') ? pair : `${pair} `
			))
			.trim();
		if (!/^Choice$/i.test(stripped)) {
			lines.push(stripped);
		}
	}
	return setResultLines(content, lines);
}

function resultLinesOfContent(content: string): string[] {
	const frontmatter = parseStructuredFrontmatter(frontmatterSection(content));
	return (getStringValue(frontmatter, 'Result') ?? '')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function journalLinePattern(questId: string): RegExp {
	return new RegExp(`^Journal\\s+"?${escapeRegExp(questId)}"?\\s+-?\\d+$`, 'i');
}

function choicePairValues(line: string): number[] {
	const values: number[] = [];
	const pattern = /"[^"]*"\s+(-?\d+)/g;
	let match = pattern.exec(line);
	while (match) {
		values.push(Number.parseInt(match[1] ?? '0', 10));
		match = pattern.exec(line);
	}
	return values;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Translates edge gestures into note edits plus echo card updates. The
 * caller decides which gestures reach this point (removals go through a
 * confirmation modal first).
 */
export function planEdgeGestures(
	edits: EdgeGestureEdit[],
	readNote: (path: string) => string | null,
	context: QuestSyncContext,
	canvas: CanvasData,
): SyncPlan {
	const workingNotes = new Map<string, string>();
	const failures: SyncFailure[] = [];
	const readWorking = (path: string): string | null => workingNotes.get(path) ?? readNote(path);
	const touchedFiles = new Set<string>();

	for (const edit of edits) {
		const { gesture } = edit;
		const path = 'sourceFile' in gesture ? gesture.sourceFile : gesture.targetFile;
		const content = readWorking(path);
		if (content === null) {
			failures.push({ nodeId: edit.edgeId, message: `Note not found: ${path}`, userText: '' });
			continue;
		}

		let next = content;
		switch (gesture.type) {
			case 'journal-advance':
				next = edit.kind === 'add'
					? upsertJournalResultLine(content, gesture.questId, gesture.index)
					: removeJournalResultLine(content, gesture.questId, gesture.index);
				break;
			case 'offer-choice':
				if (edit.kind === 'add' && gesture.prompt.length === 0) {
					failures.push({ nodeId: edit.edgeId, message: 'Choice card has no prompt text.', userText: '' });
					continue;
				}
				next = edit.kind === 'add'
					? upsertChoiceResultPair(content, gesture.prompt, gesture.choiceValue)
					: removeChoiceResultPair(content, gesture.choiceValue);
				break;
			case 'choice-gate': {
				const lines = gateLinesFromNote(content, context.questIds);
				const has = lines.some((line) => line.kind === 'choice' && line.choiceValue === gesture.choiceValue);
				if (edit.kind === 'add' && !has) {
					lines.push({ kind: 'choice', choiceValue: gesture.choiceValue });
					next = applyGateLines(content, lines);
				} else if (edit.kind === 'remove' && has) {
					next = applyGateLines(
						content,
						lines.filter((line) => !(line.kind === 'choice' && line.choiceValue === gesture.choiceValue)),
					);
				}
				break;
			}
			case 'availability-gate': {
				const lines = gateLinesFromNote(content, context.questIds);
				const matches = (line: GateLine): boolean => (
					line.kind === 'filter'
					&& line.filterKind === 'Journal'
					&& new RegExp(`^${escapeRegExp(gesture.questId)}\\s*(=|==)\\s*${gesture.index}$`).test(line.variable.trim())
				);
				const has = lines.some(matches);
				if (edit.kind === 'add' && !has) {
					lines.push({ kind: 'filter', filterKind: 'Journal', variable: `${gesture.questId} = ${gesture.index}` });
					next = applyGateLines(content, lines);
				} else if (edit.kind === 'remove' && has) {
					next = applyGateLines(content, lines.filter((line) => !matches(line)));
				}
				break;
			}
		}

		if (next !== content) {
			workingNotes.set(path, next);
			touchedFiles.add(path);
		}
	}

	const noteUpdates = new Map<string, string>();
	for (const [path, content] of workingNotes) {
		if (content !== readNote(path)) {
			noteUpdates.set(path, content);
		}
	}

	// Echo: re-render gate and result cards of every touched note.
	const cardUpdates = new Map<string, string>();
	for (const node of canvas.nodes) {
		const meta = getCardMeta(node);
		if (!meta?.file || !touchedFiles.has(meta.file) || (meta.role !== 'gate' && meta.role !== 'result')) {
			continue;
		}
		const content = workingNotes.get(meta.file) ?? readNote(meta.file);
		if (content === null) {
			continue;
		}
		const rendered = renderCardFromNote(meta, content, context);
		if (rendered !== null) {
			cardUpdates.set(node.id, rendered);
		}
	}

	return { noteUpdates, cardUpdates, failures };
}

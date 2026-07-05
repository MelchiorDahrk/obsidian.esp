import { getCardMeta, setCardMeta } from './card-meta';
import {
	type GateLine,
	parseConditions,
	parseGateLine,
	parseResultActions,
	renderGateLine,
} from './cards';
import { applyGateLines, parseStructuredFrontmatter, setResultLines } from './frontmatter-surgeon';
import {
	type CanvasEdge,
	type CanvasNode,
	CHOICE_WIDTH,
	DIALOGUE_COLOR,
	DIALOGUE_WIDTH,
	type EspCardMeta,
	GATE_COLOR,
	GATE_WIDTH,
} from './model';
import { type CanvasData, type QuestSyncContext, renderCardFromNote } from './sync-core';
import { createEdgeId, createNodeId, getStringValue, measureTextHeight } from './utils';

// ---------------------------------------------------------------------------
// Generative canvas actions (editing plan §8). Each planner is pure: it maps
// current note/canvas state to the note writes, note creations, and canvas
// insertions the action performs. The Obsidian wiring (inspector.ts) applies
// plans through the vault. Node ids reuse the generator's seeds so a later
// regeneration matches the inserted nodes by provenance instead of
// duplicating them.
// ---------------------------------------------------------------------------

export interface CanvasInsertion {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}

export interface ActionPlan {
	/** Full new contents for existing notes, keyed by path. */
	noteUpdates: Map<string, string>;
	/** Notes to create, keyed by path. */
	noteCreations: Map<string, string>;
	canvasInsertion: CanvasInsertion;
	/** Canonical text updates for existing cards (echo), keyed by node id. */
	cardUpdates: Map<string, string>;
	/** Provenance metadata replacements, keyed by node id. */
	metaUpdates: Map<string, Omit<EspCardMeta, 'rev'>>;
}

export type ActionResult = ActionPlan | { error: string };

function emptyPlan(): ActionPlan {
	return {
		noteUpdates: new Map(),
		noteCreations: new Map(),
		canvasInsertion: { nodes: [], edges: [] },
		cardUpdates: new Map(),
		metaUpdates: new Map(),
	};
}

function frontmatterOf(content: string): Record<string, string | string[]> {
	return parseStructuredFrontmatter(content.match(/^---\n[\s\S]*?\n---(?:\n|$)/)?.[0] ?? '');
}

function resultLinesOf(content: string): string[] {
	return (getStringValue(frontmatterOf(content), 'Result') ?? '')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/** Smallest free `<topic> ~<n>.md` path in the given folder. */
export function pickFreeNotePath(
	folderPath: string,
	topic: string,
	existingPaths: ReadonlySet<string>,
): string {
	for (let suffix = 1; ; suffix += 1) {
		const candidate = `${folderPath}/${topic} ~${suffix}.md`;
		if (!existingPaths.has(candidate)) {
			return candidate;
		}
	}
}

function nodeById(canvas: CanvasData, nodeId: string): CanvasNode | undefined {
	return canvas.nodes.find((node) => node.id === nodeId);
}

function addPlannedEdge(
	insertion: CanvasInsertion,
	canvas: CanvasData,
	seed: string,
	fromNode: string,
	toNode: string,
	label?: string,
): void {
	const id = createEdgeId(seed);
	if (canvas.edges.some((edge) => edge.id === id) || insertion.edges.some((edge) => edge.id === id)) {
		return;
	}
	insertion.edges.push({
		id,
		fromNode,
		fromSide: 'right',
		toNode,
		toSide: 'left',
		...(label ? { label } : {}),
	});
}

/**
 * Adds a new choice branch under a dialogue node: appends `Choice "…" n` to
 * the parent's Result, creates a gated response note in the same topic
 * folder (inheriting the parent's journal gate), and inserts the choice
 * card, gate card, dialogue node, and edges next to the parent.
 */
export function planAddChoiceBranch(args: {
	parentNodeId: string;
	parentPath: string;
	parentContent: string;
	prompt: string;
	responseText: string;
	canvas: CanvasData;
	context: QuestSyncContext;
	existingNotePaths: ReadonlySet<string>;
}): ActionResult {
	const prompt = args.prompt.trim();
	if (prompt.length === 0) {
		return { error: 'Choice prompt cannot be empty.' };
	}
	if (prompt.includes('"')) {
		return { error: 'Choice prompts cannot contain double quotes.' };
	}

	const parentNode = nodeById(args.canvas, args.parentNodeId);
	if (!parentNode) {
		return { error: 'Parent dialogue node was not found on the canvas.' };
	}

	const frontmatter = frontmatterOf(args.parentContent);
	const type = getStringValue(frontmatter, 'Type') ?? 'Topic';
	const topic = getStringValue(frontmatter, 'Topic');
	if (!topic) {
		return { error: 'Parent note has no Topic.' };
	}

	// Next free choice value across the parent's existing Choice results.
	const parentActions = parseResultActions(getStringValue(frontmatter, 'Result') ?? '', args.context.questIds);
	const usedValues = parentActions
		.filter((action) => action.kind === 'choice-set' && action.choiceValue !== undefined)
		.map((action) => action.choiceValue as number);
	const choiceValue = usedValues.length > 0 ? Math.max(...usedValues) + 1 : 1;

	const plan = emptyPlan();

	// 1. Parent note: append the Choice line.
	const parentLines = resultLinesOf(args.parentContent);
	parentLines.push(`Choice "${prompt}" ${choiceValue}`);
	plan.noteUpdates.set(args.parentPath, setResultLines(args.parentContent, parentLines));

	// 2. New response note: Choice filter plus the parent's journal gate.
	const gateLines: GateLine[] = [{ kind: 'choice', choiceValue }];
	const parentConditions = parseConditions(frontmatter, args.context.questIds);
	for (const condition of parentConditions) {
		if (condition.kind === 'journal' && condition.questId && args.context.questIds.includes(condition.questId)) {
			gateLines.push({
				kind: 'filter',
				filterKind: 'Journal',
				variable: `${condition.questId} ${condition.operator ?? '='} ${condition.value ?? 0}`,
			});
		}
	}

	const folderPath = args.parentPath.slice(0, args.parentPath.lastIndexOf('/'));
	const newNotePath = pickFreeNotePath(folderPath, topic, args.existingNotePaths);
	const template = [
		'---',
		'Source:',
		`Type: ${type}`,
		`Topic: ${topic}`,
		'---',
		'',
		args.responseText.trim().length > 0 ? args.responseText.trim() : 'New response.',
		'',
	].join('\n');
	plan.noteCreations.set(newNotePath, applyGateLines(template, gateLines));

	// 3. Canvas insertion next to the parent, using the generator's seeds.
	const gateText = gateLines.map((line) => renderGateLine(line)).join('\n');
	const choiceDisplaySeed = `choice:${args.parentPath}:${choiceValue}:"${prompt}" - Choice ${choiceValue}`;
	const choiceX = parentNode.x + parentNode.width + 260;
	const choiceY = parentNode.y;
	const choiceNode: CanvasNode = {
		id: createNodeId(choiceDisplaySeed),
		type: 'text',
		text: prompt,
		x: choiceX,
		y: choiceY,
		width: CHOICE_WIDTH,
		height: measureTextHeight(prompt, CHOICE_WIDTH),
		color: GATE_COLOR,
	};
	setCardMeta(choiceNode, { role: 'choice', file: args.parentPath, choiceValue });

	const gateNode: CanvasNode = {
		id: createNodeId(`gate:${newNotePath}`),
		type: 'text',
		text: gateText,
		x: choiceX + CHOICE_WIDTH + 200,
		y: choiceY,
		width: GATE_WIDTH,
		height: measureTextHeight(gateText, GATE_WIDTH),
		color: GATE_COLOR,
	};
	setCardMeta(gateNode, { role: 'gate', file: newNotePath });

	const dialogueNode: CanvasNode = {
		id: createNodeId(`dialogue:${newNotePath}`),
		type: 'file',
		file: newNotePath,
		x: gateNode.x + GATE_WIDTH + 200,
		y: choiceY,
		width: DIALOGUE_WIDTH,
		height: 120,
		color: DIALOGUE_COLOR,
	};
	setCardMeta(dialogueNode, { role: 'dialogue', file: newNotePath });

	plan.canvasInsertion.nodes.push(choiceNode, gateNode, dialogueNode);
	addPlannedEdge(plan.canvasInsertion, args.canvas, `${args.parentNodeId}:${choiceNode.id}`, args.parentNodeId, choiceNode.id);
	addPlannedEdge(plan.canvasInsertion, args.canvas, `${choiceNode.id}:${gateNode.id}:${choiceValue}`, choiceNode.id, gateNode.id);
	addPlannedEdge(plan.canvasInsertion, args.canvas, `${gateNode.id}:${dialogueNode.id}`, gateNode.id, dialogueNode.id);

	// 4. Echo the parent's result card if it is on the canvas (the Choice
	// line itself is not shown there, so usually no text change).
	const parentResultNode = args.canvas.nodes.find((node) => {
		const meta = getCardMeta(node);
		return meta?.role === 'result' && meta.file === args.parentPath;
	});
	if (parentResultNode) {
		const rendered = renderCardFromNote(
			{ role: 'result', file: args.parentPath, rev: 1 },
			plan.noteUpdates.get(args.parentPath) ?? args.parentContent,
			args.context,
		);
		if (rendered !== null) {
			plan.cardUpdates.set(parentResultNode.id, rendered);
		}
	}

	return plan;
}

/**
 * Duplicates a dialogue note minus its speaker fields so the author can
 * write a variant for a different speaker. The new gate keeps all
 * non-speaker filters.
 */
export function planAddSpeakerVariant(args: {
	sourcePath: string;
	sourceContent: string;
	canvas: CanvasData;
	context: QuestSyncContext;
	existingNotePaths: ReadonlySet<string>;
}): ActionResult {
	const frontmatter = frontmatterOf(args.sourceContent);
	const topic = getStringValue(frontmatter, 'Topic');
	if (!topic) {
		return { error: 'Source note has no Topic.' };
	}

	const plan = emptyPlan();
	const folderPath = args.sourcePath.slice(0, args.sourcePath.lastIndexOf('/'));
	const newNotePath = pickFreeNotePath(folderPath, topic, args.existingNotePaths);

	// Blank the speaker keys and drop record identity, keep everything else.
	let variantContent = args.sourceContent;
	const nonSpeakerLines = parseConditions(frontmatter, args.context.questIds)
		.filter((condition) => condition.kind !== 'speaker');
	const gateLines: GateLine[] = [];
	for (const condition of nonSpeakerLines) {
		// Gate display text is the canonical grammar since Phase 0, so this
		// is just a parse; unparseable lines are dropped from the variant.
		const parsed = parseGateLine(condition.displayText);
		if (!('error' in parsed)) {
			gateLines.push(parsed);
		}
	}
	variantContent = applyGateLines(variantContent, gateLines);
	variantContent = variantContent.replace(/^DiagID:.*$/m, 'DiagID:').replace(/^PrevID:.*$/m, 'PrevID:');
	plan.noteCreations.set(newNotePath, variantContent);

	const sourceDialogueId = createNodeId(`dialogue:${args.sourcePath}`);
	const sourceNode = nodeById(args.canvas, sourceDialogueId);
	const baseX = sourceNode ? sourceNode.x : 0;
	const baseY = sourceNode ? sourceNode.y + sourceNode.height + 160 : 0;

	const gateText = gateLines.map((line) => renderGateLine(line)).join('\n');
	const gateNode: CanvasNode = {
		id: createNodeId(`gate:${newNotePath}`),
		type: 'text',
		text: gateText,
		x: baseX - GATE_WIDTH - 200,
		y: baseY,
		width: GATE_WIDTH,
		height: measureTextHeight(gateText.length > 0 ? gateText : ' ', GATE_WIDTH),
		color: GATE_COLOR,
	};
	setCardMeta(gateNode, { role: 'gate', file: newNotePath });

	const dialogueNode: CanvasNode = {
		id: createNodeId(`dialogue:${newNotePath}`),
		type: 'file',
		file: newNotePath,
		x: baseX,
		y: baseY,
		width: DIALOGUE_WIDTH,
		height: 120,
		color: DIALOGUE_COLOR,
	};
	setCardMeta(dialogueNode, { role: 'dialogue', file: newNotePath });

	if (gateText.length > 0) {
		plan.canvasInsertion.nodes.push(gateNode);
		addPlannedEdge(plan.canvasInsertion, args.canvas, `${gateNode.id}:${dialogueNode.id}`, gateNode.id, dialogueNode.id);
	}
	plan.canvasInsertion.nodes.push(dialogueNode);

	return plan;
}

/**
 * Marks a dialogue response as advancing the quest: writes the `Journal`
 * result line into the note and draws the edge to the milestone node.
 */
export function planLinkJournalMilestone(args: {
	dialoguePath: string;
	dialogueContent: string;
	questId: string;
	index: number;
	canvas: CanvasData;
	context: QuestSyncContext;
}): ActionResult {
	const plan = emptyPlan();
	const lines = resultLinesOf(args.dialogueContent);

	// Replace an existing Journal line for the same quest, else append.
	const journalLinePattern = new RegExp(`^Journal\\s+"?${args.questId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?\\s+-?\\d+$`, 'i');
	const newLine = `Journal "${args.questId}" ${args.index}`;
	const existingIndex = lines.findIndex((line) => journalLinePattern.test(line));
	if (existingIndex === -1) {
		lines.push(newLine);
	} else if (lines[existingIndex] === newLine) {
		return { error: `Already advances ${args.questId} to ${args.index}.` };
	} else {
		lines[existingIndex] = newLine;
	}
	plan.noteUpdates.set(args.dialoguePath, setResultLines(args.dialogueContent, lines));

	// Edge dialogue -> journal node, using the generator's edge seed.
	const milestone = args.context.milestones.find(
		(candidate) => candidate.questId === args.questId && candidate.index === args.index,
	);
	const journalNode = milestone
		? args.canvas.nodes.find((node) => getCardMeta(node)?.role === 'journal' && getCardMeta(node)?.file === milestone.file.path)
		: undefined;
	const dialogueNodeId = createNodeId(`dialogue:${args.dialoguePath}`);
	if (journalNode && nodeById(args.canvas, dialogueNodeId)) {
		addPlannedEdge(
			plan.canvasInsertion,
			args.canvas,
			`${dialogueNodeId}:${journalNode.id}:${args.index}`,
			dialogueNodeId,
			journalNode.id,
		);
	}

	// Echo the result card.
	const resultNode = args.canvas.nodes.find((node) => {
		const meta = getCardMeta(node);
		return meta?.role === 'result' && meta.file === args.dialoguePath;
	});
	if (resultNode) {
		const rendered = renderCardFromNote(
			{ role: 'result', file: args.dialoguePath, rev: 1 },
			plan.noteUpdates.get(args.dialoguePath) ?? args.dialogueContent,
			args.context,
		);
		if (rendered !== null) {
			plan.cardUpdates.set(resultNode.id, rendered);
		}
	}

	return plan;
}

/**
 * Renumbers a choice value: rewrites the `"…" n` pair in the parent's
 * Choice line and every `Choice = n` filter on notes of the same topic.
 * Multi-file by nature, so it is inspector-only (editing plan §6).
 */
export function planRenumberChoice(args: {
	parentPath: string;
	parentContent: string;
	oldValue: number;
	newValue: number;
	/** All notes sharing the parent's topic, keyed by path (parent included). */
	topicNotes: ReadonlyMap<string, string>;
	canvas: CanvasData;
	context: QuestSyncContext;
}): ActionResult {
	if (!Number.isInteger(args.newValue)) {
		return { error: 'Choice value must be an integer.' };
	}
	if (args.newValue === args.oldValue) {
		return { error: 'Choice value is unchanged.' };
	}

	const parentFrontmatter = frontmatterOf(args.parentContent);
	const parentActions = parseResultActions(getStringValue(parentFrontmatter, 'Result') ?? '', args.context.questIds);
	const usedValues = parentActions
		.filter((action) => action.kind === 'choice-set' && action.choiceValue !== undefined)
		.map((action) => action.choiceValue as number);
	if (!usedValues.includes(args.oldValue)) {
		return { error: `Parent has no Choice ${args.oldValue}.` };
	}
	if (usedValues.includes(args.newValue)) {
		return { error: `Choice ${args.newValue} is already used by this record.` };
	}

	const plan = emptyPlan();

	// Parent: renumber the pair inside its Choice line(s).
	const parentLines = resultLinesOf(args.parentContent).map((line) => {
		if (!/^Choice\s/i.test(line)) {
			return line;
		}
		return line.replace(/"([^"]*)"(\s+)(-?\d+)/g, (pair: string, text: string, spacing: string, value: string) => (
			Number.parseInt(value, 10) === args.oldValue ? `"${text}"${spacing}${args.newValue}` : pair
		));
	});
	plan.noteUpdates.set(args.parentPath, setResultLines(args.parentContent, parentLines));

	// Children: every note on the topic gated by `Choice = oldValue`.
	const choiceFilterPattern = new RegExp(`^(Variable\\d:\\s*Choice\\s*=\\s*)${args.oldValue}\\s*$`, 'm');
	for (const [path, content] of args.topicNotes) {
		if (path === args.parentPath) {
			continue;
		}
		let next = content;
		while (choiceFilterPattern.test(next)) {
			next = next.replace(choiceFilterPattern, `$1${args.newValue}`);
		}
		if (next !== content) {
			plan.noteUpdates.set(path, next);
		}
	}

	// Canvas: retarget the choice card's meta and echo affected cards.
	for (const node of args.canvas.nodes) {
		const meta = getCardMeta(node);
		if (!meta) {
			continue;
		}
		if (meta.role === 'choice' && meta.file === args.parentPath && meta.choiceValue === args.oldValue) {
			plan.metaUpdates.set(node.id, { ...meta, choiceValue: args.newValue });
		}
		if (meta.role === 'gate' && meta.file && plan.noteUpdates.has(meta.file)) {
			const rendered = renderCardFromNote(meta, plan.noteUpdates.get(meta.file) as string, args.context);
			if (rendered !== null) {
				plan.cardUpdates.set(node.id, rendered);
			}
		}
	}

	return plan;
}

/** Applies an action plan's canvas changes onto parsed canvas data in place. */
export function applyActionPlanToCanvas(canvas: CanvasData, plan: ActionPlan): boolean {
	let changed = false;
	const nodeIds = new Set(canvas.nodes.map((node) => node.id));
	for (const node of plan.canvasInsertion.nodes) {
		if (!nodeIds.has(node.id)) {
			canvas.nodes.push(node);
			nodeIds.add(node.id);
			changed = true;
		}
	}
	const edgeIds = new Set(canvas.edges.map((edge) => edge.id));
	for (const edge of plan.canvasInsertion.edges) {
		if (!edgeIds.has(edge.id)) {
			canvas.edges.push(edge);
			edgeIds.add(edge.id);
			changed = true;
		}
	}
	for (const [nodeId, text] of plan.cardUpdates) {
		const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
		if (node && node.text !== text) {
			node.text = text;
			node.height = measureTextHeight(text, node.width);
			changed = true;
		}
	}
	for (const [nodeId, meta] of plan.metaUpdates) {
		const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
		if (node) {
			setCardMeta(node, meta);
			changed = true;
		}
	}
	return changed;
}

/** Re-renders one card's text from its note (context-menu "Refresh card"). */
export function refreshCardFromNote(
	canvas: CanvasData,
	nodeId: string,
	readNote: (path: string) => string | null,
	context: QuestSyncContext,
): boolean {
	const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) {
		return false;
	}
	const meta = getCardMeta(node);
	if (!meta?.file) {
		return false;
	}
	const content = readNote(meta.file);
	if (content === null) {
		return false;
	}
	const rendered = renderCardFromNote(meta, content, context);
	if (rendered === null || node.text === rendered) {
		return false;
	}
	node.text = rendered;
	node.height = measureTextHeight(rendered, node.width);
	return true;
}

/**
 * @file Canvas emission primitives: node/edge construction, dedup, and file
 * output.
 *
 * Layout and transition passes build canvases exclusively through the
 * helpers here — `addFileNode`/`addTextNode`/`addEdge` guarantee stable IDs
 * (hashed from semantic seeds), attach espCard provenance, and silently
 * ignore duplicates, which is what makes the passes idempotent. Also home to
 * `nodeCanReach` (the reachability check every wiring pass uses) and the
 * canvas/backlink writers.
 */
import { App, TFile, TFolder } from 'obsidian';
import { splitFrontmatter } from '../../utils/obsidian-utils';
import { getCardMeta, setCardMeta } from './card-meta';
import {
	type CanvasEdge,
	type CanvasLayoutContext,
	type CanvasNode,
	type EspCardMeta,
	FILE_NODE_MIN_HEIGHT,
	JOURNAL_COLOR,
	JOURNAL_FOLDER_NAME,
	JOURNAL_WIDTH,
	type JournalMilestone,
} from './model';
import {
	createEdgeId,
	createNodeId,
	measureCanvasBodyHeight,
	measureTextHeight,
} from './utils';

/** Fresh, empty layout state for one canvas build. */
export function createCanvasLayoutContext(): CanvasLayoutContext {
	return {
		nodes: [],
		edges: [],
		relatedFiles: new Map<string, TFile>(),
		fileBodyTextByPath: new Map<string, string>(),
		phaseNodeIds: new Map<number, string>(),
		recordEntryNodeIds: new Map<string, string>(),
		choiceTransitionAnchors: [],
		nodeIds: new Set<string>(),
		edgeIds: new Set<string>(),
		phaseIncomingCounts: new Map<number, number>(),
		phaseOutgoingCounts: new Map<number, number>(),
	};
}

/** The journal node ID registered for a phase, if that phase was laid out. */
export function contextPhaseNodeId(context: CanvasLayoutContext, phaseValue: number): string | undefined {
	return context.phaseNodeIds.get(phaseValue);
}

/**
 * Adds the journal (milestone) file node that anchors a phase column and
 * registers it as that phase's node. Reuses the node when the same milestone
 * anchors several phases.
 */
export function addPhaseMilestone(
	context: CanvasLayoutContext,
	phaseValue: number,
	milestone: JournalMilestone,
	phaseX: number,
): string {
	const nodeId = createNodeId(`journal:${milestone.file.path}`);
	if (!context.nodeIds.has(nodeId)) {
		const height = measureFileNodeHeight(context, milestone.file.path, JOURNAL_WIDTH);
		const node: CanvasNode = {
			id: nodeId,
			type: 'file',
			file: milestone.file.path,
			x: phaseX,
			y: 0,
			width: JOURNAL_WIDTH,
			height,
			color: JOURNAL_COLOR,
		};
		setCardMeta(node, { role: 'journal', file: milestone.file.path, questId: milestone.questId });
		context.nodes.push(node);
		context.nodeIds.add(nodeId);
	}

	context.phaseNodeIds.set(phaseValue, nodeId);
	context.relatedFiles.set(milestone.file.path, milestone.file);
	return nodeId;
}

/** Vertically centers a phase's journal node on its column's content. */
export function centerPhaseMilestone(context: CanvasLayoutContext, phaseValue: number, centerY: number): void {
	const nodeId = context.phaseNodeIds.get(phaseValue);
	if (!nodeId) {
		return;
	}

	const node = context.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) {
		return;
	}

	node.y = Math.round(centerY - node.height / 2);
}

/** Looks up a node by ID in the context (linear scan). */
export function findCanvasNode(context: CanvasLayoutContext, nodeId: string): CanvasNode | undefined {
	return context.nodes.find((node) => node.id === nodeId);
}

/** Canvas coordinates of the point where an edge meets the given side. */
export function edgeEndpoint(
	node: CanvasNode,
	side: 'left' | 'right' | 'top' | 'bottom',
): { x: number; y: number } {
	switch (side) {
		case 'left':
			return { x: node.x, y: node.y + node.height / 2 };
		case 'right':
			return { x: node.x + node.width, y: node.y + node.height / 2 };
		case 'top':
			return { x: node.x + node.width / 2, y: node.y };
		case 'bottom':
			return { x: node.x + node.width / 2, y: node.y + node.height };
	}
}

/** Whether the node is a choice card (by espCard role). */
export function isChoiceNode(node: CanvasNode): boolean {
	return getCardMeta(node)?.role === 'choice';
}

/** Whether the node is a text card other than a choice (gate/result/etc.). */
export function isGateNode(node: CanvasNode): boolean {
	return node.type === 'text' && !isChoiceNode(node);
}

/** Whether the node embeds a dialogue note (any file outside Journal/). */
export function isDialogueFileNode(node: CanvasNode): boolean {
	return node.type === 'file' && !node.file?.includes(`/${JOURNAL_FOLDER_NAME}/`);
}

/** Whether the node is a rendered `AddTopic …` result card. */
export function isAddTopicResultNode(node: CanvasNode): boolean {
	return node.type === 'text' && (node.text ?? '').startsWith('AddTopic ');
}

/**
 * Serializes nodes/edges to JSON Canvas format and writes the `.canvas`
 * file, creating parent folders and overwriting any existing canvas.
 */
export async function writeCanvasPlan(
	app: App,
	outputPath: string,
	nodes: CanvasNode[],
	edges: CanvasEdge[],
): Promise<void> {
	const parentFolderPath = outputPath.substring(0, outputPath.lastIndexOf('/'));
	await ensureFolder(app, parentFolderPath);

	const canvasJson = JSON.stringify(
		{
			nodes,
			edges,
			metadata: {
				version: '1.0-1.0',
				frontmatter: {},
			},
		},
		null,
		'\t',
	);

	const existing = app.vault.getAbstractFileByPath(outputPath);
	if (existing instanceof TFile) {
		await app.vault.process(existing, () => canvasJson);
		return;
	}

	await app.vault.create(outputPath, canvasJson);
}

/**
 * Optionally adds a `canvas:` backlink to each related note. This is the
 * only note write generation performs, and it is off by default — see the
 * "Write canvas backlinks" plugin setting.
 */
export async function writeCanvasBacklinks(
	app: App,
	files: TFile[],
	outputCanvasPath: string,
): Promise<void> {
	const canvasFileName = outputCanvasPath.split('/').pop();
	if (!canvasFileName) {
		return;
	}

	for (const file of files) {
		await app.vault.process(file, (content) => ensureCanvasFrontmatterLink(content, canvasFileName));
	}
}

/**
 * Returns note content with a `canvas:` frontmatter list containing a link
 * to the canvas: creates frontmatter/key as needed, appends to an existing
 * list, and no-ops when the link is already present.
 */
export function ensureCanvasFrontmatterLink(content: string, canvasFileName: string): string {
	const linkText = `[[${canvasFileName}]]`;
	const quotedListItem = `  - "${linkText}"`;
	const { frontmatter, body } = splitFrontmatter(content);

	if (frontmatter.length === 0) {
		return `---\ncanvas:\n${quotedListItem}\n---\n\n${body}`;
	}

	if (frontmatter.includes(linkText)) {
		return content;
	}

	const lines = frontmatter.split('\n');
	const updatedLines: string[] = [];
	let inserted = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		updatedLines.push(line);

		if (/^canvas:\s*$/.test(line)) {
			let nextIndex = index + 1;
			while (nextIndex < lines.length && /^\s*-\s+/.test(lines[nextIndex] ?? '')) {
				updatedLines.push(lines[nextIndex] ?? '');
				index = nextIndex;
				nextIndex += 1;
			}
			updatedLines.push(quotedListItem);
			inserted = true;
		}
	}

	if (!inserted) {
		const closingIndex = updatedLines.lastIndexOf('---');
		if (closingIndex === -1) {
			updatedLines.push('canvas:', quotedListItem);
		} else {
			updatedLines.splice(closingIndex, 0, 'canvas:', quotedListItem);
		}
	}

	return `${updatedLines.join('\n')}\n${body}`;
}

/**
 * Adds a file-embed node with provenance metadata; height is measured from
 * the file's registered body text. No-op (returning the same ID) when a node
 * with this seed already exists.
 */
export function addFileNode(
	context: CanvasLayoutContext,
	seed: string,
	filePath: string,
	x: number,
	y: number,
	width: number,
	height: number,
	color: string,
	espCard: Omit<EspCardMeta, 'rev'>,
): string {
	const nodeId = createNodeId(seed);
	if (!context.nodeIds.has(nodeId)) {
		const measuredHeight = measureFileNodeHeight(context, filePath, width);
		const node: CanvasNode = {
			id: nodeId,
			type: 'file',
			file: filePath,
			x,
			y,
			width,
			height: measuredHeight,
			color,
		};
		setCardMeta(node, espCard);
		context.nodes.push(node);
		context.nodeIds.add(nodeId);
	}
	return nodeId;
}

/** Height for a file node, from its cached body text (minimum if unknown). */
export function measureFileNodeHeight(context: CanvasLayoutContext, filePath: string, width: number): number {
	const bodyText = context.fileBodyTextByPath.get(filePath);
	if (!bodyText) {
		return FILE_NODE_MIN_HEIGHT;
	}

	return measureCanvasBodyHeight(bodyText, width);
}

/** Text-card counterpart of {@link addFileNode}; height measured from text. */
export function addTextNode(
	context: CanvasLayoutContext,
	seed: string,
	text: string,
	x: number,
	y: number,
	width: number,
	color: string,
	espCard: Omit<EspCardMeta, 'rev'>,
): string {
	const nodeId = createNodeId(seed);
	if (!context.nodeIds.has(nodeId)) {
		const node: CanvasNode = {
			id: nodeId,
			type: 'text',
			text,
			x,
			y,
			width,
			height: measureTextHeight(text, width),
			color,
		};
		setCardMeta(node, espCard);
		context.nodes.push(node);
		context.nodeIds.add(nodeId);
	}
	return nodeId;
}

/**
 * Adds an edge (skipping duplicates and self-loops). Pass `derived: true`
 * for placement-heuristic edges the sync engine must ignore — live edges
 * between espCard nodes are interpreted as game semantics.
 */
export function addEdge(
	context: CanvasLayoutContext,
	seed: string,
	fromNode: string,
	fromSide: 'left' | 'right' | 'top' | 'bottom',
	toNode: string,
	toSide: 'left' | 'right' | 'top' | 'bottom',
	label?: string,
	derived = false,
): void {
	const edgeId = createEdgeId(seed);
	if (context.edgeIds.has(edgeId) || fromNode === toNode) {
		return;
	}

	context.edges.push({
		id: edgeId,
		fromNode,
		fromSide,
		toNode,
		toSide,
		...(label ? { label } : {}),
		...(derived ? { espCard: { role: 'derived' as const, rev: 1 } } : {}),
	});
	context.edgeIds.add(edgeId);
}

/**
 * BFS over directed edges: is `toNode` reachable from `fromNode`? Used by
 * every wiring pass to avoid redundant edges and cycles. Rebuilds the
 * adjacency map per call — fine at canvas scale, revisit if profiling says
 * otherwise.
 */
export function nodeCanReach(context: CanvasLayoutContext, fromNode: string, toNode: string): boolean {
	const outgoingEdgesByNode = new Map<string, CanvasEdge[]>();
	for (const edge of context.edges) {
		const outgoingEdges = outgoingEdgesByNode.get(edge.fromNode) ?? [];
		outgoingEdges.push(edge);
		outgoingEdgesByNode.set(edge.fromNode, outgoingEdges);
	}

	const queue = [fromNode];
	const visited = new Set<string>();
	while (queue.length > 0) {
		const currentNode = queue.shift();
		if (currentNode === undefined || visited.has(currentNode)) {
			continue;
		}
		if (currentNode === toNode) {
			return true;
		}

		visited.add(currentNode);
		for (const edge of outgoingEdgesByNode.get(currentNode) ?? []) {
			if (!visited.has(edge.toNode)) {
				queue.push(edge.toNode);
			}
		}
	}

	return false;
}

/** Creates the folder if missing; rejects when a file occupies the path. */
export function ensureFolder(app: App, folderPath: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(folderPath);
	if (existing instanceof TFolder) {
		return Promise.resolve();
	}
	if (existing instanceof TFile) {
		return Promise.reject(new Error(`'${folderPath}' already exists and is not a folder.`));
	}
	return app.vault.createFolder(folderPath).then(() => undefined);
}

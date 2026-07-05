import { App, TFile, TFolder } from 'obsidian';
import { splitFrontmatter } from '../../utils/obsidian-utils';
import {
	type CanvasEdge,
	type CanvasLayoutContext,
	type CanvasNode,
	FILE_NODE_MIN_HEIGHT,
	type FileNodeTarget,
	JOURNAL_COLOR,
	JOURNAL_FOLDER_NAME,
	JOURNAL_WIDTH,
	type JournalMilestone,
} from './model';
import {
	blockIdFromSubpath,
	createEdgeId,
	createNodeId,
	ensureTrailingBodyBlockId,
	measureCanvasBodyHeight,
	measureTextHeight,
} from './utils';

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

export function contextPhaseNodeId(context: CanvasLayoutContext, phaseValue: number): string | undefined {
	return context.phaseNodeIds.get(phaseValue);
}

export function addPhaseMilestone(
	context: CanvasLayoutContext,
	phaseValue: number,
	milestone: JournalMilestone,
	phaseX: number,
): string {
	const nodeId = createNodeId(`journal:${milestone.file.path}`);
	if (!context.nodeIds.has(nodeId)) {
		const height = measureFileNodeHeight(context, milestone.file.path, JOURNAL_WIDTH);
		context.nodes.push({
			id: nodeId,
			type: 'file',
			file: milestone.file.path,
			subpath: milestone.canvasSubpath ?? undefined,
			x: phaseX,
			y: 0,
			width: JOURNAL_WIDTH,
			height,
			color: JOURNAL_COLOR,
		});
		context.nodeIds.add(nodeId);
	}

	context.phaseNodeIds.set(phaseValue, nodeId);
	context.relatedFiles.set(milestone.file.path, milestone.file);
	return nodeId;
}

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

export function findCanvasNode(context: CanvasLayoutContext, nodeId: string): CanvasNode | undefined {
	return context.nodes.find((node) => node.id === nodeId);
}

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

export function isChoiceNode(node: CanvasNode): boolean {
	return node.type === 'text' && /^".*"\s+-\s+Choice\s+-?\d+/.test(node.text ?? '');
}

export function isGateNode(node: CanvasNode): boolean {
	return node.type === 'text' && !isChoiceNode(node);
}

export function isDialogueFileNode(node: CanvasNode): boolean {
	return node.type === 'file' && !node.file?.includes(`/${JOURNAL_FOLDER_NAME}/`);
}

export function isAddTopicResultNode(node: CanvasNode): boolean {
	return node.type === 'text' && (node.text ?? '').startsWith('AddTopic ');
}

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

export async function updateCanvasLinksAndBodyBlocks(
	app: App,
	files: TFile[],
	fileNodeTargets: FileNodeTarget[],
	outputCanvasPath: string,
): Promise<void> {
	const canvasFileName = outputCanvasPath.split('/').pop();
	if (!canvasFileName) {
		return;
	}
	const targetsByPath = new Map(fileNodeTargets.map((target) => [target.file.path, target.subpath]));

	for (const file of files) {
		await app.vault.process(file, (content) => {
			const subpath = targetsByPath.get(file.path);
			const nextContent = subpath ? ensureCanvasBodyBlockLink(content, subpath) : content;
			return ensureCanvasFrontmatterLink(nextContent, canvasFileName);
		});
	}
}

export function ensureCanvasBodyBlockLink(content: string, subpath: string): string {
	const blockId = blockIdFromSubpath(subpath);
	if (!blockId) {
		return content;
	}

	const { frontmatter, body } = splitFrontmatter(content);
	const nextBody = ensureTrailingBodyBlockId(body, blockId);
	if (nextBody === body) {
		return content;
	}

	return `${frontmatter}${nextBody}`;
}

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

export function addFileNode(
	context: CanvasLayoutContext,
	seed: string,
	filePath: string,
	x: number,
	y: number,
	width: number,
	height: number,
	color: string,
	subpath?: string | null,
): string {
	const nodeId = createNodeId(seed);
	if (!context.nodeIds.has(nodeId)) {
		const measuredHeight = measureFileNodeHeight(context, filePath, width);
		context.nodes.push({
			id: nodeId,
			type: 'file',
			file: filePath,
			subpath: subpath ?? undefined,
			x,
			y,
			width,
			height: measuredHeight,
			color,
		});
		context.nodeIds.add(nodeId);
	} else if (subpath) {
		const node = context.nodes.find((candidate) => candidate.id === nodeId);
		if (node?.type === 'file' && !node.subpath) {
			node.subpath = subpath;
		}
	}
	return nodeId;
}

export function measureFileNodeHeight(context: CanvasLayoutContext, filePath: string, width: number): number {
	const bodyText = context.fileBodyTextByPath.get(filePath);
	if (!bodyText) {
		return FILE_NODE_MIN_HEIGHT;
	}

	return measureCanvasBodyHeight(bodyText, width);
}

export function addTextNode(
	context: CanvasLayoutContext,
	seed: string,
	text: string,
	x: number,
	y: number,
	width: number,
	color: string,
): string {
	const nodeId = createNodeId(seed);
	if (!context.nodeIds.has(nodeId)) {
		context.nodes.push({
			id: nodeId,
			type: 'text',
			text,
			x,
			y,
			width,
			height: measureTextHeight(text, width),
			color,
		});
		context.nodeIds.add(nodeId);
	}
	return nodeId;
}

export function addEdge(
	context: CanvasLayoutContext,
	seed: string,
	fromNode: string,
	fromSide: 'left' | 'right' | 'top' | 'bottom',
	toNode: string,
	toSide: 'left' | 'right' | 'top' | 'bottom',
	label?: string,
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
	});
	context.edgeIds.add(edgeId);
}

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

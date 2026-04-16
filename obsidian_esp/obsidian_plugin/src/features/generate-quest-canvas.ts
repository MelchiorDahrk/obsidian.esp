import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { PathManager } from './path-manager';
import { selectVaultFolder } from '../ui/folder-suggest-modal';
import { ProgressBar } from '../ui/progress-bar';
import { splitFrontmatter } from '../utils/obsidian-utils';

const DIALOGUE_TYPES = ['Greeting', 'Topic', 'Persuasion', 'Voice'] as const;
const QUEST_NAME_FIELD = 'Quest Name';
const JOURNAL_FOLDER_NAME = 'Journal';
const QUESTS_FOLDER_NAME = 'Quests';
const HEADER_COLOR = '2';
const DIALOGUE_COLOR = '3';
const GATE_COLOR = '4';
const RESULT_COLOR = '5';
const JOURNAL_COLOR = '6';
const SECTION_HEADER_WIDTH = 240;
const GATE_WIDTH = 385;
const CHOICE_WIDTH = 320;
const DIALOGUE_WIDTH = 440;
const DIALOGUE_HEIGHT = 320;
const JOURNAL_WIDTH = 440;
const JOURNAL_HEIGHT = 220;
const PHASE_GAP_X = 1320;
const HEADER_GAP_X = 180;
const GATE_GAP_X = 520;
const DIALOGUE_GAP_X = 980;
const CHOICE_GAP_X = 1580;
const HEADER_Y_OFFSET = 150;
const LANE_GAP_Y = 560;
const VARIANT_GAP_Y = 420;
const RESULT_GAP_Y = 30;
const CHOICE_COLUMN_GAP_X = 1320;
const TOPIC_SEGMENT_GAP_X = 1920;
const CLUSTER_GAP_Y = 140;
const JUMP_FANOUT_THRESHOLD = 4;
const JUMP_SPAN_THRESHOLD_Y = 900;
const KNOWN_FRONTMATTER_KEYS = new Set([
	'Source',
	'Type',
	'Topic',
	'DiagID',
	'PrevID',
	'Index',
	QUEST_NAME_FIELD,
	'Finished',
	'Restart',
	'canvas',
	'Disposition',
	'ID',
	'Race',
	'Sex',
	'Class',
	'Faction',
	'Rank',
	'Cell',
	'PC Faction',
	'PC Rank',
	'Result',
]);

type DialogueType = (typeof DIALOGUE_TYPES)[number];
type FrontmatterValue = string | string[];

interface MarkdownDocument {
	file: TFile;
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
}

interface QuestScope {
	projectRoot: TFolder;
	selectedFolder: TFolder;
	questTitle: string;
	questKey: string | null;
	questIds: string[];
	journalFolders: TFolder[];
	journalDocuments: MarkdownDocument[];
	journalMilestones: JournalMilestone[];
	rootJournalDocuments: MarkdownDocument[];
	outputCanvasPath: string;
}

interface JournalMilestone {
	id: string;
	questId: string;
	questTitle: string;
	index: number;
	file: TFile;
	summary: string;
}

interface Condition {
	kind: 'speaker' | 'journal' | 'item' | 'choice' | 'other';
	displayText: string;
	questId?: string;
	value?: number;
	operator?: string;
	choiceValue?: number;
}

interface ResultAction {
	kind:
		| 'journal-set'
		| 'choice-set'
		| 'add-topic'
		| 'goodbye'
		| 'script'
		| 'disposition';
	displayText: string;
	targetQuestId?: string;
	targetJournalIndex?: number;
	choiceValue?: number;
	targetTopic?: string;
}

interface DialogueRecord {
	id: string;
	type: DialogueType;
	topic: string;
	file: TFile;
	diagId: string;
	prevId: string;
	bodyText: string;
	conditions: Condition[];
	speakerConditions: Condition[];
	nonSpeakerConditions: Condition[];
	resultActions: ResultAction[];
	resultLines: string[];
	phaseAnchor: number;
	directlyRelevant: boolean;
	questReferences: string[];
	primaryChoiceValue: number | null;
	choiceValues: number[];
	choiceTargets: number[];
}

interface BranchFamily {
	id: string;
	type: DialogueType;
	topic: string;
	phaseAnchor: number;
	records: DialogueRecord[];
	sharedConditions: Condition[];
	results: ResultAction[];
	bodyText: string;
	priority: number;
	progressionTarget: number | null;
}

interface CanvasNode {
	id: string;
	type: 'file' | 'text';
	file?: string;
	text?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
}

interface CanvasEdge {
	id: string;
	fromNode: string;
	fromSide: 'left' | 'right' | 'top' | 'bottom';
	toNode: string;
	toSide: 'left' | 'right' | 'top' | 'bottom';
}

interface CanvasBuildResult {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	relatedFiles: TFile[];
	warnings: string[];
}

interface CanvasLayoutContext {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	relatedFiles: Map<string, TFile>;
	phaseNodeIds: Map<number, string>;
	recordEntryIds: Map<string, string>;
	topicHeaderIds: Map<string, string>;
	choiceNodes: Array<{ phaseValue: number; topic: string; choiceValue: number; nodeId: string }>;
	nodeIds: Set<string>;
	edgeIds: Set<string>;
	phaseIncomingCounts: Map<number, number>;
	phaseOutgoingCounts: Map<number, number>;
}

export async function generateQuestCanvasFromVaultFolder(app: App): Promise<void> {
	const folder = await selectVaultFolder(app);
	if (!folder) {
		return;
	}

	await generateQuestCanvasForFolder(app, folder);
}

export function canGenerateQuestCanvasFromFolder(folder: TFolder): boolean {
	return folder.parent?.name === JOURNAL_FOLDER_NAME;
}

export async function generateQuestCanvasForFolder(app: App, folder: TFolder): Promise<void> {
	const progress = new ProgressBar('Generating quest canvas');
	try {
		progress.update(5, 'Checking the selected folder');
		const scope = await discoverQuestScope(app, folder);
		progress.update(25, `Resolving dialogue for ${scope.questTitle}`);
		const buildResult = await buildQuestCanvas(app, scope);
		progress.update(80, 'Writing canvas and backlinks');
		await writeCanvasPlan(app, scope.outputCanvasPath, buildResult.nodes, buildResult.edges);
		await updateCanvasBacklinks(app, buildResult.relatedFiles, scope.outputCanvasPath);

		const warningSuffix =
			buildResult.warnings.length > 0
				? ` ${buildResult.warnings[0]}`
				: '';
		new Notice(`Generated ${scope.questTitle}.canvas.${warningSuffix}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Failed to generate quest canvas: ${message}`, 10000);
	} finally {
		progress.update(100, 'Done');
		try {
			progress.hide();
		} catch {
			// Best-effort UI cleanup.
		}
	}
}

async function discoverQuestScope(app: App, folder: TFolder): Promise<QuestScope> {
	const projectRoot = PathManager.findPluginRoot(folder);
	if (!projectRoot) {
		throw new Error('Could not find a valid obsidian.esp project root (missing header.md).');
	}

	const journalFolder = resolveJournalQuestFolder(folder, projectRoot);
	if (!journalFolder) {
		throw new Error('Select a quest folder inside Journal/<QuestId>.');
	}

	const selectedDocs = await readFolderMarkdownDocuments(app, journalFolder);
	const selectedQuestTitle = extractQuestTitle(selectedDocs) ?? journalFolder.name;
	const selectedQuestKey = normalizeQuestNameKey(selectedQuestTitle);
	const allJournalFolders = getImmediateChildFolders(projectRoot, JOURNAL_FOLDER_NAME);
	const linkedFolders = [journalFolder];

	if (selectedQuestKey !== null) {
		for (const sibling of allJournalFolders) {
			if (sibling.path === journalFolder.path) {
				continue;
			}

			const siblingDocs = await readFolderMarkdownDocuments(app, sibling);
			const siblingTitle = extractQuestTitle(siblingDocs);
			if (!siblingTitle) {
				continue;
			}

			if (normalizeQuestNameKey(siblingTitle) === selectedQuestKey) {
				linkedFolders.push(sibling);
			}
		}
	}

	const journalDocuments = (
		await Promise.all(linkedFolders.map((childFolder) => readFolderMarkdownDocuments(app, childFolder)))
	).flat();
	const rootJournalDocuments = journalDocuments.filter((document) => isQuestNameNote(document));
	const journalMilestones = journalDocuments
		.map((document) => toJournalMilestone(document))
		.filter((milestone): milestone is JournalMilestone => milestone !== null)
		.sort((left, right) => left.index - right.index || left.file.path.localeCompare(right.file.path));

	if (journalMilestones.length === 0) {
		throw new Error('No journal milestones with numeric Index values were found in the selected quest folder.');
	}

	const questIds = uniqueValues(journalDocuments.map((document) => getStringValue(document.frontmatter, 'Topic')).filter((value): value is string => Boolean(value)));
	const questsFolderPath = normalizePath(`${projectRoot.path}/${QUESTS_FOLDER_NAME}`);
	const outputCanvasPath = normalizePath(`${questsFolderPath}/${sanitizeFileName(selectedQuestTitle)}.canvas`);

	return {
		projectRoot,
		selectedFolder: journalFolder,
		questTitle: selectedQuestTitle,
		questKey: selectedQuestKey,
		questIds,
		journalFolders: linkedFolders,
		journalDocuments,
		journalMilestones,
		rootJournalDocuments,
		outputCanvasPath,
	};
}

async function buildQuestCanvas(app: App, scope: QuestScope): Promise<CanvasBuildResult> {
	const dialogueDocuments = await readDialogueDocuments(app, scope.projectRoot);
	const allRecords = dialogueDocuments
		.map((document) => toDialogueRecord(document, scope.questIds, scope.journalMilestones.map((milestone) => milestone.index)))
		.filter((record): record is DialogueRecord => record !== null);

	const directRelevant = new Set(allRecords.filter((record) => record.directlyRelevant).map((record) => record.id));
	const choiceRelevant = resolveChoiceRelevantRecords(allRecords, directRelevant);
	const neighborRelevant = resolveImmediateNeighborRecords(allRecords, directRelevant);
	const relevantRecordIds = new Set<string>([...directRelevant, ...choiceRelevant, ...neighborRelevant]);
	const relevantRecords = allRecords.filter((record) => relevantRecordIds.has(record.id));

	if (relevantRecords.length === 0) {
		throw new Error('No quest-relevant dialogue notes were found for the selected journal folder.');
	}

	const families = groupBranchFamilies(relevantRecords);
	const warnings: string[] = [];
	const canvasContext = createCanvasLayoutContext();
	const milestoneIndices = uniqueNumbers(scope.journalMilestones.map((milestone) => milestone.index).filter((index) => index > 0));
	const phaseIndices = milestoneIndices.length > 0 ? milestoneIndices : uniqueNumbers(scope.journalMilestones.map((milestone) => milestone.index));
	const familiesByPhase = new Map<number, BranchFamily[]>();
	const phaseXPositions = new Map<number, number>();
	let previousRenderedTopic: string | null = null;

	for (const family of families) {
		const phaseFamilies = familiesByPhase.get(family.phaseAnchor) ?? [];
		phaseFamilies.push(family);
		familiesByPhase.set(family.phaseAnchor, phaseFamilies);
	}

	const milestonesByPhase = new Map<number, JournalMilestone[]>();
	for (const milestone of scope.journalMilestones) {
		if (milestone.index <= 0) {
			continue;
		}
		const phaseMilestones = milestonesByPhase.get(milestone.index) ?? [];
		phaseMilestones.push(milestone);
		milestonesByPhase.set(milestone.index, phaseMilestones);
	}

	const computedPhasePositions = computePhasePositions(phaseIndices, familiesByPhase);
	for (const [phaseValue, phaseX] of computedPhasePositions) {
		phaseXPositions.set(phaseValue, phaseX);
		const phaseMilestones = milestonesByPhase.get(phaseValue) ?? [];
		const phaseMilestone = phaseMilestones[0];
		if (!phaseMilestone) {
			continue;
		}
		addPhaseMilestone(canvasContext, phaseValue, phaseMilestone, phaseX);
	}

	for (let phaseIndex = 0; phaseIndex < phaseIndices.length; phaseIndex += 1) {
		const phaseValue = phaseIndices[phaseIndex] ?? 0;
		const phaseX = phaseXPositions.get(phaseValue) ?? 0;
		const phaseMilestones = milestonesByPhase.get(phaseValue) ?? [];
		if (phaseMilestones.length === 0) {
			warnings.push(`No journal note exists for phase ${phaseValue}; the canvas will skip the milestone file node.`);
			continue;
		}

		const phaseMilestone = phaseMilestones[0];
		if (!phaseMilestone) {
			continue;
		}

		const milestoneNodeId = contextPhaseNodeId(canvasContext, phaseValue);
		if (!milestoneNodeId) {
			continue;
		}
		const phaseFamilies = (familiesByPhase.get(phaseValue) ?? []).sort(compareBranchFamilies);
		const phaseTopics = groupFamiliesByTopic(phaseFamilies);
		let topicSegmentIndex = 0;
		for (const [topic, topicFamilies] of phaseTopics) {
			const topicBaseX = phaseX + GATE_GAP_X + topicSegmentIndex * TOPIC_SEGMENT_GAP_X;
			const choiceColumns = groupFamiliesByPrimaryChoice(topicFamilies);
			let firstTopicEntryId: string | null = null;
			let firstColumnTopY = 0;

			for (let columnIndex = 0; columnIndex < choiceColumns.length; columnIndex += 1) {
				const column = choiceColumns[columnIndex];
				if (!column) {
					continue;
				}

				const gateX = topicBaseX + columnIndex * CHOICE_COLUMN_GAP_X;
				const dialogueX = gateX + (DIALOGUE_GAP_X - GATE_GAP_X);
				const choiceX = dialogueX + (CHOICE_GAP_X - DIALOGUE_GAP_X);
				const columnHeight = estimateChoiceColumnHeight(column.families);
				let currentY = -Math.round(columnHeight / 2);
				if (columnIndex === 0) {
					firstColumnTopY = currentY;
				}

				for (const family of column.families) {
					const familyLayout = layoutBranchFamily(
						canvasContext,
						family,
						phaseValue,
						gateX,
						dialogueX,
						choiceX,
						currentY,
						scope.journalMilestones,
					);
					if (firstTopicEntryId === null) {
						firstTopicEntryId = familyLayout.firstEntryId;
					}
					currentY = familyLayout.nextY;
				}
			}

			if (firstTopicEntryId) {
				if (previousRenderedTopic !== topic) {
					const headerId = addTopicHeader(
						canvasContext,
						`${phaseValue}:${topicSegmentIndex}:${topic}`,
						topic,
						topicBaseX - 340,
						firstColumnTopY - HEADER_Y_OFFSET,
					);
					addEdge(canvasContext, `${milestoneNodeId}:${headerId}`, milestoneNodeId, 'right', headerId, 'left');
					addEdge(canvasContext, `${headerId}:${firstTopicEntryId}`, headerId, 'right', firstTopicEntryId, 'left');
					previousRenderedTopic = topic;
				} else {
					addEdge(canvasContext, `${milestoneNodeId}:${firstTopicEntryId}`, milestoneNodeId, 'right', firstTopicEntryId, 'left');
				}
			}

			topicSegmentIndex += 1;
		}
	}

	connectChoiceBranches(canvasContext, relevantRecords);

	connectScriptedMilestones(canvasContext, phaseIndices);
	insertJumpNodes(canvasContext);

	const relatedFiles = new Map<string, TFile>();
	for (const milestone of scope.journalDocuments) {
		relatedFiles.set(milestone.file.path, milestone.file);
	}
	for (const record of relevantRecords) {
		relatedFiles.set(record.file.path, record.file);
	}

	return {
		nodes: canvasContext.nodes,
		edges: canvasContext.edges,
		relatedFiles: [...relatedFiles.values()].sort((left, right) => left.path.localeCompare(right.path)),
		warnings,
	};
}

function createCanvasLayoutContext(): CanvasLayoutContext {
	return {
		nodes: [],
		edges: [],
		relatedFiles: new Map<string, TFile>(),
		phaseNodeIds: new Map<number, string>(),
		recordEntryIds: new Map<string, string>(),
		topicHeaderIds: new Map<string, string>(),
		choiceNodes: [],
		nodeIds: new Set<string>(),
		edgeIds: new Set<string>(),
		phaseIncomingCounts: new Map<number, number>(),
		phaseOutgoingCounts: new Map<number, number>(),
	};
}

function contextPhaseNodeId(context: CanvasLayoutContext, phaseValue: number): string | undefined {
	return context.phaseNodeIds.get(phaseValue);
}

function addPhaseMilestone(
	context: CanvasLayoutContext,
	phaseValue: number,
	milestone: JournalMilestone,
	phaseX: number,
): string {
	const nodeId = createNodeId(`journal:${milestone.file.path}`);
	if (!context.nodeIds.has(nodeId)) {
		context.nodes.push({
			id: nodeId,
			type: 'file',
			file: milestone.file.path,
			x: phaseX,
			y: 0,
			width: JOURNAL_WIDTH,
			height: JOURNAL_HEIGHT,
			color: JOURNAL_COLOR,
		});
		context.nodeIds.add(nodeId);
	}

	context.phaseNodeIds.set(phaseValue, nodeId);
	context.relatedFiles.set(milestone.file.path, milestone.file);
	return nodeId;
}

function addTopicHeader(
	context: CanvasLayoutContext,
	key: string,
	topic: string,
	x: number,
	y: number,
): string {
	const existingId = context.topicHeaderIds.get(key);
	if (existingId) {
		return existingId;
	}

	const nodeId = createNodeId(`header:${key}`);
	context.nodes.push({
		id: nodeId,
		type: 'text',
		text: `## [[${topic}]]`,
		x,
		y,
		width: SECTION_HEADER_WIDTH,
		height: 56,
		color: HEADER_COLOR,
	});
	context.nodeIds.add(nodeId);
	context.topicHeaderIds.set(key, nodeId);
	return nodeId;
}

function layoutBranchFamily(
	context: CanvasLayoutContext,
	family: BranchFamily,
	phaseValue: number,
	gateX: number,
	dialogueX: number,
	choiceX: number,
	startY: number,
	allMilestones: JournalMilestone[],
): { firstEntryId: string; nextY: number } {
	const familyRecords = [...family.records].sort(compareDialogueRecords);
	const familyChoiceActions = family.results.filter((action) => action.kind === 'choice-set');
	const choiceNodeIds = new Map<number, string>();
	let currentY = startY;
	let firstEntryId = '';
	let choiceCursorY = startY;

	for (let recordIndex = 0; recordIndex < familyRecords.length; recordIndex += 1) {
		const record = familyRecords[recordIndex];
		if (!record) {
			continue;
		}

		const gateText = renderConditionBlock(record.conditions);
		const gateHeight = gateText.length > 0 ? measureTextHeight(gateText) : 0;
		const localResultLines = record.resultActions
			.filter((action) => action.kind !== 'choice-set')
			.map((action) => action.displayText);
		const localResultHeight = localResultLines.length > 0 ? measureTextHeight(localResultLines.join('\n')) + RESULT_GAP_Y : 0;
		const clusterHeight = Math.max(gateHeight, DIALOGUE_HEIGHT) + localResultHeight + CLUSTER_GAP_Y;
		const recordY = currentY;
		const dialogueId = addFileNode(
			context,
			`dialogue:${record.file.path}`,
			record.file.path,
			dialogueX,
			recordY,
			DIALOGUE_WIDTH,
			DIALOGUE_HEIGHT,
			DIALOGUE_COLOR,
		);
		const gateId = gateText.length > 0
			? addTextNode(
				context,
				`gate:${record.file.path}`,
				gateText,
				gateX,
				recordY,
				GATE_WIDTH,
				GATE_COLOR,
			)
			: dialogueId;
		context.recordEntryIds.set(record.id, gateId);
		context.relatedFiles.set(record.file.path, record.file);
		if (firstEntryId.length === 0) {
			firstEntryId = gateId;
		}

		if (gateId !== dialogueId) {
			addEdge(context, `${gateId}:${dialogueId}`, gateId, 'right', dialogueId, 'left');
		}

		if (localResultLines.length > 0) {
			const resultText = localResultLines.join('\n');
			const resultId = addTextNode(
				context,
				`result:${record.file.path}`,
				resultText,
				dialogueX,
				recordY + DIALOGUE_HEIGHT + RESULT_GAP_Y,
				DIALOGUE_WIDTH,
				containsJournalLine(localResultLines) ? JOURNAL_COLOR : RESULT_COLOR,
			);
			addEdge(context, `${dialogueId}:${resultId}`, dialogueId, 'bottom', resultId, 'top');
		}

		for (const action of record.resultActions) {
			if (action.kind !== 'journal-set' || action.targetJournalIndex === undefined) {
				continue;
			}

			const targetMilestone = allMilestones.find((milestone) => milestone.index === action.targetJournalIndex);
			if (!targetMilestone) {
				continue;
			}

			const targetPhaseId = context.phaseNodeIds.get(targetMilestone.index);
			if (!targetPhaseId) {
				continue;
			}

			addEdge(context, `${dialogueId}:${targetPhaseId}:${action.targetJournalIndex}`, dialogueId, 'right', targetPhaseId, 'left');
			incrementPhaseCount(context.phaseOutgoingCounts, phaseValue);
			incrementPhaseCount(context.phaseIncomingCounts, targetMilestone.index);
		}

		for (const choiceAction of familyChoiceActions) {
			if (choiceAction.choiceValue === undefined) {
				continue;
			}

			let choiceNodeId = choiceNodeIds.get(choiceAction.choiceValue);
			if (!choiceNodeId) {
				choiceNodeId = addTextNode(
					context,
					`choice:${family.id}:${choiceAction.choiceValue}`,
					choiceAction.displayText,
					choiceX,
					choiceCursorY,
					CHOICE_WIDTH,
					GATE_COLOR,
				);
				choiceNodeIds.set(choiceAction.choiceValue, choiceNodeId);
				context.choiceNodes.push({
					phaseValue,
					topic: family.topic,
					choiceValue: choiceAction.choiceValue,
					nodeId: choiceNodeId,
				});
				choiceCursorY += measureTextHeight(choiceAction.displayText) + 24;
			}

			addEdge(context, `${dialogueId}:${choiceNodeId}`, dialogueId, 'right', choiceNodeId, 'left');
		}

		currentY += clusterHeight;
	}

	return {
		firstEntryId,
		nextY: currentY,
	};
}

function connectChoiceBranches(context: CanvasLayoutContext, records: DialogueRecord[]): void {
	for (const choiceNode of context.choiceNodes) {
		const matchingRecords = records.filter(
			(record) =>
				record.phaseAnchor === choiceNode.phaseValue
				&& record.topic === choiceNode.topic
				&& record.choiceValues.includes(choiceNode.choiceValue),
		);
		for (const record of matchingRecords) {
			const entryNodeId = context.recordEntryIds.get(record.id);
			if (!entryNodeId) {
				continue;
			}

			addEdge(
				context,
				`${choiceNode.nodeId}:${entryNodeId}:${choiceNode.choiceValue}`,
				choiceNode.nodeId,
				'right',
				entryNodeId,
				'left',
			);
		}
	}
}

function groupFamiliesByTopic(families: BranchFamily[]): Map<string, BranchFamily[]> {
	const grouped = new Map<string, BranchFamily[]>();
	for (const family of families) {
		const topicFamilies = grouped.get(family.topic) ?? [];
		topicFamilies.push(family);
		grouped.set(family.topic, topicFamilies);
	}
	return grouped;
}

function groupFamiliesByPrimaryChoice(
	families: BranchFamily[],
): Array<{ choiceValue: number | null; families: BranchFamily[] }> {
	const grouped = new Map<string, { choiceValue: number | null; families: BranchFamily[] }>();
	for (const family of families) {
		const choiceValues = family.records
			.map((record) => record.primaryChoiceValue)
			.filter((value): value is number => value !== null);
		const choiceValue = choiceValues.length > 0 ? Math.min(...choiceValues) : null;
		const key = choiceValue === null ? 'root' : String(choiceValue);
		const existing = grouped.get(key);
		if (existing) {
			existing.families.push(family);
			continue;
		}
		grouped.set(key, { choiceValue, families: [family] });
	}

	return [...grouped.values()].sort((left, right) => compareNullableNumbers(left.choiceValue, right.choiceValue));
}

function computePhasePositions(
	phaseIndices: number[],
	familiesByPhase: Map<number, BranchFamily[]>,
): Map<number, number> {
	const positions = new Map<number, number>();
	let currentX = 0;

	for (let index = 0; index < phaseIndices.length; index += 1) {
		const phaseValue = phaseIndices[index];
		if (phaseValue === undefined) {
			continue;
		}

		positions.set(phaseValue, currentX);
		const families = (familiesByPhase.get(phaseValue) ?? []).sort(compareBranchFamilies);
		const topics = groupFamiliesByTopic(families);
		const phaseWidth = estimatePhaseWidth(topics);
		currentX += Math.max(PHASE_GAP_X, phaseWidth + 420);
	}

	return positions;
}

function estimatePhaseWidth(topics: Map<string, BranchFamily[]>): number {
	if (topics.size === 0) {
		return JOURNAL_WIDTH;
	}

	let furthestRight = JOURNAL_WIDTH;
	let topicIndex = 0;
	for (const [, families] of topics) {
		const columns = groupFamiliesByPrimaryChoice(families);
		const columnCount = Math.max(1, columns.length);
		const topicBaseX = GATE_GAP_X + topicIndex * TOPIC_SEGMENT_GAP_X;
		const lastGateX = topicBaseX + (columnCount - 1) * CHOICE_COLUMN_GAP_X;
		const lastChoiceX = lastGateX + (CHOICE_GAP_X - GATE_GAP_X);
		furthestRight = Math.max(furthestRight, lastChoiceX + CHOICE_WIDTH);
		topicIndex += 1;
	}

	return furthestRight;
}

function estimateChoiceColumnHeight(families: BranchFamily[]): number {
	if (families.length === 0) {
		return DIALOGUE_HEIGHT + CLUSTER_GAP_Y;
	}

	return families.reduce((total, family) => total + estimateFamilyHeight(family), 0);
}

function estimateFamilyHeight(family: BranchFamily): number {
	let total = 0;
	for (const record of family.records) {
		const gateHeight = measureTextHeight(renderConditionBlock(record.conditions));
		const localResultLines = record.resultActions
			.filter((action) => action.kind !== 'choice-set')
			.map((action) => action.displayText);
		const resultHeight = localResultLines.length > 0 ? measureTextHeight(localResultLines.join('\n')) + RESULT_GAP_Y : 0;
		total += Math.max(gateHeight, DIALOGUE_HEIGHT) + resultHeight + CLUSTER_GAP_Y;
	}
	return Math.max(total, DIALOGUE_HEIGHT + CLUSTER_GAP_Y);
}

function connectScriptedMilestones(context: CanvasLayoutContext, phaseIndices: number[]): void {
	for (let index = 1; index < phaseIndices.length; index += 1) {
		const previousPhase = phaseIndices[index - 1];
		const currentPhase = phaseIndices[index];
		if (previousPhase === undefined || currentPhase === undefined) {
			continue;
		}

		const incoming = context.phaseIncomingCounts.get(currentPhase) ?? 0;
		const outgoing = context.phaseOutgoingCounts.get(previousPhase) ?? 0;
		if (incoming > 0 || outgoing > 0) {
			continue;
		}

		const fromNode = context.phaseNodeIds.get(previousPhase);
		const toNode = context.phaseNodeIds.get(currentPhase);
		if (!fromNode || !toNode) {
			continue;
		}

		addEdge(context, `${fromNode}:${toNode}:scripted`, fromNode, 'right', toNode, 'left');
	}
}

function insertJumpNodes(context: CanvasLayoutContext): void {
	const outgoingBySource = new Map<string, CanvasEdge[]>();
	for (const edge of context.edges) {
		const outgoing = outgoingBySource.get(edge.fromNode) ?? [];
		outgoing.push(edge);
		outgoingBySource.set(edge.fromNode, outgoing);
	}

	const nextEdges: CanvasEdge[] = [];
	const nextNodes: CanvasNode[] = [];
	const removedEdgeIds = new Set<string>();
	let jumpNumber = 1;

	for (const [sourceNodeId, outgoing] of outgoingBySource) {
		if (outgoing.length < JUMP_FANOUT_THRESHOLD) {
			continue;
		}

		const sourceNode = context.nodes.find((node) => node.id === sourceNodeId);
		if (!sourceNode) {
			continue;
		}

		const targetNodes = outgoing
			.map((edge) => context.nodes.find((node) => node.id === edge.toNode))
			.filter((node): node is CanvasNode => node !== undefined);
		if (targetNodes.length < JUMP_FANOUT_THRESHOLD) {
			continue;
		}

		const ys = targetNodes.map((node) => node.y);
		const xs = targetNodes.map((node) => node.x);
		const span = Math.max(...ys) - Math.min(...ys);
		if (span < JUMP_SPAN_THRESHOLD_Y) {
			continue;
		}

		const sourceJumpId = createNodeId(`jump-source:${sourceNodeId}`);
		const resumeJumpId = createNodeId(`jump-resume:${sourceNodeId}`);
		const jumpLabel = `Jump #${jumpNumber}`;
		jumpNumber += 1;
		const sourceJumpNode: CanvasNode = {
			id: sourceJumpId,
			type: 'text',
			text: jumpLabel,
			x: sourceNode.x + 260,
			y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
			width: 160,
			height: 72,
		};
		const resumeJumpNode: CanvasNode = {
			id: resumeJumpId,
			type: 'text',
			text: jumpLabel,
			x: Math.max(sourceJumpNode.x + 260, Math.min(...xs) - 240),
			y: sourceJumpNode.y,
			width: 160,
			height: 72,
		};
		nextNodes.push(sourceJumpNode, resumeJumpNode);
		nextEdges.push({
			id: createEdgeId(`${sourceNodeId}:${sourceJumpId}`),
			fromNode: sourceNodeId,
			fromSide: 'right',
			toNode: sourceJumpId,
			toSide: 'left',
		});

		for (const edge of outgoing) {
			removedEdgeIds.add(edge.id);
			nextEdges.push({
				id: createEdgeId(`${resumeJumpId}:${edge.toNode}`),
				fromNode: resumeJumpId,
				fromSide: 'right',
				toNode: edge.toNode,
				toSide: edge.toSide,
			});
		}
	}

	if (nextNodes.length === 0) {
		return;
	}

	context.nodes = [...context.nodes, ...nextNodes];
	context.edges = [...context.edges.filter((edge) => !removedEdgeIds.has(edge.id)), ...nextEdges];
}

async function writeCanvasPlan(
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

async function updateCanvasBacklinks(app: App, files: TFile[], outputCanvasPath: string): Promise<void> {
	const canvasFileName = outputCanvasPath.split('/').pop();
	if (!canvasFileName) {
		return;
	}

	for (const file of files) {
		await app.vault.process(file, (content) => ensureCanvasFrontmatterLink(content, canvasFileName));
	}
}

function ensureCanvasFrontmatterLink(content: string, canvasFileName: string): string {
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

async function readDialogueDocuments(app: App, projectRoot: TFolder): Promise<MarkdownDocument[]> {
	const documents: MarkdownDocument[] = [];
	for (const dialogueType of DIALOGUE_TYPES) {
		const folderPath = normalizePath(`${projectRoot.path}/${dialogueType}`);
		const folder = app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) {
			continue;
		}

		documents.push(...(await readFolderMarkdownDocuments(app, folder)));
	}

	return documents;
}

async function readFolderMarkdownDocuments(app: App, folder: TFolder): Promise<MarkdownDocument[]> {
	const files = collectMarkdownFiles(folder);
	files.sort((left, right) => left.path.localeCompare(right.path));
	return Promise.all(files.map((file) => readMarkdownDocument(app, file)));
}

function collectMarkdownFiles(folder: TFolder): TFile[] {
	const files: TFile[] = [];
	for (const child of folder.children) {
		if (child instanceof TFile && child.extension === 'md') {
			files.push(child);
			continue;
		}

		if (child instanceof TFolder) {
			files.push(...collectMarkdownFiles(child));
		}
	}
	return files;
}

async function readMarkdownDocument(app: App, file: TFile): Promise<MarkdownDocument> {
	const content = await app.vault.read(file);
	const { frontmatter, body } = splitFrontmatter(content);
	return {
		file,
		frontmatter: parseStructuredFrontmatter(frontmatter),
		body: body.trim(),
	};
}

function parseStructuredFrontmatter(frontmatter: string): Record<string, FrontmatterValue> {
	if (frontmatter.length === 0) {
		return {};
	}

	const rawLines = frontmatter
		.replace(/^---\n/, '')
		.replace(/\n---\n?$/, '')
		.split('\n');
	const parsed: Record<string, FrontmatterValue> = {};

	for (let index = 0; index < rawLines.length; index += 1) {
		const line = rawLines[index] ?? '';
		if (!/^\S.*?:/.test(line)) {
			continue;
		}

		const separator = line.indexOf(':');
		const key = line.slice(0, separator).trim();
		const rawValue = line.slice(separator + 1).trim();

		if (rawValue === '|' || rawValue === '|-') {
			const multiline: string[] = [];
			let nextIndex = index + 1;
			while (nextIndex < rawLines.length && /^\s+/.test(rawLines[nextIndex] ?? '')) {
				multiline.push((rawLines[nextIndex] ?? '').replace(/^\s{2}/, ''));
				nextIndex += 1;
			}
			parsed[key] = multiline.join('\n').trimEnd();
			index = nextIndex - 1;
			continue;
		}

		if (rawValue.length === 0) {
			const arrayValues: string[] = [];
			let nextIndex = index + 1;
			while (nextIndex < rawLines.length && /^\s*-\s+/.test(rawLines[nextIndex] ?? '')) {
				arrayValues.push(stripQuotes((rawLines[nextIndex] ?? '').replace(/^\s*-\s+/, '').trim()));
				nextIndex += 1;
			}

			parsed[key] = arrayValues.length > 0 ? arrayValues : '';
			index = nextIndex - 1;
			continue;
		}

		parsed[key] = stripQuotes(rawValue);
	}

	return parsed;
}

function resolveJournalQuestFolder(folder: TFolder, projectRoot: TFolder): TFolder | null {
	if (folder.parent?.path === normalizePath(`${projectRoot.path}/${JOURNAL_FOLDER_NAME}`)) {
		return folder;
	}

	let current: TFolder | null = folder;
	while (current !== null && current.path.startsWith(`${projectRoot.path}/${JOURNAL_FOLDER_NAME}/`)) {
		if (current.parent?.path === normalizePath(`${projectRoot.path}/${JOURNAL_FOLDER_NAME}`)) {
			return current;
		}
		current = current.parent;
	}

	return null;
}

function getImmediateChildFolders(root: TFolder, childFolderName: string): TFolder[] {
	const target = root.children.find(
		(child): child is TFolder => child instanceof TFolder && child.name === childFolderName,
	);
	if (!target) {
		return [];
	}

	return target.children.filter((child): child is TFolder => child instanceof TFolder);
}

function extractQuestTitle(documents: MarkdownDocument[]): string | null {
	const questNameDocument = documents.find((document) => isQuestNameNote(document));
	if (!questNameDocument) {
		return null;
	}

	const firstLine = firstNonEmptyLine(questNameDocument.body);
	if (!firstLine) {
		return null;
	}

	return stripBlockId(firstLine);
}

function isQuestNameNote(document: MarkdownDocument): boolean {
	return (
		getStringValue(document.frontmatter, 'Type') === 'Journal'
			&& getStringValue(document.frontmatter, QUEST_NAME_FIELD)?.toLowerCase() === 'true'
	);
}

function toJournalMilestone(document: MarkdownDocument): JournalMilestone | null {
	if (getStringValue(document.frontmatter, 'Type') !== 'Journal') {
		return null;
	}

	const questId = getStringValue(document.frontmatter, 'Topic');
	const indexValue = getStringValue(document.frontmatter, 'Index');
	if (!questId || !indexValue) {
		return null;
	}

	const index = Number.parseInt(indexValue, 10);
	if (!Number.isFinite(index)) {
		return null;
	}

	return {
		id: createNodeId(`milestone:${document.file.path}`),
		questId,
		questTitle: extractQuestTitle([document]) ?? questId,
		index,
		file: document.file,
		summary: firstSentence(document.body),
	};
}

function toDialogueRecord(
	document: MarkdownDocument,
	questIds: string[],
	phaseIndices: number[],
): DialogueRecord | null {
	const type = getStringValue(document.frontmatter, 'Type');
	const topic = getStringValue(document.frontmatter, 'Topic');
	if (!type || !topic || !isDialogueType(type)) {
		return null;
	}

	const conditionEntries = parseConditions(document.frontmatter, questIds);
	const resultActions = parseResultActions(getStringValue(document.frontmatter, 'Result') ?? '', questIds);
	const bodyText = document.body.trim();
	const directRelevance =
		conditionEntries.some((condition) => condition.kind === 'journal' && condition.questId && questIds.includes(condition.questId))
			|| resultActions.some((action) => action.kind === 'journal-set' && action.targetQuestId && questIds.includes(action.targetQuestId));

	return {
		id: createNodeId(`record:${document.file.path}`),
		type,
		topic,
		file: document.file,
		diagId: getStringValue(document.frontmatter, 'DiagID') ?? '',
		prevId: getStringValue(document.frontmatter, 'PrevID') ?? '',
		bodyText,
		conditions: conditionEntries,
		speakerConditions: conditionEntries.filter((condition) => condition.kind === 'speaker'),
		nonSpeakerConditions: conditionEntries.filter((condition) => condition.kind !== 'speaker'),
		resultActions,
		resultLines: resultActions.map((action) => action.displayText),
		phaseAnchor: determinePhaseAnchor(conditionEntries, resultActions, phaseIndices),
		directlyRelevant: directRelevance,
		questReferences: uniqueValues([
			...conditionEntries
				.filter((condition) => condition.kind === 'journal' && condition.questId)
				.map((condition) => condition.questId as string),
			...resultActions
				.filter((action) => action.kind === 'journal-set' && action.targetQuestId)
				.map((action) => action.targetQuestId as string),
		]),
		primaryChoiceValue: firstChoiceValue(conditionEntries),
		choiceValues: conditionEntries
			.filter((condition) => condition.kind === 'choice' && condition.choiceValue !== undefined)
			.map((condition) => condition.choiceValue as number),
		choiceTargets: resultActions
			.filter((action) => action.kind === 'choice-set' && action.choiceValue !== undefined)
			.map((action) => action.choiceValue as number),
	};
}

function parseConditions(frontmatter: Record<string, FrontmatterValue>, questIds: string[]): Condition[] {
	const conditions: Condition[] = [];
	const speakerFields: Array<[string, string]> = [
		['Disposition', 'Disposition'],
		['Sex', 'Sex'],
		['Race', 'Race'],
		['Class', 'Class'],
		['Faction', 'Faction'],
		['Rank', 'Rank'],
		['PC Faction', 'PC Faction'],
		['PC Rank', 'PC Rank'],
		['Cell', 'Cell'],
		['ID', 'ID'],
	];

	for (const [field, label] of speakerFields) {
		const value = getStringValue(frontmatter, field);
		if (!value) {
			continue;
		}

		conditions.push({
			kind: 'speaker',
			displayText: `${label} = ${value}`,
		});
	}

	for (let index = 0; index <= 9; index += 1) {
		const rawFunction = getStringValue(frontmatter, `Function${index}`);
		const rawVariable = getStringValue(frontmatter, `Variable${index}`);
		if (!rawVariable) {
			continue;
		}

		const parsedJournal = parseJournalCondition(rawFunction ?? '', rawVariable, questIds);
		if (parsedJournal) {
			conditions.push(parsedJournal);
			continue;
		}

		const parsedChoice = parseChoiceCondition(rawFunction ?? '', rawVariable);
		if (parsedChoice) {
			conditions.push(parsedChoice);
			continue;
		}

		if ((rawFunction ?? '').trim() === 'Item') {
			conditions.push({
				kind: 'item',
				displayText: `Item - ${rawVariable}`,
			});
			continue;
		}

		const prefix = rawFunction && rawFunction !== 'Function' ? `${rawFunction} - ` : '';
		conditions.push({
			kind: 'other',
			displayText: `${prefix}${rawVariable}`,
		});
	}

	return orderConditions(conditions);
}

function parseJournalCondition(rawFunction: string, rawVariable: string, questIds: string[]): Condition | null {
	const isJournalFunction = rawFunction.trim() === 'Journal';
	const matchingQuestId = questIds.find((questId) => rawVariable.includes(questId));
	if (!isJournalFunction && !matchingQuestId) {
		return null;
	}

	const journalMatch = rawVariable.match(/([^\s]+)\s*(<=|>=|=|<|>)\s*(-?\d+)/);
	if (!journalMatch) {
		return {
			kind: 'journal',
			displayText: `Journal - ${rawVariable}`,
			questId: matchingQuestId,
		};
	}

	const journalQuestId = journalMatch[1] ?? matchingQuestId;
	const journalOperator = journalMatch[2] ?? '=';
	const journalValue = journalMatch[3] ?? '0';

	return {
		kind: 'journal',
		displayText: `Journal - ${rawVariable}`,
		questId: journalQuestId,
		operator: journalOperator,
		value: Number.parseInt(journalValue, 10),
	};
}

function parseChoiceCondition(rawFunction: string, rawVariable: string): Condition | null {
	if (rawFunction.trim() !== 'Function' || !/^Choice\s*=\s*-?\d+/i.test(rawVariable)) {
		return null;
	}

	const choiceMatch = rawVariable.match(/Choice\s*=\s*(-?\d+)/i);
	if (!choiceMatch) {
		return null;
	}

	const choiceValue = choiceMatch[1] ?? '0';

	return {
		kind: 'choice',
		displayText: rawVariable,
		choiceValue: Number.parseInt(choiceValue, 10),
	};
}

function parseResultActions(resultText: string, questIds: string[]): ResultAction[] {
	if (resultText.trim().length === 0) {
		return [];
	}

	const actions: ResultAction[] = [];
	const lines = resultText.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
	for (const line of lines) {
		const journalMatch = line.match(/^Journal\s+"?([^"\s]+)"?\s+(-?\d+)/i);
		if (journalMatch) {
			const journalQuestId = journalMatch[1] ?? '';
			const journalIndex = journalMatch[2] ?? '0';
			actions.push({
				kind: 'journal-set',
				displayText: `Journal [[${journalQuestId} ${journalIndex}]]`,
				targetQuestId: journalQuestId,
				targetJournalIndex: Number.parseInt(journalIndex, 10),
			});
			continue;
		}

		if (/^Choice\s+/i.test(line)) {
			for (const choice of parseChoiceResults(line)) {
				actions.push(choice);
			}
			continue;
		}

		const addTopicMatch = line.match(/^AddTopic\s+"([^"]+)"/i);
		if (addTopicMatch) {
			actions.push({
				kind: 'add-topic',
				displayText: `AddTopic "[[${addTopicMatch[1]}]]"`,
				targetTopic: addTopicMatch[1],
			});
			continue;
		}

		if (/^Goodbye$/i.test(line)) {
			actions.push({ kind: 'goodbye', displayText: 'Goodbye' });
			continue;
		}

		if (/^ModDisposition\s+-?\d+/i.test(line)) {
			actions.push({ kind: 'disposition', displayText: line });
			continue;
		}

		actions.push({ kind: 'script', displayText: line });
	}

	return actions;
}

function parseChoiceResults(line: string): ResultAction[] {
	const actions: ResultAction[] = [];
	const choicePattern = /"([^"]+)"\s+(-?\d+)/g;
	let match = choicePattern.exec(line);
	while (match) {
		const choiceLabel = match[1] ?? '';
		const choiceValue = match[2] ?? '0';
		actions.push({
			kind: 'choice-set',
			displayText: `"${choiceLabel}" - Choice ${choiceValue}`,
			choiceValue: Number.parseInt(choiceValue, 10),
		});
		match = choicePattern.exec(line);
	}
	return actions;
}

function resolveChoiceRelevantRecords(allRecords: DialogueRecord[], directRelevant: Set<string>): Set<string> {
	const relevant = new Set<string>();
	const recordsByTopic = groupRecordsByTopic(allRecords);
	let changed = true;

	while (changed) {
		changed = false;
		for (const record of allRecords) {
			if (directRelevant.has(record.id) || relevant.has(record.id)) {
				continue;
			}

			if (record.choiceTargets.length === 0) {
				continue;
			}

			const topicRecords = recordsByTopic.get(record.topic) ?? [];
			const leadsToRelevant = topicRecords.some(
				(candidate) => record.choiceTargets.some((value) => candidate.choiceValues.includes(value))
					&& (directRelevant.has(candidate.id) || relevant.has(candidate.id)),
			);

			if (leadsToRelevant) {
				relevant.add(record.id);
				changed = true;
			}
		}
	}

	return relevant;
}

function resolveImmediateNeighborRecords(allRecords: DialogueRecord[], directRelevant: Set<string>): Set<string> {
	const relevant = new Set<string>();
	const diagMap = new Map<string, DialogueRecord>();
	const nextByPrev = new Map<string, DialogueRecord[]>();

	for (const record of allRecords) {
		if (record.diagId.length > 0) {
			diagMap.set(record.diagId, record);
		}
		if (record.prevId.length > 0) {
			const nextRecords = nextByPrev.get(record.prevId) ?? [];
			nextRecords.push(record);
			nextByPrev.set(record.prevId, nextRecords);
		}
	}

	for (const record of allRecords) {
		if (!directRelevant.has(record.id)) {
			continue;
		}

		const previous = record.prevId ? diagMap.get(record.prevId) : undefined;
		if (previous && !hasForeignQuestReferences(previous)) {
			relevant.add(previous.id);
		}

		const nextRecords = record.diagId ? nextByPrev.get(record.diagId) ?? [] : [];
		for (const nextRecord of nextRecords) {
			if (!hasForeignQuestReferences(nextRecord)) {
				relevant.add(nextRecord.id);
			}
		}
	}

	return relevant;
}

function groupBranchFamilies(records: DialogueRecord[]): BranchFamily[] {
	const familyMap = new Map<string, BranchFamily>();
	for (const record of records) {
		const nonSpeakerKey = normalizeConditionKey(record.nonSpeakerConditions);
		const resultKey = record.resultActions.map((action) => action.displayText).join('|');
		const bodyKey = record.bodyText.trim();
		const familyKey = [record.type, record.topic, record.phaseAnchor, nonSpeakerKey, resultKey, bodyKey].join('::');
		const existing = familyMap.get(familyKey);
		if (existing) {
			existing.records.push(record);
			continue;
		}

		const progressionTarget = firstJournalResult(record.resultActions);
		familyMap.set(familyKey, {
			id: createNodeId(`family:${familyKey}`),
			type: record.type,
			topic: record.topic,
			phaseAnchor: record.phaseAnchor,
			records: [record],
			sharedConditions: record.nonSpeakerConditions,
			results: record.resultActions,
			bodyText: record.bodyText,
			priority: computeFamilyPriority(record.phaseAnchor, progressionTarget, record.resultActions),
			progressionTarget,
		});
	}

	return [...familyMap.values()];
}

function compareBranchFamilies(left: BranchFamily, right: BranchFamily): number {
	return left.priority - right.priority
		|| compareNullableNumbers(left.progressionTarget, right.progressionTarget)
		|| left.topic.localeCompare(right.topic)
		|| left.records[0]?.file.path.localeCompare(right.records[0]?.file.path ?? '')
		|| 0;
}

function compareDialogueRecords(left: DialogueRecord, right: DialogueRecord): number {
	return normalizeConditionKey(left.speakerConditions).localeCompare(normalizeConditionKey(right.speakerConditions))
		|| left.file.path.localeCompare(right.file.path);
}

function determinePhaseAnchor(conditions: Condition[], resultActions: ResultAction[], phaseIndices: number[]): number {
	const journalConditions = conditions.filter((condition) => condition.kind === 'journal' && condition.value !== undefined);
	for (const condition of journalConditions) {
		if (condition.operator === '=' || condition.operator === '>=' || condition.operator === '>') {
			return nearestPhaseAtOrBelow(condition.value as number, phaseIndices);
		}
	}

	const journalResult = firstJournalResult(resultActions);
	if (journalResult !== null) {
		return previousPhaseBefore(journalResult, phaseIndices);
	}

	return phaseIndices[0] ?? 0;
}

function nearestPhaseAtOrBelow(value: number, phaseIndices: number[]): number {
	const eligible = phaseIndices.filter((phaseValue) => phaseValue <= value);
	if (eligible.length > 0) {
		return eligible[eligible.length - 1] ?? phaseIndices[0] ?? value;
	}
	return phaseIndices[0] ?? value;
}

function previousPhaseBefore(value: number, phaseIndices: number[]): number {
	const lower = phaseIndices.filter((phaseValue) => phaseValue < value);
	if (lower.length > 0) {
		return lower[lower.length - 1] ?? phaseIndices[0] ?? value;
	}
	return phaseIndices[0] ?? value;
}

function computeFamilyPriority(phaseAnchor: number, progressionTarget: number | null, resultActions: ResultAction[]): number {
	if (progressionTarget !== null && progressionTarget > phaseAnchor) {
		return 0;
	}
	if (resultActions.some((action) => action.kind === 'choice-set')) {
		return 1;
	}
	if (progressionTarget !== null && progressionTarget <= phaseAnchor) {
		return 3;
	}
	return 2;
}

function firstJournalResult(resultActions: ResultAction[]): number | null {
	for (const action of resultActions) {
		if (action.kind === 'journal-set' && action.targetJournalIndex !== undefined) {
			return action.targetJournalIndex;
		}
	}
	return null;
}

function addFileNode(
	context: CanvasLayoutContext,
	seed: string,
	filePath: string,
	x: number,
	y: number,
	width: number,
	height: number,
	color: string,
): string {
	const nodeId = createNodeId(seed);
	if (!context.nodeIds.has(nodeId)) {
		context.nodes.push({
			id: nodeId,
			type: 'file',
			file: filePath,
			x,
			y,
			width,
			height,
			color,
		});
		context.nodeIds.add(nodeId);
	}
	return nodeId;
}

function addTextNode(
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
			height: measureTextHeight(text),
			color,
		});
		context.nodeIds.add(nodeId);
	}
	return nodeId;
}

function addEdge(
	context: CanvasLayoutContext,
	seed: string,
	fromNode: string,
	fromSide: 'left' | 'right' | 'top' | 'bottom',
	toNode: string,
	toSide: 'left' | 'right' | 'top' | 'bottom',
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
	});
	context.edgeIds.add(edgeId);
}

function renderConditionBlock(conditions: Condition[]): string {
	return conditions.map((condition) => condition.displayText).join('\n');
}

function orderConditions(conditions: Condition[]): Condition[] {
	const order = [
		'Disposition',
		'Sex',
		'Race',
		'Class',
		'Faction',
		'Rank',
		'PC Faction',
		'PC Rank',
		'Cell',
		'ID',
	];
	return [...conditions].sort((left, right) => {
		const leftLabel = left.displayText.split(' = ')[0] ?? left.displayText;
		const rightLabel = right.displayText.split(' = ')[0] ?? right.displayText;
		const leftIndex = order.indexOf(leftLabel);
		const rightIndex = order.indexOf(rightLabel);
		if (leftIndex !== rightIndex) {
			return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex)
				- (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
		}
		return left.displayText.localeCompare(right.displayText);
	});
}

function groupRecordsByTopic(records: DialogueRecord[]): Map<string, DialogueRecord[]> {
	const grouped = new Map<string, DialogueRecord[]>();
	for (const record of records) {
		const topicRecords = grouped.get(record.topic) ?? [];
		topicRecords.push(record);
		grouped.set(record.topic, topicRecords);
	}
	return grouped;
}

function firstChoiceValue(conditions: Condition[]): number | null {
	const choiceValues = conditions
		.filter((condition) => condition.kind === 'choice' && condition.choiceValue !== undefined)
		.map((condition) => condition.choiceValue as number);
	if (choiceValues.length === 0) {
		return null;
	}
	return Math.min(...choiceValues);
}

function hasForeignQuestReferences(record: DialogueRecord): boolean {
	return record.questReferences.length > 0 && !record.directlyRelevant;
}

function containsJournalLine(lines: string[]): boolean {
	return lines.some((line) => line.startsWith('Journal [['));
}

function buildCenteredOffsets(count: number, gap: number): number[] {
	const offsets: number[] = [];
	for (let index = 0; index < count; index += 1) {
		if (index === 0) {
			offsets.push(0);
			continue;
		}

		const level = Math.ceil(index / 2);
		const direction = index % 2 === 1 ? -1 : 1;
		offsets.push(level * gap * direction);
	}
	return offsets;
}

function incrementPhaseCount(target: Map<number, number>, phaseValue: number): void {
	target.set(phaseValue, (target.get(phaseValue) ?? 0) + 1);
}

function ensureFolder(app: App, folderPath: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(folderPath);
	if (existing instanceof TFolder) {
		return Promise.resolve();
	}
	if (existing instanceof TFile) {
		return Promise.reject(new Error(`'${folderPath}' already exists and is not a folder.`));
	}
	return app.vault.createFolder(folderPath).then(() => undefined);
}

function firstSentence(text: string): string {
	const line = firstNonEmptyLine(text);
	if (!line) {
		return '';
	}

	const sentenceMatch = stripBlockId(line).match(/^(.+?[.!?])(?:\s|$)/);
	return sentenceMatch?.[1] ?? stripBlockId(line);
}

function firstNonEmptyLine(text: string): string | null {
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	return null;
}

function stripBlockId(text: string): string {
	return text.replace(/\s+\^[A-Za-z0-9_-]+$/, '').trim();
}

function normalizeQuestNameKey(text: string | null): string | null {
	if (!text) {
		return null;
	}

	const normalized = stripBlockId(text)
		.toLowerCase()
		.replace(/\[\[|\]\]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizeConditionKey(conditions: Condition[]): string {
	return conditions.map((condition) => condition.displayText).sort().join('|');
}

function sanitizeFileName(input: string): string {
	const sanitized = [...input]
		.map((character) => {
			const reserved = '<>:"/\\|?*'.includes(character);
			const control = character.charCodeAt(0) < 32;
			return reserved || control ? '_' : character;
		})
		.join('')
		.replace(/[. ]+$/g, '')
		.trim();
	return sanitized.length > 0 ? sanitized : 'quest';
}

function stripQuotes(text: string): string {
	return text.replace(/^"|"$/g, '');
}

function getStringValue(frontmatter: Record<string, FrontmatterValue>, key: string): string | undefined {
	const value = frontmatter[key];
	if (typeof value === 'string') {
		return value;
	}
	if (Array.isArray(value)) {
		return value[0];
	}
	return undefined;
}

function isDialogueType(value: string): value is DialogueType {
	return DIALOGUE_TYPES.includes(value as DialogueType);
}

function uniqueValues(values: string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const value of values) {
		const normalized = value.trim().toLowerCase();
		if (normalized.length === 0 || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		unique.push(value.trim());
	}
	return unique;
}

function uniqueNumbers(values: number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function compareNullableNumbers(left: number | null, right: number | null): number {
	if (left === null && right === null) {
		return 0;
	}
	if (left === null) {
		return 1;
	}
	if (right === null) {
		return -1;
	}
	return left - right;
}

function measureTextHeight(text: string): number {
	const lineCount = Math.max(1, text.split('\n').length);
	return Math.max(50, 26 + lineCount * 24);
}

function createNodeId(seed: string): string {
	return stableHash(seed);
}

function createEdgeId(seed: string): string {
	return stableHash(`edge:${seed}`);
}

function stableHash(value: string): string {
	let left = 0x811c9dc5;
	let right = 0x01000193;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		left ^= code;
		left = Math.imul(left, 0x01000193);
		right ^= code;
		right = Math.imul(right, 0x27d4eb2d);
	}
	const leftHex = (left >>> 0).toString(16).padStart(8, '0');
	const rightHex = (right >>> 0).toString(16).padStart(8, '0');
	return `${leftHex}${rightHex}`;
}

void KNOWN_FRONTMATTER_KEYS;

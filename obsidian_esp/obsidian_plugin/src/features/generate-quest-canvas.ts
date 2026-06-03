import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { PathManager } from './path-manager';
import { selectVaultFolder } from '../ui/folder-suggest-modal';
import { ProgressBar } from '../ui/progress-bar';
import { splitFrontmatter } from '../utils/obsidian-utils';

const DIALOGUE_TYPES = ['Greeting', 'Topic', 'Persuasion', 'Voice'] as const;
const CANVAS_BODY_BLOCK_TYPES = new Set(['Journal', 'Greeting', 'Topic']);
const CANVAS_BODY_BLOCK_PREFIX = 'obsidian-esp-canvas';
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
const JOURNAL_WIDTH = 440;
const FILE_NODE_MIN_HEIGHT = 96;
const FILE_NODE_PADDING_Y = 40;
const TEXT_NODE_HORIZONTAL_PADDING = 48;
const APPROX_TEXT_CHAR_WIDTH = 8;
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
const FOLLOWUP_GROUP_GAP_X = 700;
const CLUSTER_GAP_Y = 140;
const FINAL_NODE_GAP_Y = 24;
const JUMP_FANOUT_THRESHOLD = 4;
const JUMP_SPAN_THRESHOLD_Y = 900;
const PRE_JOURNAL_PHASE = 0;
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
	canvasBodySubpath: string | null;
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
	canvasSubpath: string | null;
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
	canvasSubpath: string | null;
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
	conditionQuestReferences: string[];
	resultQuestReferences: string[];
	ownedQuestReferences: string[];
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

interface ChoiceGroup {
	choiceValue: number | null;
	families: BranchFamily[];
}

interface ChoiceAnchor {
	choiceValue: number;
	nodeId: string;
	x: number;
	y: number;
}

interface ChoiceAnchorGroup {
	choiceValue: number;
	nodeIds: string[];
	x: number;
	y: number;
}

interface TopicLayoutResult {
	rootEntryIds: string[];
	topY: number;
	bottomY: number;
	mainLaneCenterY: number;
	nodeIds: string[];
}

interface PhaseTopicSegment {
	topic: string;
	families: BranchFamily[];
}

interface PhaseGraph {
	orderedPhases: number[];
	familiesByPhase: Map<number, BranchFamily[]>;
	segmentsByPhase: Map<number, PhaseTopicSegment[]>;
	incomingTransitions: Map<number, Set<number>>;
	outgoingTransitions: Map<number, Set<number>>;
	mainTargets: Map<number, number | null>;
}

interface PhasePlacement {
	topY: number;
	bottomY: number;
	mainLaneCenterY: number;
}

interface TopicChoiceResolutionSummary {
	choiceValue: number;
	sourceRecordPaths: string[];
	entryRecordPaths: string[];
}

interface TopicDebugSummary {
	segmentIndex: number;
	topic: string;
	mainLaneCenterY: number | null;
	familyOrder: Array<{
		priority: number;
		progressionTarget: number | null;
		primaryChoiceValue: number | null;
		choiceTargets: number[];
		recordPaths: string[];
	}>;
	rootChoices: Array<number | null>;
	choiceResolutions: TopicChoiceResolutionSummary[];
}

interface PhaseDebugSummary {
	phaseValue: number;
	orderIndex: number;
	x: number;
	milestoneY: number | null;
	incoming: number[];
	outgoing: number[];
	mainTarget: number | null;
	phaseTopY: number | null;
	phaseBottomY: number | null;
	mainLaneCenterY: number | null;
	topics: TopicDebugSummary[];
}

interface PhaseGraphDebugSummary {
	questTitle: string;
	phases: PhaseDebugSummary[];
}

interface CanvasNode {
	id: string;
	type: 'file' | 'text';
	file?: string;
	subpath?: string;
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
	fileNodeTargets: FileNodeTarget[];
	warnings: string[];
	phaseGraphSummary: PhaseGraphDebugSummary;
}

interface FileNodeTarget {
	file: TFile;
	subpath: string;
}

interface QuestCanvasGenerationOptions {
	writePhaseGraphDebug?: boolean;
}

interface CanvasLayoutContext {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	relatedFiles: Map<string, TFile>;
	fileBodyTextByPath: Map<string, string>;
	phaseNodeIds: Map<number, string>;
	topicHeaderIds: Map<string, string>;
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

export async function generateQuestCanvasDebugFromVaultFolder(app: App): Promise<void> {
	const folder = await selectVaultFolder(app);
	if (!folder) {
		return;
	}

	await generateQuestCanvasForFolder(app, folder, { writePhaseGraphDebug: true });
}

export function canGenerateQuestCanvasFromFolder(folder: TFolder): boolean {
	return folder.parent?.name === JOURNAL_FOLDER_NAME;
}

export async function generateQuestCanvasForFolder(
	app: App,
	folder: TFolder,
	options: QuestCanvasGenerationOptions = {},
): Promise<void> {
	const progress = new ProgressBar('Generating quest canvas');
	try {
		progress.update(5, 'Checking the selected folder');
		const scope = await discoverQuestScope(app, folder);
		progress.update(25, `Resolving dialogue for ${scope.questTitle}`);
		const buildResult = await buildQuestCanvas(app, scope);
		if (options.writePhaseGraphDebug) {
			progress.update(70, 'Writing phase graph summary');
			await writePhaseGraphSummary(app, scope.outputCanvasPath, buildResult.phaseGraphSummary);
		}
		progress.update(80, 'Writing canvas and backlinks');
		await writeCanvasPlan(app, scope.outputCanvasPath, buildResult.nodes, buildResult.edges);
		await updateCanvasLinksAndBodyBlocks(
			app,
			buildResult.relatedFiles,
			buildResult.fileNodeTargets,
			scope.outputCanvasPath,
		);

		const warningSuffix =
			buildResult.warnings.length > 0
				? ` ${buildResult.warnings[0]}`
				: '';
		const debugSuffix = options.writePhaseGraphDebug ? ' Wrote a phase graph summary JSON alongside the canvas.' : '';
		new Notice(`Generated ${scope.questTitle}.canvas.${warningSuffix}${debugSuffix}`);
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

	const effectiveOwnership = resolveEffectiveQuestOwnership(allRecords);
	const directRelevant = new Set(
		allRecords
			.filter((record) => (effectiveOwnership.get(record.id) ?? []).some((questId) => scope.questIds.includes(questId)))
			.map((record) => record.id),
	);
	const relevantRecordIds = resolvePropagatedRelevantRecords(allRecords, directRelevant, scope.questIds);
	const relevantRecords = allRecords.filter(
		(record) => relevantRecordIds.has(record.id)
			&& (effectiveOwnership.get(record.id) ?? []).some((questId) => scope.questIds.includes(questId))
			&& !hasJournalResultsForOtherQuests(record, scope.questIds),
	);

	if (relevantRecords.length === 0) {
		throw new Error('No quest-relevant dialogue notes were found for the selected journal folder.');
	}

	const milestoneIndices = uniqueNumbers(scope.journalMilestones.map((milestone) => milestone.index).filter((index) => index > 0));
	const phaseIndices = milestoneIndices.length > 0 ? milestoneIndices : uniqueNumbers(scope.journalMilestones.map((milestone) => milestone.index));
	const scopedRelevantRecords = relevantRecords.map((record) => ({
		...record,
		phaseAnchor: determinePhaseAnchor(record.conditions, record.resultActions, phaseIndices, scope.questIds),
	}));
	const families = groupBranchFamilies(scopedRelevantRecords, scope.questIds);
	const warnings: string[] = [];
	const canvasContext = createCanvasLayoutContext();
	for (const document of scope.journalDocuments) {
		canvasContext.fileBodyTextByPath.set(document.file.path, document.body);
	}
	for (const document of dialogueDocuments) {
		canvasContext.fileBodyTextByPath.set(document.file.path, document.body);
	}
	const phaseGraph = buildPhaseGraph(phaseIndices, families);
	const phaseXPositions = new Map<number, number>();
	const phasePlacements = new Map<number, PhasePlacement>();
	const topicPlacements = new Map<string, TopicLayoutResult>();

	const milestonesByPhase = new Map<number, JournalMilestone[]>();
	for (const milestone of scope.journalMilestones) {
		if (milestone.index <= 0) {
			continue;
		}
		const phaseMilestones = milestonesByPhase.get(milestone.index) ?? [];
		phaseMilestones.push(milestone);
		milestonesByPhase.set(milestone.index, phaseMilestones);
	}

	const computedPhasePositions = computePhasePositions(phaseGraph.orderedPhases, phaseGraph.segmentsByPhase);
	for (const [phaseValue, phaseX] of computedPhasePositions) {
		phaseXPositions.set(phaseValue, phaseX);
		const phaseMilestones = milestonesByPhase.get(phaseValue) ?? [];
		const phaseMilestone = phaseMilestones[0];
		if (!phaseMilestone) {
			continue;
		}
		addPhaseMilestone(canvasContext, phaseValue, phaseMilestone, phaseX);
	}

	for (let phaseIndex = 0; phaseIndex < phaseGraph.orderedPhases.length; phaseIndex += 1) {
		const phaseValue = phaseGraph.orderedPhases[phaseIndex] ?? 0;
		const phaseX = phaseXPositions.get(phaseValue) ?? 0;
		const phaseMilestones = milestonesByPhase.get(phaseValue) ?? [];
		const phaseMilestone = phaseMilestones[0];
		const milestoneNodeId = phaseMilestone
			? contextPhaseNodeId(canvasContext, phaseValue)
			: undefined;
		const phaseSegments = phaseGraph.segmentsByPhase.get(phaseValue) ?? [];
		let topicSegmentIndex = 0;
		let phaseTopY = Number.POSITIVE_INFINITY;
		let phaseBottomY = Number.NEGATIVE_INFINITY;
		const phaseCenters: number[] = [];
		for (const segment of phaseSegments) {
			const topicBaseX = phaseX + GATE_GAP_X + topicSegmentIndex * TOPIC_SEGMENT_GAP_X;
			const topicLayout = layoutTopicFamilies(
				canvasContext,
				segment.families,
				phaseValue,
				topicBaseX,
				scope.journalMilestones,
			);
			const segmentKey = phaseTopicSegmentKey(phaseValue, topicSegmentIndex, segment.topic);
			topicPlacements.set(segmentKey, topicLayout);

			if (topicLayout.rootEntryIds.length > 0) {
				const headerId = addTopicHeader(
					canvasContext,
					segmentKey,
					segment.topic,
					topicBaseX - 340,
					topicLayout.topY - HEADER_Y_OFFSET,
				);
				if (milestoneNodeId) {
					addEdge(canvasContext, `${milestoneNodeId}:${headerId}`, milestoneNodeId, 'right', headerId, 'left');
				}
				for (const entryId of topicLayout.rootEntryIds) {
					addEdge(canvasContext, `${headerId}:${entryId}`, headerId, 'right', entryId, 'left');
				}
			}
			if (Number.isFinite(topicLayout.topY) && Number.isFinite(topicLayout.bottomY)) {
				phaseTopY = Math.min(phaseTopY, topicLayout.topY);
				phaseBottomY = Math.max(phaseBottomY, topicLayout.bottomY);
				phaseCenters.push(topicLayout.mainLaneCenterY);
			}

			topicSegmentIndex += 1;
		}
		const phaseCenterY = phaseCenters.length > 0
			? Math.round(phaseCenters.reduce((sum, value) => sum + value, 0) / phaseCenters.length)
			: 0;
		if (milestoneNodeId) {
			centerPhaseMilestone(canvasContext, phaseValue, phaseCenterY);
		}
		phasePlacements.set(phaseValue, {
			topY: Number.isFinite(phaseTopY) ? phaseTopY : phaseCenterY,
			bottomY: Number.isFinite(phaseBottomY) ? phaseBottomY : phaseCenterY,
			mainLaneCenterY: phaseCenterY,
		});
	}

	connectScriptedMilestones(canvasContext, phaseGraph.orderedPhases);
	insertJumpNodes(canvasContext);
	resolveCanvasNodeOverlaps(canvasContext);

	const relatedFiles = new Map<string, TFile>();
	const fileNodeTargets = new Map<string, FileNodeTarget>();
	for (const milestone of scope.journalDocuments) {
		relatedFiles.set(milestone.file.path, milestone.file);
	}
	for (const record of scopedRelevantRecords) {
		relatedFiles.set(record.file.path, record.file);
	}
	for (const milestone of scope.journalMilestones) {
		if (!milestone.canvasSubpath) {
			continue;
		}

		fileNodeTargets.set(milestone.file.path, {
			file: milestone.file,
			subpath: milestone.canvasSubpath,
		});
	}
	for (const record of scopedRelevantRecords) {
		if (!record.canvasSubpath) {
			continue;
		}

		fileNodeTargets.set(record.file.path, {
			file: record.file,
			subpath: record.canvasSubpath,
		});
	}

	return {
		nodes: canvasContext.nodes,
		edges: canvasContext.edges,
		relatedFiles: [...relatedFiles.values()].sort((left, right) => left.path.localeCompare(right.path)),
		fileNodeTargets: [...fileNodeTargets.values()].sort((left, right) => left.file.path.localeCompare(right.file.path)),
		warnings,
		phaseGraphSummary: buildPhaseGraphDebugSummary(
			scope.questTitle,
			phaseGraph,
			phaseXPositions,
			canvasContext,
			phasePlacements,
			topicPlacements,
		),
	};
}

function createCanvasLayoutContext(): CanvasLayoutContext {
	return {
		nodes: [],
		edges: [],
		relatedFiles: new Map<string, TFile>(),
		fileBodyTextByPath: new Map<string, string>(),
		phaseNodeIds: new Map<number, string>(),
		topicHeaderIds: new Map<string, string>(),
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

function centerPhaseMilestone(context: CanvasLayoutContext, phaseValue: number, centerY: number): void {
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
): { firstEntryId: string; nextY: number; choiceAnchors: ChoiceAnchor[] } {
	const familyRecords = [...family.records].sort(compareDialogueRecords);
	const familyChoiceActions = family.results.filter((action) => action.kind === 'choice-set');
	const choiceNodeIds = new Map<number, string>();
	const choiceAnchors: ChoiceAnchor[] = [];
	let currentY = startY;
	let firstEntryId = '';
	let choiceCursorY = startY;

	for (let recordIndex = 0; recordIndex < familyRecords.length; recordIndex += 1) {
		const record = familyRecords[recordIndex];
		if (!record) {
			continue;
		}

		const gateText = renderConditionBlock(record.conditions);
		const gateHeight = gateText.length > 0 ? measureTextHeight(gateText, GATE_WIDTH) : 0;
		const dialogueHeight = measureCanvasBodyHeight(record.bodyText, DIALOGUE_WIDTH);
		const localResultLines = record.resultActions
			.filter((action) => action.kind !== 'choice-set')
			.map((action) => renderResultAction(action, allMilestones));
		const localResultHeight = localResultLines.length > 0 ? measureTextHeight(localResultLines.join('\n'), DIALOGUE_WIDTH) + RESULT_GAP_Y : 0;
		const clusterHeight = Math.max(gateHeight, dialogueHeight) + localResultHeight + CLUSTER_GAP_Y;
		const recordY = currentY;
		const dialogueId = addFileNode(
			context,
			`dialogue:${record.file.path}`,
			record.file.path,
			dialogueX,
			recordY,
			DIALOGUE_WIDTH,
			dialogueHeight,
			DIALOGUE_COLOR,
			record.canvasSubpath,
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
				recordY + dialogueHeight + RESULT_GAP_Y,
				DIALOGUE_WIDTH,
				containsJournalLine(localResultLines) ? JOURNAL_COLOR : RESULT_COLOR,
			);
			addEdge(context, `${dialogueId}:${resultId}`, dialogueId, 'bottom', resultId, 'top');
		}

		for (const action of record.resultActions) {
			if (action.kind !== 'journal-set' || action.targetJournalIndex === undefined) {
				continue;
			}

			const targetMilestone = resolveJournalResultMilestone(action, allMilestones);
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
				const choiceHeight = measureTextHeight(choiceAction.displayText, CHOICE_WIDTH);
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
				choiceAnchors.push({
					choiceValue: choiceAction.choiceValue,
					nodeId: choiceNodeId,
					x: choiceX,
					y: Math.round(choiceCursorY + choiceHeight / 2),
				});
				choiceCursorY += choiceHeight + 24;
			}

			addEdge(context, `${dialogueId}:${choiceNodeId}`, dialogueId, 'right', choiceNodeId, 'left');
		}

		currentY += clusterHeight;
	}

	return {
		firstEntryId,
		nextY: currentY,
		choiceAnchors,
	};
}

function layoutTopicFamilies(
	context: CanvasLayoutContext,
	families: BranchFamily[],
	phaseValue: number,
	topicBaseX: number,
	allMilestones: JournalMilestone[],
): TopicLayoutResult {
	const choiceGroups = groupFamiliesByPrimaryChoice(families);
	if (choiceGroups.length === 0) {
		return { rootEntryIds: [], topY: 0, bottomY: 0, mainLaneCenterY: 0, nodeIds: [] };
	}

	const groupsByChoice = mapChoiceGroupsByChoice(choiceGroups);
	let rootGroups = resolveRootChoiceGroups(choiceGroups);
	if (rootGroups.length === 0) {
		rootGroups = [...choiceGroups];
	}
	rootGroups = orderChoiceGroupsForLanes(rootGroups, phaseValue);

	const renderedGroupLayouts = new Map<string, TopicLayoutResult>();
	const renderingGroups = new Set<string>();
	const rootEntryIds: string[] = [];
	let topicTopY = Number.POSITIVE_INFINITY;
	let topicBottomY = Number.NEGATIVE_INFINITY;

	const renderChoiceGroup = (group: ChoiceGroup, gateX: number, startY: number): TopicLayoutResult => {
		const groupKey = choiceGroupKey(group.choiceValue);
		const cachedLayout = renderedGroupLayouts.get(groupKey);
		if (cachedLayout) {
			return cachedLayout;
		}
		if (renderingGroups.has(groupKey)) {
			return { rootEntryIds: [], topY: startY, bottomY: startY, mainLaneCenterY: startY, nodeIds: [] };
		}
		renderingGroups.add(groupKey);
		const renderedNodeCount = context.nodes.length;

		const dialogueX = gateX + (DIALOGUE_GAP_X - GATE_GAP_X);
		const choiceX = dialogueX + (CHOICE_GAP_X - DIALOGUE_GAP_X);
		let currentY = startY;
		let groupTopY = startY;
		let groupBottomY = startY;
		let localTopY = startY;
		let localBottomY = startY;
		const localEntryIds: string[] = [];
		const emittedAnchors: ChoiceAnchor[] = [];
		const childLayouts: TopicLayoutResult[] = [];

		for (const family of [...group.families].sort(compareBranchFamilies)) {
			const familyLayout = layoutBranchFamily(
				context,
				family,
				phaseValue,
				gateX,
				dialogueX,
				choiceX,
				currentY,
				allMilestones,
			);
			localEntryIds.push(familyLayout.firstEntryId);
			emittedAnchors.push(...familyLayout.choiceAnchors);
			groupBottomY = Math.max(groupBottomY, familyLayout.nextY);
			localBottomY = Math.max(localBottomY, familyLayout.nextY);
			currentY = familyLayout.nextY;
		}

		const mainLaneBottomY = Math.max(groupTopY, groupBottomY - CLUSTER_GAP_Y);
		const mainLaneCenterY = Math.round((groupTopY + mainLaneBottomY) / 2);
		const mainColumnTopY = localTopY;
		const mainColumnBottomY = localBottomY;
		for (const anchor of collapseChoiceAnchors(emittedAnchors).sort((left, right) => left.y - right.y || left.choiceValue - right.choiceValue)) {
			const childGroup = groupsByChoice.get(choiceGroupKey(anchor.choiceValue));
			if (!childGroup) {
				continue;
			}

			const childHeight = estimateChoiceColumnHeight(childGroup.families);
			const childStartY = Math.round(anchor.y - childHeight / 2);
			const childLayout = renderChoiceGroup(
				childGroup,
				anchor.x + FOLLOWUP_GROUP_GAP_X,
				childStartY,
			);
			for (const anchorNodeId of anchor.nodeIds) {
				for (const entryId of childLayout.rootEntryIds) {
					addEdge(
						context,
						`${anchorNodeId}:${entryId}:${anchor.choiceValue}`,
						anchorNodeId,
						'right',
						entryId,
						'left',
					);
				}
			}
			childLayouts.push(childLayout);
		}

		pushDownOverlappingLayouts(context, childLayouts, LANE_GAP_Y);
		localTopY = mainColumnTopY;
		localBottomY = mainColumnBottomY;
		for (const childLayout of childLayouts) {
			localTopY = Math.min(localTopY, childLayout.topY);
			localBottomY = Math.max(localBottomY, childLayout.bottomY);
		}

		topicTopY = Math.min(topicTopY, localTopY);
		topicBottomY = Math.max(topicBottomY, localBottomY);

		const layout = {
			rootEntryIds: localEntryIds,
			topY: localTopY,
			bottomY: localBottomY,
			mainLaneCenterY,
			nodeIds: context.nodes.slice(renderedNodeCount).map((node) => node.id),
		};
		renderedGroupLayouts.set(groupKey, layout);
		renderingGroups.delete(groupKey);
		return layout;
	};

	const rootStartYs = buildCenteredGroupStartYs(rootGroups);
	const rootLayouts: TopicLayoutResult[] = [];
	for (let rootIndex = 0; rootIndex < rootGroups.length; rootIndex += 1) {
		const rootGroup = rootGroups[rootIndex];
		if (!rootGroup) {
			continue;
		}
		const rootLayout = renderChoiceGroup(rootGroup, topicBaseX, rootStartYs[rootIndex] ?? 0);
		rootEntryIds.push(...rootLayout.rootEntryIds);
		rootLayouts.push(rootLayout);
	}
	pushDownOverlappingLayouts(context, rootLayouts, LANE_GAP_Y);
	topicTopY = Number.POSITIVE_INFINITY;
	topicBottomY = Number.NEGATIVE_INFINITY;
	for (const rootLayout of rootLayouts) {
		topicTopY = Math.min(topicTopY, rootLayout.topY);
		topicBottomY = Math.max(topicBottomY, rootLayout.bottomY);
	}

	let nextFallbackY = Number.isFinite(topicBottomY) ? topicBottomY + LANE_GAP_Y : 0;
	for (const group of orderChoiceGroupsForLanes(choiceGroups, phaseValue)) {
		if (renderedGroupLayouts.has(choiceGroupKey(group.choiceValue))) {
			continue;
		}

		const fallbackLayout = renderChoiceGroup(group, topicBaseX, nextFallbackY);
		rootEntryIds.push(...fallbackLayout.rootEntryIds);
		rootLayouts.push(fallbackLayout);
		nextFallbackY = fallbackLayout.bottomY + LANE_GAP_Y;
	}

	const mainLaneCenterY = rootLayouts[0]?.mainLaneCenterY ?? 0;
	return {
		rootEntryIds: uniqueValues(rootEntryIds),
		topY: Number.isFinite(topicTopY) ? topicTopY : 0,
		bottomY: Number.isFinite(topicBottomY) ? topicBottomY : 0,
		mainLaneCenterY,
		nodeIds: [],
	};
}

function pushDownOverlappingLayouts(
	context: CanvasLayoutContext,
	layouts: TopicLayoutResult[],
	gapY: number,
): void {
	const sortedLayouts = [...layouts]
		.filter((layout) => layout.nodeIds.length > 0)
		.sort((left, right) => left.topY - right.topY || left.bottomY - right.bottomY);

	let previousBottomY: number | null = null;
	for (const layout of sortedLayouts) {
		if (previousBottomY !== null) {
			const minimumTopY = previousBottomY + gapY;
			if (layout.topY < minimumTopY) {
				shiftTopicLayout(context, layout, minimumTopY - layout.topY);
			}
		}

		previousBottomY = layout.bottomY;
	}
}

function shiftTopicLayout(
	context: CanvasLayoutContext,
	layout: TopicLayoutResult,
	deltaY: number,
): void {
	if (deltaY === 0) {
		return;
	}

	const nodeIds = new Set(layout.nodeIds);
	for (const node of context.nodes) {
		if (nodeIds.has(node.id)) {
			node.y += deltaY;
		}
	}

	layout.topY += deltaY;
	layout.bottomY += deltaY;
	layout.mainLaneCenterY += deltaY;
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

function groupFamiliesByPrimaryChoice(families: BranchFamily[]): ChoiceGroup[] {
	const grouped = new Map<string, ChoiceGroup>();
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

	return [...grouped.values()].sort(compareChoiceGroups);
}

function buildPhaseGraph(phaseIndices: number[], families: BranchFamily[]): PhaseGraph {
	const phaseSet = new Set(phaseIndices);
	for (const family of families) {
		phaseSet.add(family.phaseAnchor);
	}

	const orderedPhaseValues = uniqueNumbers([...phaseSet]);
	const familiesByPhase = new Map<number, BranchFamily[]>();
	const segmentsByPhase = new Map<number, PhaseTopicSegment[]>();
	const incomingTransitions = new Map<number, Set<number>>();
	const outgoingTransitions = new Map<number, Set<number>>();
	const mainTargets = new Map<number, number | null>();

	for (const phaseValue of orderedPhaseValues) {
		familiesByPhase.set(phaseValue, []);
		segmentsByPhase.set(phaseValue, []);
		incomingTransitions.set(phaseValue, new Set<number>());
		outgoingTransitions.set(phaseValue, new Set<number>());
	}

	for (const family of families) {
		const phaseFamilies = familiesByPhase.get(family.phaseAnchor) ?? [];
		phaseFamilies.push(family);
		familiesByPhase.set(family.phaseAnchor, phaseFamilies);

		if (
			family.progressionTarget !== null
			&& family.progressionTarget > family.phaseAnchor
			&& phaseSet.has(family.progressionTarget)
		) {
			outgoingTransitions.get(family.phaseAnchor)?.add(family.progressionTarget);
			incomingTransitions.get(family.progressionTarget)?.add(family.phaseAnchor);
		}
	}

	for (const [phaseValue, phaseFamilies] of familiesByPhase) {
		const sortedFamilies = [...phaseFamilies].sort(compareBranchFamilies);
		familiesByPhase.set(phaseValue, sortedFamilies);
		segmentsByPhase.set(
			phaseValue,
			[...groupFamiliesByTopic(sortedFamilies).entries()].map(([topic, topicFamilies]) => ({
				topic,
				families: topicFamilies,
			})),
		);
		mainTargets.set(
			phaseValue,
			sortedFamilies
				.map((family) => family.progressionTarget)
				.find((target): target is number => target !== null && target > phaseValue)
				?? null,
		);
	}

	return {
		orderedPhases: topologicallyOrderPhases(orderedPhaseValues, outgoingTransitions, incomingTransitions),
		familiesByPhase,
		segmentsByPhase,
		incomingTransitions,
		outgoingTransitions,
		mainTargets,
	};
}

function topologicallyOrderPhases(
	phaseValues: number[],
	outgoingTransitions: Map<number, Set<number>>,
	incomingTransitions: Map<number, Set<number>>,
): number[] {
	const remainingIncoming = new Map<number, number>();
	const available = [...phaseValues].sort((left, right) => left - right);
	const ordered: number[] = [];

	for (const phaseValue of phaseValues) {
		remainingIncoming.set(phaseValue, incomingTransitions.get(phaseValue)?.size ?? 0);
	}

	const ready: number[] = available.filter((phaseValue) => (remainingIncoming.get(phaseValue) ?? 0) === 0);
	const queued = new Set<number>(ready);

	while (ready.length > 0) {
		ready.sort((left, right) => left - right);
		const phaseValue = ready.shift();
		if (phaseValue === undefined) {
			break;
		}

		ordered.push(phaseValue);
		queued.delete(phaseValue);
		for (const target of [...(outgoingTransitions.get(phaseValue) ?? [])].sort((left, right) => left - right)) {
			const nextIncoming = Math.max(0, (remainingIncoming.get(target) ?? 0) - 1);
			remainingIncoming.set(target, nextIncoming);
			if (nextIncoming === 0 && !queued.has(target) && !ordered.includes(target)) {
				ready.push(target);
				queued.add(target);
			}
		}
	}

	for (const phaseValue of available) {
		if (!ordered.includes(phaseValue)) {
			ordered.push(phaseValue);
		}
	}

	return ordered;
}

function mapChoiceGroupsByChoice(choiceGroups: ChoiceGroup[]): Map<string, ChoiceGroup> {
	const groupsByChoice = new Map<string, ChoiceGroup>();
	for (const group of choiceGroups) {
		groupsByChoice.set(choiceGroupKey(group.choiceValue), group);
	}
	return groupsByChoice;
}

function collectEmittedChoices(families: BranchFamily[]): Set<number> {
	const emittedChoices = new Set<number>();
	for (const family of families) {
		for (const action of family.results) {
			if (action.kind === 'choice-set' && action.choiceValue !== undefined) {
				emittedChoices.add(action.choiceValue);
			}
		}
	}
	return emittedChoices;
}

function resolveRootChoiceGroups(choiceGroups: ChoiceGroup[]): ChoiceGroup[] {
	const emittedChoices = collectEmittedChoices(choiceGroups.flatMap((group) => group.families));
	return choiceGroups.filter(
		(group) => group.choiceValue === null || !emittedChoices.has(group.choiceValue),
	);
}

function orderChoiceGroupsForLanes(choiceGroups: ChoiceGroup[], phaseValue: number): ChoiceGroup[] {
	return [...choiceGroups].sort((left, right) => {
		const leftPriority = Math.min(...left.families.map((family) => family.priority), Number.MAX_SAFE_INTEGER);
		const rightPriority = Math.min(...right.families.map((family) => family.priority), Number.MAX_SAFE_INTEGER);
		if (leftPriority !== rightPriority) {
			return leftPriority - rightPriority;
		}

		const leftTarget = left.families
			.map((family) => family.progressionTarget)
			.find((target): target is number => target !== null && target > phaseValue)
			?? null;
		const rightTarget = right.families
			.map((family) => family.progressionTarget)
			.find((target): target is number => target !== null && target > phaseValue)
			?? null;
		return compareNullableNumbers(leftTarget, rightTarget)
			|| compareChoiceGroups(left, right);
	});
}

function buildCenteredGroupStartYs(groups: ChoiceGroup[]): number[] {
	if (groups.length === 0) {
		return [];
	}

	const heights = groups.map((group) => estimateChoiceColumnHeight(group.families));
	const startYs = new Array<number>(groups.length);
	startYs[0] = -Math.round((heights[0] ?? 0) / 2);
	let upperEdge = startYs[0];
	let lowerEdge = startYs[0] + (heights[0] ?? 0);

	for (let index = 1; index < groups.length; index += 1) {
		const height = heights[index] ?? 0;
		if (index % 2 === 1) {
			const nextBottom = upperEdge - LANE_GAP_Y;
			const nextStart = nextBottom - height;
			startYs[index] = nextStart;
			upperEdge = nextStart;
			continue;
		}

		const nextStart = lowerEdge + LANE_GAP_Y;
		startYs[index] = nextStart;
		lowerEdge = nextStart + height;
	}

	return startYs;
}

function computePhasePositions(
	phaseIndices: number[],
	segmentsByPhase: Map<number, PhaseTopicSegment[]>,
): Map<number, number> {
	const positions = new Map<number, number>();
	let currentX = 0;

	for (let index = 0; index < phaseIndices.length; index += 1) {
		const phaseValue = phaseIndices[index];
		if (phaseValue === undefined) {
			continue;
		}

		positions.set(phaseValue, currentX);
		const phaseWidth = estimatePhaseWidth(segmentsByPhase.get(phaseValue) ?? []);
		currentX += Math.max(PHASE_GAP_X, phaseWidth + 420);
	}

	return positions;
}

function estimatePhaseWidth(segments: PhaseTopicSegment[]): number {
	if (segments.length === 0) {
		return JOURNAL_WIDTH;
	}

	let furthestRight = JOURNAL_WIDTH;
	for (let topicIndex = 0; topicIndex < segments.length; topicIndex += 1) {
		const segment = segments[topicIndex];
		if (!segment) {
			continue;
		}
		const depth = estimateTopicDepth(segment.families);
		const topicBaseX = GATE_GAP_X + topicIndex * TOPIC_SEGMENT_GAP_X;
		const lastGateX = topicBaseX + (depth - 1) * sourceGroupStepX();
		const lastChoiceX = lastGateX + (CHOICE_GAP_X - GATE_GAP_X);
		furthestRight = Math.max(furthestRight, lastChoiceX + CHOICE_WIDTH);
	}

	return furthestRight;
}

function estimateChoiceColumnHeight(families: BranchFamily[]): number {
	if (families.length === 0) {
		return FILE_NODE_MIN_HEIGHT + CLUSTER_GAP_Y;
	}

	return families.reduce((total, family) => total + estimateFamilyHeight(family), 0);
}

function estimateFamilyHeight(family: BranchFamily): number {
	let total = 0;
	for (const record of family.records) {
		const gateHeight = measureTextHeight(renderConditionBlock(record.conditions), GATE_WIDTH);
		const dialogueHeight = measureCanvasBodyHeight(record.bodyText, DIALOGUE_WIDTH);
		const localResultLines = record.resultActions
			.filter((action) => action.kind !== 'choice-set')
			.map((action) => action.displayText);
		const resultHeight = localResultLines.length > 0 ? measureTextHeight(localResultLines.join('\n'), DIALOGUE_WIDTH) + RESULT_GAP_Y : 0;
		total += Math.max(gateHeight, dialogueHeight) + resultHeight + CLUSTER_GAP_Y;
	}
	return Math.max(total, FILE_NODE_MIN_HEIGHT + CLUSTER_GAP_Y);
}

function estimateRootGroupHeight(groups: ChoiceGroup[]): number {
	if (groups.length === 0) {
		return FILE_NODE_MIN_HEIGHT + CLUSTER_GAP_Y;
	}

	return groups.reduce((total, group, index) => {
		const spacing = index === 0 ? 0 : LANE_GAP_Y;
		return total + spacing + estimateChoiceColumnHeight(group.families);
	}, 0);
}

function estimateTopicDepth(families: BranchFamily[]): number {
	const choiceGroups = groupFamiliesByPrimaryChoice(families);
	if (choiceGroups.length === 0) {
		return 1;
	}

	const groupsByChoice = mapChoiceGroupsByChoice(choiceGroups);
	let roots = resolveRootChoiceGroups(choiceGroups);
	if (roots.length === 0) {
		roots = [...choiceGroups];
	}

	const visiting = new Set<string>();
	const memo = new Map<string, number>();
	const depthForGroup = (group: ChoiceGroup): number => {
		const key = choiceGroupKey(group.choiceValue);
		const cached = memo.get(key);
		if (cached !== undefined) {
			return cached;
		}
		if (visiting.has(key)) {
			return 1;
		}

		visiting.add(key);
		let maxChildDepth = 0;
		for (const family of group.families) {
			for (const action of family.results) {
				if (action.kind !== 'choice-set' || action.choiceValue === undefined) {
					continue;
				}

				const childGroup = groupsByChoice.get(choiceGroupKey(action.choiceValue));
				if (!childGroup) {
					continue;
				}
				maxChildDepth = Math.max(maxChildDepth, depthForGroup(childGroup));
			}
		}
		visiting.delete(key);

		const depth = 1 + maxChildDepth;
		memo.set(key, depth);
		return depth;
	};

	return Math.max(...roots.map((group) => depthForGroup(group)), 1);
}

function collapseChoiceAnchors(anchors: ChoiceAnchor[]): ChoiceAnchorGroup[] {
	const grouped = new Map<number, ChoiceAnchor[]>();
	for (const anchor of anchors) {
		const existing = grouped.get(anchor.choiceValue) ?? [];
		existing.push(anchor);
		grouped.set(anchor.choiceValue, existing);
	}

	return [...grouped.entries()]
		.sort((left, right) => left[0] - right[0])
		.map(([, valueAnchors]) => {
			const y = Math.round(
				valueAnchors.reduce((sum, anchor) => sum + anchor.y, 0) / valueAnchors.length,
			);
			const x = Math.max(...valueAnchors.map((anchor) => anchor.x));
			return {
				choiceValue: valueAnchors[0]?.choiceValue ?? 0,
				nodeIds: uniqueValues(valueAnchors.map((anchor) => anchor.nodeId)),
				x,
				y,
			};
		});
}

function compareChoiceGroups(left: ChoiceGroup, right: ChoiceGroup): number {
	return compareNullableNumbers(left.choiceValue, right.choiceValue);
}

function choiceGroupKey(choiceValue: number | null): string {
	return choiceValue === null ? 'root' : String(choiceValue);
}

function sourceGroupStepX(): number {
	return (CHOICE_GAP_X - GATE_GAP_X) + FOLLOWUP_GROUP_GAP_X;
}

function phaseTopicSegmentKey(phaseValue: number, segmentIndex: number, topic: string): string {
	return `${phaseValue}:${segmentIndex}:${topic}`;
}

function buildPhaseGraphDebugSummary(
	questTitle: string,
	phaseGraph: PhaseGraph,
	phaseXPositions: Map<number, number>,
	context: CanvasLayoutContext,
	phasePlacements: Map<number, PhasePlacement>,
	topicPlacements: Map<string, TopicLayoutResult>,
): PhaseGraphDebugSummary {
	return {
		questTitle,
		phases: phaseGraph.orderedPhases.map((phaseValue, orderIndex) => {
			const milestoneNodeId = context.phaseNodeIds.get(phaseValue);
			const milestoneNode = context.nodes.find((node) => node.id === milestoneNodeId);
			const segments = phaseGraph.segmentsByPhase.get(phaseValue) ?? [];
			return {
				phaseValue,
				orderIndex,
				x: phaseXPositions.get(phaseValue) ?? 0,
				milestoneY: milestoneNode?.y ?? null,
				incoming: [...(phaseGraph.incomingTransitions.get(phaseValue) ?? [])].sort((left, right) => left - right),
				outgoing: [...(phaseGraph.outgoingTransitions.get(phaseValue) ?? [])].sort((left, right) => left - right),
				mainTarget: phaseGraph.mainTargets.get(phaseValue) ?? null,
				phaseTopY: phasePlacements.get(phaseValue)?.topY ?? null,
				phaseBottomY: phasePlacements.get(phaseValue)?.bottomY ?? null,
				mainLaneCenterY: phasePlacements.get(phaseValue)?.mainLaneCenterY ?? null,
				topics: segments.map((segment, segmentIndex) => {
					const segmentKey = phaseTopicSegmentKey(phaseValue, segmentIndex, segment.topic);
					const topicPlacement = topicPlacements.get(segmentKey);
					const choiceGroups = groupFamiliesByPrimaryChoice(segment.families);
					const rootChoiceGroups = resolveRootChoiceGroups(choiceGroups);
					return {
						segmentIndex,
						topic: segment.topic,
						mainLaneCenterY: topicPlacement?.mainLaneCenterY ?? null,
						familyOrder: [...segment.families].sort(compareBranchFamilies).map((family) => ({
							priority: family.priority,
							progressionTarget: family.progressionTarget,
							primaryChoiceValue: familyPrimaryChoiceValue(family),
							choiceTargets: uniqueNumbers(
								family.results
									.filter((action) => action.kind === 'choice-set' && action.choiceValue !== undefined)
									.map((action) => action.choiceValue as number),
							),
							recordPaths: family.records
								.map((record) => record.file.path)
								.sort((left, right) => left.localeCompare(right)),
						})),
						rootChoices: orderChoiceGroupsForLanes(rootChoiceGroups.length > 0 ? rootChoiceGroups : choiceGroups, phaseValue)
							.map((group) => group.choiceValue),
						choiceResolutions: summarizeChoiceResolutions(segment.families),
					};
				}),
			};
		}),
	};
}

function summarizeChoiceResolutions(families: BranchFamily[]): TopicChoiceResolutionSummary[] {
	const sourceRecordPathsByChoice = new Map<number, string[]>();
	const childGroupsByChoice = mapChoiceGroupsByChoice(groupFamiliesByPrimaryChoice(families));

	for (const family of families) {
		const familyRecordPaths = family.records.map((record) => record.file.path);
		for (const action of family.results) {
			if (action.kind !== 'choice-set' || action.choiceValue === undefined) {
				continue;
			}

			const existing = sourceRecordPathsByChoice.get(action.choiceValue) ?? [];
			existing.push(...familyRecordPaths);
			sourceRecordPathsByChoice.set(action.choiceValue, existing);
		}
	}

	return [...sourceRecordPathsByChoice.entries()]
		.sort((left, right) => left[0] - right[0])
		.map(([choiceValue, sourceRecordPaths]) => {
			const childGroup = childGroupsByChoice.get(choiceGroupKey(choiceValue));
			return {
				choiceValue,
				sourceRecordPaths: uniqueValues(sourceRecordPaths).sort((left, right) => left.localeCompare(right)),
				entryRecordPaths: childGroup
					? [...childGroup.families]
						.sort(compareBranchFamilies)
						.map((family) => firstFamilyRecordPath(family))
						.filter((path): path is string => path !== null)
					: [],
			};
		});
}

function familyPrimaryChoiceValue(family: BranchFamily): number | null {
	const choiceValues = family.records
		.map((record) => record.primaryChoiceValue)
		.filter((value): value is number => value !== null);
	if (choiceValues.length === 0) {
		return null;
	}
	return Math.min(...choiceValues);
}

function firstFamilyRecordPath(family: BranchFamily): string | null {
	return [...family.records].sort(compareDialogueRecords)[0]?.file.path ?? null;
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

function resolveCanvasNodeOverlaps(context: CanvasLayoutContext): void {
	const lockedGroups = buildLockedVerticalGroups(context);
	const maxPasses = Math.max(1, context.nodes.length * context.nodes.length);
	for (let pass = 0; pass < maxPasses; pass += 1) {
		let changed = false;
		const orderedGroups = [...lockedGroups.values()].sort(compareLockedGroupsByPosition);

		for (let upperIndex = 0; upperIndex < orderedGroups.length; upperIndex += 1) {
			const upperGroup = orderedGroups[upperIndex];
			if (!upperGroup) {
				continue;
			}

			for (let lowerIndex = upperIndex + 1; lowerIndex < orderedGroups.length; lowerIndex += 1) {
				const lowerGroup = orderedGroups[lowerIndex];
				if (!lowerGroup) {
					continue;
				}

				const minimumLowerY = upperGroup.bottomY + FINAL_NODE_GAP_Y;
				if (lowerGroup.topY >= minimumLowerY) {
					break;
				}
				if (!lockedGroupsOverlapHorizontally(upperGroup, lowerGroup)) {
					continue;
				}

				shiftLockedGroup(lowerGroup, minimumLowerY - lowerGroup.topY);
				changed = true;
			}
		}

		if (!changed) {
			return;
		}
	}
}

interface LockedVerticalGroup {
	id: string;
	nodes: CanvasNode[];
	topY: number;
	bottomY: number;
	leftX: number;
	rightX: number;
}

function buildLockedVerticalGroups(context: CanvasLayoutContext): Map<string, LockedVerticalGroup> {
	const parentByNodeId = new Map<string, string>();

	const find = (nodeId: string): string => {
		const parent = parentByNodeId.get(nodeId);
		if (!parent || parent === nodeId) {
			parentByNodeId.set(nodeId, nodeId);
			return nodeId;
		}

		const root = find(parent);
		parentByNodeId.set(nodeId, root);
		return root;
	};

	const union = (leftId: string, rightId: string): void => {
		const leftRoot = find(leftId);
		const rightRoot = find(rightId);
		if (leftRoot === rightRoot) {
			return;
		}

		parentByNodeId.set(rightRoot, leftRoot);
	};

	for (const node of context.nodes) {
		parentByNodeId.set(node.id, node.id);
	}

	for (const edge of context.edges) {
		if (edge.fromSide === 'bottom' && edge.toSide === 'top') {
			union(edge.fromNode, edge.toNode);
		}
	}

	const groups = new Map<string, LockedVerticalGroup>();
	for (const node of context.nodes) {
		const rootId = find(node.id);
		const existing = groups.get(rootId);
		if (existing) {
			existing.nodes.push(node);
			existing.topY = Math.min(existing.topY, node.y);
			existing.bottomY = Math.max(existing.bottomY, node.y + node.height);
			existing.leftX = Math.min(existing.leftX, node.x);
			existing.rightX = Math.max(existing.rightX, node.x + node.width);
			continue;
		}

		groups.set(rootId, {
			id: rootId,
			nodes: [node],
			topY: node.y,
			bottomY: node.y + node.height,
			leftX: node.x,
			rightX: node.x + node.width,
		});
	}

	return groups;
}

function compareLockedGroupsByPosition(left: LockedVerticalGroup, right: LockedVerticalGroup): number {
	return left.topY - right.topY || left.leftX - right.leftX || left.id.localeCompare(right.id);
}

function lockedGroupsOverlapHorizontally(left: LockedVerticalGroup, right: LockedVerticalGroup): boolean {
	return left.leftX < right.rightX && right.leftX < left.rightX;
}

function shiftLockedGroup(group: LockedVerticalGroup, deltaY: number): void {
	if (deltaY === 0) {
		return;
	}

	for (const node of group.nodes) {
		node.y += deltaY;
	}

	group.topY += deltaY;
	group.bottomY += deltaY;
}

async function writePhaseGraphSummary(
	app: App,
	outputCanvasPath: string,
	summary: PhaseGraphDebugSummary,
): Promise<void> {
	const summaryPath = phaseGraphSummaryPath(outputCanvasPath);
	const parentFolderPath = summaryPath.substring(0, summaryPath.lastIndexOf('/'));
	await ensureFolder(app, parentFolderPath);
	const summaryJson = JSON.stringify(summary, null, '\t');
	const existing = app.vault.getAbstractFileByPath(summaryPath);
	if (existing instanceof TFile) {
		await app.vault.process(existing, () => summaryJson);
		return;
	}

	await app.vault.create(summaryPath, summaryJson);
}

function phaseGraphSummaryPath(outputCanvasPath: string): string {
	return outputCanvasPath.replace(/\.canvas$/i, '.phase-graph.json');
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

async function updateCanvasLinksAndBodyBlocks(
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

function ensureCanvasBodyBlockLink(content: string, subpath: string): string {
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
	const parsedFrontmatter = parseStructuredFrontmatter(frontmatter);
	const trimmedBody = body.trim();
	return {
		file,
		frontmatter: parsedFrontmatter,
		body: trimmedBody,
		canvasBodySubpath: resolveCanvasBodySubpath(file.path, parsedFrontmatter, trimmedBody),
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

	return stripWikilinkSyntax(stripBlockId(firstLine));
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
		canvasSubpath: document.canvasBodySubpath,
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
	const conditionQuestReferences = uniqueValues(
		conditionEntries
			.filter((condition) => condition.kind === 'journal' && condition.questId)
			.map((condition) => condition.questId as string),
	);
	const resultQuestReferences = uniqueValues(
		resultActions
			.filter((action) => action.kind === 'journal-set' && action.targetQuestId)
			.map((action) => action.targetQuestId as string),
	);
	const ownedQuestReferences = resultQuestReferences.length > 0 ? resultQuestReferences : conditionQuestReferences;
	const directRelevance = ownedQuestReferences.some((questId) => questIds.includes(questId));

	return {
		id: createNodeId(`record:${document.file.path}`),
		type,
		topic,
		file: document.file,
		canvasSubpath: document.canvasBodySubpath,
		diagId: getStringValue(document.frontmatter, 'DiagID') ?? '',
		prevId: getStringValue(document.frontmatter, 'PrevID') ?? '',
		bodyText,
		conditions: conditionEntries,
		speakerConditions: conditionEntries.filter((condition) => condition.kind === 'speaker'),
		nonSpeakerConditions: conditionEntries.filter((condition) => condition.kind !== 'speaker'),
		resultActions,
		resultLines: resultActions.map((action) => action.displayText),
		phaseAnchor: determinePhaseAnchor(conditionEntries, resultActions, phaseIndices, questIds),
		directlyRelevant: directRelevance,
		conditionQuestReferences,
		resultQuestReferences,
		ownedQuestReferences,
		questReferences: uniqueValues([...conditionQuestReferences, ...resultQuestReferences]),
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

function resolvePropagatedRelevantRecords(
	allRecords: DialogueRecord[],
	directRelevant: Set<string>,
	questIds: string[],
): Set<string> {
	const relevant = new Set<string>(directRelevant);
	const recordsByTopic = groupRecordsByTopic(allRecords);
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

	let changed = true;
	while (changed) {
		changed = false;

		for (const record of allRecords) {
			if (!relevant.has(record.id)) {
				continue;
			}

			const previous = record.prevId ? diagMap.get(record.prevId) : undefined;
			if (previous && !relevant.has(previous.id) && !hasJournalResultsForOtherQuests(previous, questIds)) {
				relevant.add(previous.id);
				changed = true;
			}

			const nextRecords = record.diagId ? nextByPrev.get(record.diagId) ?? [] : [];
			for (const nextRecord of nextRecords) {
				if (relevant.has(nextRecord.id) || hasJournalResultsForOtherQuests(nextRecord, questIds)) {
					continue;
				}

				relevant.add(nextRecord.id);
				changed = true;
			}
		}

		for (const record of allRecords) {
			if (relevant.has(record.id) || record.choiceTargets.length === 0 || hasJournalResultsForOtherQuests(record, questIds)) {
				continue;
			}

			const topicRecords = recordsByTopic.get(record.topic) ?? [];
			const leadsToRelevant = topicRecords.some(
				(candidate) => relevant.has(candidate.id)
					&& record.choiceTargets.some((value) => candidate.choiceValues.includes(value)),
			);

			if (leadsToRelevant) {
				relevant.add(record.id);
				changed = true;
			}
		}
	}

	return relevant;
}

function resolveEffectiveQuestOwnership(allRecords: DialogueRecord[]): Map<string, string[]> {
	const ancestorsByRecordId = buildAncestorRecordMap(allRecords);
	const resultOwnership = new Map<string, Set<string>>();
	const conditionOwnership = new Map<string, Set<string>>();

	for (const record of allRecords) {
		resultOwnership.set(record.id, new Set(record.resultQuestReferences));
		conditionOwnership.set(record.id, new Set(record.conditionQuestReferences));
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (const record of allRecords) {
			const ancestorIds = ancestorsByRecordId.get(record.id) ?? [];
			const descendantResultOwnership = resultOwnership.get(record.id) ?? new Set<string>();
			const descendantConditionOwnership = conditionOwnership.get(record.id) ?? new Set<string>();
			for (const ancestorId of ancestorIds) {
				const ancestorResultOwnership = resultOwnership.get(ancestorId) ?? new Set<string>();
				const ancestorConditionOwnership = conditionOwnership.get(ancestorId) ?? new Set<string>();
				if (mergeQuestReferences(ancestorResultOwnership, descendantResultOwnership)) {
					resultOwnership.set(ancestorId, ancestorResultOwnership);
					changed = true;
				}
				if (mergeQuestReferences(ancestorConditionOwnership, descendantConditionOwnership)) {
					conditionOwnership.set(ancestorId, ancestorConditionOwnership);
					changed = true;
				}
			}
		}
	}

	const effectiveOwnership = new Map<string, string[]>();
	for (const record of allRecords) {
		const recordResultOwnership = [...(resultOwnership.get(record.id) ?? new Set<string>())];
		const recordConditionOwnership = [...(conditionOwnership.get(record.id) ?? new Set<string>())];
		effectiveOwnership.set(
			record.id,
			recordResultOwnership.length > 0 ? uniqueValues(recordResultOwnership) : uniqueValues(recordConditionOwnership),
		);
	}

	return effectiveOwnership;
}

function buildAncestorRecordMap(allRecords: DialogueRecord[]): Map<string, string[]> {
	const ancestorsByRecordId = new Map<string, Set<string>>();
	const recordsByDiagId = new Map<string, DialogueRecord>();
	const recordsByTopic = groupRecordsByTopic(allRecords);

	for (const record of allRecords) {
		if (record.diagId.length > 0) {
			recordsByDiagId.set(record.diagId, record);
		}
		ancestorsByRecordId.set(record.id, new Set<string>());
	}

	for (const record of allRecords) {
		const recordAncestors = ancestorsByRecordId.get(record.id);
		if (!recordAncestors) {
			continue;
		}

		const previous = record.prevId ? recordsByDiagId.get(record.prevId) : undefined;
		if (previous) {
			recordAncestors.add(previous.id);
		}

		const topicRecords = recordsByTopic.get(record.topic) ?? [];
		for (const candidate of topicRecords) {
			if (candidate.id === record.id || candidate.choiceTargets.length === 0) {
				continue;
			}

			if (candidate.choiceTargets.some((value) => record.choiceValues.includes(value))) {
				recordAncestors.add(candidate.id);
			}
		}
	}

	return new Map(
		[...ancestorsByRecordId.entries()].map(([recordId, ancestorIds]) => [recordId, [...ancestorIds]]),
	);
}

function mergeQuestReferences(target: Set<string>, source: Set<string>): boolean {
	let changed = false;
	for (const questId of source) {
		if (target.has(questId)) {
			continue;
		}

		target.add(questId);
		changed = true;
	}
	return changed;
}

function groupBranchFamilies(records: DialogueRecord[], questIds: string[]): BranchFamily[] {
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

		const progressionTarget = firstJournalResult(record.resultActions, questIds);
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

function determinePhaseAnchor(
	conditions: Condition[],
	resultActions: ResultAction[],
	phaseIndices: number[],
	questIds: string[],
): number {
	const journalResult = firstJournalResult(resultActions, questIds);
	if (journalResult !== null) {
		return previousPhaseBefore(journalResult, phaseIndices);
	}

	const journalConditions = conditions.filter(
		(condition) => condition.kind === 'journal'
			&& condition.value !== undefined
			&& condition.questId !== undefined
			&& questIds.includes(condition.questId),
	);
	for (const condition of journalConditions) {
		if (condition.operator === '=' || condition.operator === '>=' || condition.operator === '>') {
			return nearestPhaseAtOrBelow(condition.value as number, phaseIndices);
		}
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
	return Math.min(PRE_JOURNAL_PHASE, value);
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

function firstJournalResult(resultActions: ResultAction[], questIds: string[]): number | null {
	let earliestTarget: number | null = null;
	for (const action of resultActions) {
		if (
			action.kind === 'journal-set'
			&& action.targetJournalIndex !== undefined
			&& action.targetQuestId !== undefined
			&& questIds.includes(action.targetQuestId)
		) {
			earliestTarget = earliestTarget === null
				? action.targetJournalIndex
				: Math.min(earliestTarget, action.targetJournalIndex);
		}
	}
	return earliestTarget;
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

function measureFileNodeHeight(context: CanvasLayoutContext, filePath: string, width: number): number {
	const bodyText = context.fileBodyTextByPath.get(filePath);
	if (!bodyText) {
		return FILE_NODE_MIN_HEIGHT;
	}

	return measureCanvasBodyHeight(bodyText, width);
}

function measureCanvasBodyHeight(bodyText: string, width: number): number {
	const visibleText = normalizeCanvasBodyText(bodyText);
	if (visibleText.length === 0) {
		return FILE_NODE_MIN_HEIGHT;
	}

	return Math.max(FILE_NODE_MIN_HEIGHT, measureTextHeight(visibleText, width) + FILE_NODE_PADDING_Y);
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
			height: measureTextHeight(text, width),
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

function hasJournalResultsForOtherQuests(record: DialogueRecord, questIds: string[]): boolean {
	return record.resultActions.some(
		(action) => action.kind === 'journal-set'
			&& Boolean(action.targetQuestId)
			&& !questIds.includes(action.targetQuestId as string),
	);
}

function containsJournalLine(lines: string[]): boolean {
	return lines.some((line) => line.startsWith('Journal [['));
}

function renderResultAction(action: ResultAction, allMilestones: JournalMilestone[]): string {
	if (action.kind !== 'journal-set' || action.targetJournalIndex === undefined) {
		return action.displayText;
	}

	const targetMilestone = resolveJournalResultMilestone(action, allMilestones);
	if (!targetMilestone) {
		return action.displayText;
	}

	const labelQuestId = action.targetQuestId ?? targetMilestone.questId;
	const label = `${labelQuestId} ${action.targetJournalIndex}`;
	return `Journal [[${toWikilinkTarget(targetMilestone.file.path, targetMilestone.canvasSubpath)}|${label}]]`;
}

function resolveJournalResultMilestone(
	action: ResultAction,
	allMilestones: JournalMilestone[],
): JournalMilestone | null {
	if (action.kind !== 'journal-set' || action.targetJournalIndex === undefined) {
		return null;
	}

	if (action.targetQuestId) {
		return allMilestones.find(
			(milestone) => milestone.questId === action.targetQuestId && milestone.index === action.targetJournalIndex,
		) ?? null;
	}

	const matches = allMilestones.filter((milestone) => milestone.index === action.targetJournalIndex);
	if (matches.length === 1) {
		return matches[0] ?? null;
	}

	return null;
}

function toWikilinkTarget(filePath: string, subpath?: string | null): string {
	const fileName = filePath.split('/').pop() ?? filePath;
	const linkPath = fileName.replace(/\.md$/i, '');
	return `${linkPath}${subpath ?? ''}`;
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

function resolveCanvasBodySubpath(
	filePath: string,
	frontmatter: Record<string, FrontmatterValue>,
	body: string,
): string | null {
	if (body.length === 0) {
		return null;
	}

	const type = getStringValue(frontmatter, 'Type');
	if (!type || !CANVAS_BODY_BLOCK_TYPES.has(type)) {
		return null;
	}

	const existingBlockId = trailingBodyBlockId(body);
	return `#^${existingBlockId ?? createCanvasBodyBlockId(filePath)}`;
}

function createCanvasBodyBlockId(filePath: string): string {
	return `${CANVAS_BODY_BLOCK_PREFIX}-${stableHash(filePath).slice(0, 10)}`;
}

function blockIdFromSubpath(subpath: string): string | null {
	const match = subpath.match(/^#\^([A-Za-z0-9_-]+)$/);
	return match?.[1] ?? null;
}

function ensureTrailingBodyBlockId(body: string, blockId: string): string {
	if (body.length === 0) {
		return body;
	}

	const lines = body.split('\n');
	let lastContentLine = -1;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if ((lines[index] ?? '').trim().length > 0) {
			lastContentLine = index;
			break;
		}
	}

	if (lastContentLine === -1) {
		return body;
	}

	const currentBlockId = trailingBlockId(lines[lastContentLine] ?? '');
	if (currentBlockId) {
		return body;
	}

	lines[lastContentLine] = `${(lines[lastContentLine] ?? '').trimEnd()} ^${blockId}`;
	return lines.join('\n');
}

function trailingBodyBlockId(body: string): string | null {
	const line = firstNonEmptyLineFromEnd(body);
	if (!line) {
		return null;
	}

	return trailingBlockId(line);
}

function firstNonEmptyLineFromEnd(text: string): string | null {
	const lines = text.split('\n');
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const trimmed = (lines[index] ?? '').trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}

	return null;
}

function trailingBlockId(text: string): string | null {
	const match = text.match(/\s+\^([A-Za-z0-9_-]+)\s*$/);
	return match?.[1] ?? null;
}

function normalizeQuestNameKey(text: string | null): string | null {
	if (!text) {
		return null;
	}

	const normalized = stripWikilinkSyntax(stripBlockId(text))
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
	return normalized.length > 0 ? normalized : null;
}

function stripWikilinkSyntax(text: string): string {
	return text.replace(/\[\[(?:[^|\]]*?\|)?([^|\]]*?)\]\]/g, '$1').trim();
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

function measureTextHeight(text: string, width?: number): number {
	const lineCount = width ? estimateWrappedLineCount(text, width) : Math.max(1, text.split('\n').length);
	return Math.max(50, 26 + lineCount * 24);
}

function estimateWrappedLineCount(text: string, width: number): number {
	const availableWidth = Math.max(80, width - TEXT_NODE_HORIZONTAL_PADDING);
	const maxCharsPerLine = Math.max(10, Math.floor(availableWidth / APPROX_TEXT_CHAR_WIDTH));
	let lineCount = 0;

	for (const rawLine of text.split('\n')) {
		const normalizedLine = rawLine.trim().replace(/\s+/g, ' ');
		if (normalizedLine.length === 0) {
			lineCount += 1;
			continue;
		}

		lineCount += Math.max(1, Math.ceil(normalizedLine.length / maxCharsPerLine));
	}

	return Math.max(1, lineCount);
}

function normalizeCanvasBodyText(text: string): string {
	let lastNonEmptyLine = -1;
	const lines = text.split('\n');
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if ((lines[index] ?? '').trim().length > 0) {
			lastNonEmptyLine = index;
			break;
		}
	}

	return text
		.split('\n')
		.map((line, index) => {
			return index === lastNonEmptyLine ? stripBlockId(line).trimEnd() : line.trimEnd();
		})
		.join('\n')
		.trim();
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

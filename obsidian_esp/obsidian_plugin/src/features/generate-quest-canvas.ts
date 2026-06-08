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
const DIALOGUE_COLOR = '3';
const GATE_COLOR = '4';
const RESULT_COLOR = '5';
const JOURNAL_COLOR = '6';
const GATE_WIDTH = 385;
const CHOICE_WIDTH = 320;
const DIALOGUE_WIDTH = 440;
const JOURNAL_WIDTH = 440;
const FILE_NODE_MIN_HEIGHT = 96;
const FILE_NODE_PADDING_Y = 40;
const TEXT_NODE_HORIZONTAL_PADDING = 48;
const APPROX_TEXT_CHAR_WIDTH = 8;
const PHASE_GAP_X = 1320;
const GATE_GAP_X = 520;
const DIALOGUE_GAP_X = 980;
const CHOICE_GAP_X = 1580;
const LANE_GAP_Y = 560;
const RESULT_GAP_Y = 30;
const TOPIC_SEGMENT_GAP_X = 1920;
const FOLLOWUP_GROUP_GAP_X = 500;
const CLUSTER_GAP_Y = 140;
const DENSE_VARIANT_GAP_Y = 64;
const BRANCH_COLLISION_GAP_Y = 80;
const FINAL_NODE_GAP_Y = 24;
const INTRODUCER_ORIGIN_X = -GATE_GAP_X;
const MIN_HORIZONTAL_EDGE_GAP_X = 75;
const MAX_COMPACT_EDGE_GAP_X = 180;
const ADD_TOPIC_GAP_X = 100;
const PRE_JOURNAL_PHASE = 0;
const NUMERIC_OPERATOR_PATTERN = '(<=|>=|==|!=|=|<|>)';
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
	finished: boolean;
	file: TFile;
	summary: string;
	canvasSubpath: string | null;
}

interface Condition {
	kind: 'speaker' | 'journal' | 'item' | 'choice' | 'other';
	displayText: string;
	questId?: string;
	value?: number;
	operator?: NumericOperator;
	choiceValue?: number;
}

type NumericOperator = '<=' | '>=' | '<' | '>' | '=' | '==' | '!=';

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
	infoOrder: number;
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

interface ChoiceTransitionAnchor {
	topic: string;
	choiceValue: number;
	nodeId: string;
	sourceRecords: DialogueRecord[];
}

interface AddTopicTransition {
	sourceRecord: DialogueRecord;
	sourceNodeId: string;
	targetNodeId: string;
}

interface TopicLayoutResult {
	rootEntryIds: string[];
	topY: number;
	bottomY: number;
	mainLaneCenterY: number;
	nodeIds: string[];
}

interface AnchoredTopicLayout {
	choiceValue: number;
	anchorY: number;
	layout: TopicLayoutResult;
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
}

interface FileNodeTarget {
	file: TFile;
	subpath: string;
}

interface CanvasLayoutContext {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	relatedFiles: Map<string, TFile>;
	fileBodyTextByPath: Map<string, string>;
	phaseNodeIds: Map<number, string>;
	recordEntryNodeIds: Map<string, string>;
	choiceTransitionAnchors: ChoiceTransitionAnchor[];
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

export async function generateQuestCanvasForFolder(
	app: App,
	folder: TFolder,
): Promise<void> {
	const progress = new ProgressBar('Generating quest canvas');
	try {
		progress.update(5, 'Checking the selected folder');
		const scope = await discoverQuestScope(app, folder);
		progress.update(25, `Resolving dialogue for ${scope.questTitle}`);
		const buildResult = await buildQuestCanvas(app, scope);
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

	const effectiveOwnership = resolveEffectiveQuestOwnership(allRecords);
	const directRelevant = new Set(
		allRecords
			.filter((record) => (effectiveOwnership.get(record.id) ?? []).some((questId) => scope.questIds.includes(questId)))
			.map((record) => record.id),
	);
	const relevantRecordIds = resolvePropagatedRelevantRecords(allRecords, directRelevant, scope.questIds);
	const relevantRecords = allRecords.filter(
		(record) => relevantRecordIds.has(record.id)
			&& !hasOnlyJournalResultsForOtherQuests(record, scope.questIds),
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
	const orderedRelevantRecords = assignDialogueInfoOrder(scopedRelevantRecords);
	const phaseAnchoredRecords = resolveChoiceDerivedPhaseAnchors(orderedRelevantRecords);
	const families = groupBranchFamilies(phaseAnchoredRecords, scope.questIds);
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
			if (milestoneNodeId) {
				for (const entryId of topicLayout.rootEntryIds) {
					if (!entryCanFollowPhaseMilestone(entryId, segment.families, canvasContext, phaseValue, scope.questIds)) {
						continue;
					}

					addEdge(canvasContext, `${milestoneNodeId}:${entryId}`, milestoneNodeId, 'right', entryId, 'left');
				}
			}
			if (Number.isFinite(topicLayout.topY) && Number.isFinite(topicLayout.bottomY)) {
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
	}

	connectChoiceTransitions(canvasContext, phaseAnchoredRecords);
	connectAddTopicTransitions(canvasContext, phaseAnchoredRecords);
	connectJournalConditionMilestones(canvasContext, phaseAnchoredRecords, scope.journalMilestones, scope.questIds);
	connectScriptedMilestones(canvasContext, phaseGraph.orderedPhases);
	compactHorizontalConnectionLayout(canvasContext);
	separateOverlappingBranchGroups(canvasContext);
	resolveCanvasNodeOverlaps(canvasContext);
	balanceChoiceTargetRecordClusters(canvasContext);
	resolveCanvasNodeOverlaps(canvasContext);
	compactHorizontalConnectionLayout(canvasContext);
	resolveCanvasNodeOverlaps(canvasContext);
	normalizeCanvasOrigin(canvasContext);
	enforceGateDialogueCenterAlignment(canvasContext);

	const relatedFiles = new Map<string, TFile>();
	const fileNodeTargets = new Map<string, FileNodeTarget>();
	for (const milestone of scope.journalDocuments) {
		relatedFiles.set(milestone.file.path, milestone.file);
	}
	for (const record of phaseAnchoredRecords) {
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
	for (const record of phaseAnchoredRecords) {
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
	};
}

function createCanvasLayoutContext(): CanvasLayoutContext {
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

function contextPhaseNodeId(context: CanvasLayoutContext, phaseValue: number): string | undefined {
	return context.phaseNodeIds.get(phaseValue);
}

function entryCanFollowPhaseMilestone(
	entryId: string,
	families: BranchFamily[],
	context: CanvasLayoutContext,
	phaseValue: number,
	questIds: string[],
): boolean {
	const entryRecords = families.flatMap((family) => family.records).filter(
		(record) => context.recordEntryNodeIds.get(record.id) === entryId,
	);
	if (entryRecords.length === 0) {
		return true;
	}

	return entryRecords.some((record) => recordCanRunAtPhase(record, phaseValue, questIds));
}

function recordCanRunAtPhase(record: DialogueRecord, phaseValue: number, questIds: string[]): boolean {
	const selectedQuestJournalConditions = record.conditions.filter(
		(condition) => condition.kind === 'journal'
			&& condition.questId !== undefined
			&& questIds.includes(condition.questId),
	);
	if (selectedQuestJournalConditions.length === 0) {
		return false;
	}

	return selectedQuestJournalConditions.every((condition) => journalConditionMatches(phaseValue, condition));
}

function connectJournalConditionMilestones(
	context: CanvasLayoutContext,
	records: DialogueRecord[],
	milestones: JournalMilestone[],
	questIds: string[],
): void {
	for (const record of records) {
		const entryNodeId = context.recordEntryNodeIds.get(record.id);
		if (!entryNodeId) {
			continue;
		}

		for (const phaseValue of linkedJournalConditionPhases(record.conditions, milestones, questIds)) {
			const phaseNodeId = context.phaseNodeIds.get(phaseValue);
			if (!phaseNodeId) {
				continue;
			}
			if (nodeCanReach(context, phaseNodeId, entryNodeId)) {
				continue;
			}

			addEdge(context, `${phaseNodeId}:${entryNodeId}`, phaseNodeId, 'right', entryNodeId, 'left');
		}
	}
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

function layoutBranchFamily(
	context: CanvasLayoutContext,
	family: BranchFamily,
	phaseValue: number,
	gateX: number,
	dialogueX: number,
	choiceX: number,
	startY: number,
	allMilestones: JournalMilestone[],
	clusterGapY = CLUSTER_GAP_Y,
): { firstEntryId: string; nextY: number; choiceAnchors: ChoiceAnchor[] } {
	const familyRecords = [...family.records].sort(compareDialogueRecords);
	const familyChoiceActions = family.results.filter((action) => action.kind === 'choice-set');
	const choiceAnchors: ChoiceAnchor[] = [];
	let currentY = startY;
	let firstEntryId = '';

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
		const choiceActions = familyChoiceActions.filter((action) => action.choiceValue !== undefined);
		const choiceHeights = choiceActions.map((action) => measureTextHeight(action.displayText, CHOICE_WIDTH));
		const choiceStackHeight = choiceHeights.reduce((total, height, index) => {
			const spacing = index === 0 ? 0 : 24;
			return total + spacing + height;
		}, 0);
		const clusterHeight = Math.max(gateHeight, dialogueHeight, choiceStackHeight) + localResultHeight + clusterGapY;
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
		const gateY = Math.round(recordY + Math.max(0, (dialogueHeight - gateHeight) / 2));
		const gateId = gateText.length > 0
			? addTextNode(
				context,
				`gate:${record.file.path}`,
				gateText,
				gateX,
				gateY,
				GATE_WIDTH,
				GATE_COLOR,
			)
			: dialogueId;
		context.relatedFiles.set(record.file.path, record.file);
		if (firstEntryId.length === 0) {
			firstEntryId = gateId;
		}
		context.recordEntryNodeIds.set(record.id, gateId);

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

		let choiceCursorY = recordY + Math.max(0, Math.round((dialogueHeight - choiceStackHeight) / 2));
		const recordChoiceNodeIds = new Map<string, string>();
		for (let choiceIndex = 0; choiceIndex < choiceActions.length; choiceIndex += 1) {
			const choiceAction = choiceActions[choiceIndex];
			const choiceHeight = choiceHeights[choiceIndex] ?? measureTextHeight(choiceAction?.displayText ?? '', CHOICE_WIDTH);
			if (!choiceAction || choiceAction.choiceValue === undefined) {
				continue;
			}
			const choiceNodeKey = choiceActionIdentity(choiceAction);
			let choiceNodeId = recordChoiceNodeIds.get(choiceNodeKey);
			if (!choiceNodeId) {
				choiceNodeId = addTextNode(
					context,
					`choice:${record.file.path}:${choiceAction.choiceValue}:${choiceAction.displayText}`,
					choiceAction.displayText,
					choiceX,
					choiceCursorY,
					CHOICE_WIDTH,
					GATE_COLOR,
				);
				recordChoiceNodeIds.set(choiceNodeKey, choiceNodeId);
				choiceAnchors.push({
					choiceValue: choiceAction.choiceValue,
					nodeId: choiceNodeId,
					x: choiceX,
					y: Math.round(choiceCursorY + choiceHeight / 2),
				});
				context.choiceTransitionAnchors.push({
					topic: family.topic,
					choiceValue: choiceAction.choiceValue,
					nodeId: choiceNodeId,
					sourceRecords: [record],
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
		const clusterGapY = choiceGroupUsesDenseVariantLayout(group) ? DENSE_VARIANT_GAP_Y : CLUSTER_GAP_Y;

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
				clusterGapY,
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
		const anchoredChildLayouts: AnchoredTopicLayout[] = [];
		for (const anchor of collapseChoiceAnchors(emittedAnchors).sort((left, right) => left.y - right.y || left.choiceValue - right.choiceValue)) {
			const childGroup = groupsByChoice.get(choiceGroupKey(anchor.choiceValue));
			if (!childGroup) {
				continue;
			}

			const childGroupKey = choiceGroupKey(childGroup.choiceValue);
			const cachedChildLayout = renderedGroupLayouts.get(childGroupKey);
			if (cachedChildLayout) {
				childLayouts.push(cachedChildLayout);
				anchoredChildLayouts.push({
					choiceValue: anchor.choiceValue,
					anchorY: anchor.y,
					layout: cachedChildLayout,
				});
				continue;
			}
			if (renderingGroups.has(childGroupKey)) {
				continue;
			}

			const childHeight = estimateChoiceGroupHeight(childGroup);
			const childStartY = Math.round(anchor.y - childHeight / 2);
			const childLayout = renderChoiceGroup(
				childGroup,
				anchor.x + FOLLOWUP_GROUP_GAP_X,
				childStartY,
			);
			childLayouts.push(childLayout);
			anchoredChildLayouts.push({
				choiceValue: anchor.choiceValue,
				anchorY: anchor.y,
				layout: childLayout,
			});
		}

		arrangeAnchoredChildLayouts(context, anchoredChildLayouts, CLUSTER_GAP_Y);
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
	const layoutNodeIds = uniqueValues(rootLayouts.flatMap((layout) => layout.nodeIds));

	let nextFallbackY = Number.isFinite(topicBottomY) ? topicBottomY + LANE_GAP_Y : 0;
	for (const group of orderChoiceGroupsForLanes(choiceGroups, phaseValue)) {
		if (renderedGroupLayouts.has(choiceGroupKey(group.choiceValue))) {
			continue;
		}

		const fallbackLayout = renderChoiceGroup(group, topicBaseX, nextFallbackY);
		rootEntryIds.push(...fallbackLayout.rootEntryIds);
		rootLayouts.push(fallbackLayout);
		layoutNodeIds.push(...fallbackLayout.nodeIds.filter((nodeId) => !layoutNodeIds.includes(nodeId)));
		nextFallbackY = fallbackLayout.bottomY + LANE_GAP_Y;
	}

	const mainLaneCenterY = rootLayouts[0]?.mainLaneCenterY ?? 0;
	return {
		rootEntryIds: uniqueValues(rootEntryIds),
		topY: Number.isFinite(topicTopY) ? topicTopY : 0,
		bottomY: Number.isFinite(topicBottomY) ? topicBottomY : 0,
		mainLaneCenterY,
		nodeIds: layoutNodeIds,
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

function arrangeAnchoredChildLayouts(
	context: CanvasLayoutContext,
	anchoredLayouts: AnchoredTopicLayout[],
	gapY: number,
): void {
	const orderedLayouts = [...anchoredLayouts]
		.filter((item) => item.layout.nodeIds.length > 0)
		.sort((left, right) => left.anchorY - right.anchorY || left.choiceValue - right.choiceValue);
	if (orderedLayouts.length === 0) {
		return;
	}

	const heights = orderedLayouts.map((item) => item.layout.bottomY - item.layout.topY);
	const cumulativeMinimumTops: number[] = [];
	let cumulativeTop = 0;
	for (let index = 0; index < orderedLayouts.length; index += 1) {
		cumulativeMinimumTops.push(cumulativeTop);
		cumulativeTop += (heights[index] ?? 0) + gapY;
	}

	const desiredOffsets = orderedLayouts.map((item, index) => {
		const minimumTop = cumulativeMinimumTops[index] ?? 0;
		const mainLaneOffset = item.layout.mainLaneCenterY - item.layout.topY;
		return item.anchorY - mainLaneOffset - minimumTop;
	});
	const compactOffsets = compactIncreasingOffsets(desiredOffsets);

	for (let index = 0; index < orderedLayouts.length; index += 1) {
		const item = orderedLayouts[index];
		if (!item) {
			continue;
		}

		const nextTop = Math.round((compactOffsets[index] ?? 0) + (cumulativeMinimumTops[index] ?? 0));
		shiftTopicLayout(context, item.layout, nextTop - item.layout.topY);
	}
}

function compactIncreasingOffsets(desiredOffsets: number[]): number[] {
	const blocks: Array<{ start: number; end: number; weight: number; total: number }> = [];
	for (let index = 0; index < desiredOffsets.length; index += 1) {
		blocks.push({
			start: index,
			end: index,
			weight: 1,
			total: desiredOffsets[index] ?? 0,
		});

		while (blocks.length >= 2) {
			const right = blocks[blocks.length - 1];
			const left = blocks[blocks.length - 2];
			if (!left || !right || left.total / left.weight <= right.total / right.weight) {
				break;
			}

			blocks.splice(blocks.length - 2, 2, {
				start: left.start,
				end: right.end,
				weight: left.weight + right.weight,
				total: left.total + right.total,
			});
		}
	}

	const offsets = new Array<number>(desiredOffsets.length);
	for (const block of blocks) {
		const value = block.total / block.weight;
		for (let index = block.start; index <= block.end; index += 1) {
			offsets[index] = value;
		}
	}
	return offsets;
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

	const heights = groups.map((group) => estimateChoiceGroupHeight(group));
	const totalHeight = heights.reduce((sum, height, index) => {
		const spacing = index === 0 ? 0 : LANE_GAP_Y;
		return sum + spacing + height;
	}, 0);
	const startYs = new Array<number>(groups.length);
	let cursorY = -Math.round(totalHeight / 2);

	for (let index = 0; index < groups.length; index += 1) {
		startYs[index] = cursorY;
		cursorY += (heights[index] ?? 0) + LANE_GAP_Y;
	}

	return startYs;
}

function choiceGroupUsesDenseVariantLayout(group: ChoiceGroup): boolean {
	return group.choiceValue === null
		&& group.families.length >= 4
		&& group.families.every((family) => !family.results.some((action) => action.kind === 'choice-set'));
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

function estimateChoiceGroupHeight(group: ChoiceGroup): number {
	if (group.families.length === 0) {
		return FILE_NODE_MIN_HEIGHT + CLUSTER_GAP_Y;
	}

	const clusterGapY = choiceGroupUsesDenseVariantLayout(group) ? DENSE_VARIANT_GAP_Y : CLUSTER_GAP_Y;
	return group.families.reduce((total, family) => total + estimateFamilyHeight(family, clusterGapY), 0);
}

function estimateFamilyHeight(family: BranchFamily, clusterGapY = CLUSTER_GAP_Y): number {
	let total = 0;
	for (const record of family.records) {
		const gateHeight = measureTextHeight(renderConditionBlock(record.conditions), GATE_WIDTH);
		const dialogueHeight = measureCanvasBodyHeight(record.bodyText, DIALOGUE_WIDTH);
		const localResultLines = record.resultActions
			.filter((action) => action.kind !== 'choice-set')
			.map((action) => action.displayText);
		const resultHeight = localResultLines.length > 0 ? measureTextHeight(localResultLines.join('\n'), DIALOGUE_WIDTH) + RESULT_GAP_Y : 0;
		total += Math.max(gateHeight, dialogueHeight) + resultHeight + clusterGapY;
	}
	return Math.max(total, FILE_NODE_MIN_HEIGHT + clusterGapY);
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

function choiceActionIdentity(action: ResultAction): string {
	return `${action.choiceValue ?? ''}:${action.displayText}`;
}

function choiceGroupKey(choiceValue: number | null): string {
	return choiceValue === null ? 'root' : String(choiceValue);
}

function sourceGroupStepX(): number {
	return (CHOICE_GAP_X - GATE_GAP_X) + FOLLOWUP_GROUP_GAP_X;
}

function connectChoiceTransitions(context: CanvasLayoutContext, records: DialogueRecord[]): void {
	const orderedRecordsByTopic = new Map<string, DialogueRecord[]>();
	for (const [topic, topicRecords] of groupRecordsByTopic(records)) {
		orderedRecordsByTopic.set(topic, orderTopicRecordsByInfoSequence(topicRecords));
	}

	const connected = new Set<string>();
	for (const anchor of context.choiceTransitionAnchors) {
		const targetRecords = resolveChoiceTransitionTargets(anchor, orderedRecordsByTopic);
		if (targetRecords.length === 0) {
			continue;
		}

		for (const targetRecord of targetRecords) {
			const entryNodeId = context.recordEntryNodeIds.get(targetRecord.id);
			if (!entryNodeId) {
				continue;
			}

			const connectionKey = `${anchor.nodeId}:${entryNodeId}:${anchor.choiceValue}`;
			if (connected.has(connectionKey)) {
				continue;
			}

			addEdge(context, connectionKey, anchor.nodeId, 'right', entryNodeId, 'left');
			connected.add(connectionKey);
		}
	}
}

function connectAddTopicTransitions(context: CanvasLayoutContext, records: DialogueRecord[]): void {
	const orderedRecordsByTopic = groupRecordsByNormalizedTopic(records);
	const transitions: AddTopicTransition[] = [];

	for (const sourceRecord of records) {
		for (const action of sourceRecord.resultActions) {
			if (action.kind !== 'add-topic' || !action.targetTopic) {
				continue;
			}

			const targetRecords = resolveAddTopicTransitionTargets(sourceRecord, action.targetTopic, orderedRecordsByTopic);
			if (targetRecords.length === 0) {
				continue;
			}

			const sourceNodeId = createNodeId(`dialogue:${sourceRecord.file.path}`);
			for (const targetRecord of targetRecords) {
				const targetNodeId = context.recordEntryNodeIds.get(targetRecord.id);
				if (!targetNodeId) {
					continue;
				}

				transitions.push({
					sourceRecord,
					sourceNodeId,
					targetNodeId,
				});
			}
		}
	}

	for (const transition of transitions) {
		addEdge(
			context,
			`${transition.sourceNodeId}:${transition.targetNodeId}:add-topic`,
			transition.sourceNodeId,
			'right',
			transition.targetNodeId,
			'left',
		);
	}

	placeAddTopicSourcesBeforeTargets(context, transitions);
}

function resolveAddTopicTransitionTargets(
	sourceRecord: DialogueRecord,
	targetTopic: string,
	orderedRecordsByTopic: Map<string, DialogueRecord[]>,
): DialogueRecord[] {
	const targetRecords = orderedRecordsByTopic.get(normalizeTopicKey(targetTopic)) ?? [];
	const candidates = targetRecords.filter((candidate) => conditionsCanFollowAddTopic(sourceRecord, candidate));
	if (candidates.length <= 1) {
		return candidates;
	}

	const scoredCandidates = candidates.map((candidate) => ({
		candidate,
		score: scoreAddTopicTransitionTarget(sourceRecord, candidate),
	}));
	const bestScore = Math.max(...scoredCandidates.map((item) => item.score));
	const bestCandidates = scoredCandidates
		.filter((item) => item.score === bestScore)
		.map((item) => item.candidate);

	return bestScore > 0 ? bestCandidates : [candidates[0] as DialogueRecord];
}

function placeAddTopicSourcesBeforeTargets(context: CanvasLayoutContext, transitions: AddTopicTransition[]): void {
	const lockedGroups = buildLockedVerticalGroups(context);
	const groupByNodeId = buildLockedGroupByNodeId(lockedGroups);

	for (const transition of transitions) {
		const sourceGroup = groupByNodeId.get(transition.sourceNodeId);
		const targetGroup = groupByNodeId.get(transition.targetNodeId);
		if (!sourceGroup || !targetGroup || sourceGroup.id === targetGroup.id) {
			continue;
		}

		const maximumSourceRightX = targetGroup.leftX - ADD_TOPIC_GAP_X;
		if (sourceGroup.rightX <= maximumSourceRightX) {
			continue;
		}

		shiftLockedGroup(sourceGroup, maximumSourceRightX - sourceGroup.rightX, 0);
	}
}

interface BranchSeparationGroup {
	id: string;
	nodeIds: Set<string>;
	rootIsJournalBranch: boolean;
}

interface BranchGroupBounds {
	group: BranchSeparationGroup;
	topY: number;
	bottomY: number;
	leftX: number;
	rightX: number;
	centerY: number;
}

function separateOverlappingBranchGroups(context: CanvasLayoutContext): void {
	const groups = buildBranchSeparationGroups(context);
	const maxPasses = Math.max(1, groups.length * groups.length);
	for (let pass = 0; pass < maxPasses; pass += 1) {
		const bounds = groups
			.map((group) => measureBranchGroup(context, group))
			.filter((item): item is BranchGroupBounds => item !== null)
			.sort((left, right) => left.centerY - right.centerY || left.leftX - right.leftX || left.group.id.localeCompare(right.group.id));
		let changed = false;

		for (let upperIndex = 0; upperIndex < bounds.length; upperIndex += 1) {
			const upper = bounds[upperIndex];
			if (!upper) {
				continue;
			}

			for (let lowerIndex = upperIndex + 1; lowerIndex < bounds.length; lowerIndex += 1) {
				const lower = bounds[lowerIndex];
				if (!lower) {
					continue;
				}
				if (
					upper.group.rootIsJournalBranch === lower.group.rootIsJournalBranch ||
					branchGroupsShareNodes(upper.group, lower.group) ||
					!branchGroupsOverlapHorizontally(upper, lower)
				) {
					continue;
				}

				const overlap = measureBranchGroupLockedOverlap(
					context,
					upper.group,
					lower.group,
					BRANCH_COLLISION_GAP_Y,
				);
				if (overlap <= 0) {
					continue;
				}

				const upperShift = -Math.ceil(overlap / 2);
				const lowerShift = Math.floor(overlap / 2);
				shiftBranchGroup(context, upper.group, upperShift);
				shiftBranchGroup(context, lower.group, lowerShift);
				changed = true;
			}
		}

		if (!changed) {
			return;
		}
	}
}

function buildBranchSeparationGroups(context: CanvasLayoutContext): BranchSeparationGroup[] {
	const outgoingNodes = new Map<string, string[]>();
	for (const edge of context.edges) {
		const outgoing = outgoingNodes.get(edge.fromNode) ?? [];
		outgoing.push(edge.toNode);
		outgoingNodes.set(edge.fromNode, outgoing);
	}

	const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
	const groups: BranchSeparationGroup[] = [];
	for (const node of context.nodes) {
		if (!isBranchSeparationParent(node)) {
			continue;
		}

		const nodeIds = collectLocalBranchNodeIds(node.id, nodeById, outgoingNodes);
		if (nodeIds.size < 8) {
			continue;
		}
		const rootIsJournalBranch = isJournalFileNode(node);
		if (rootIsJournalBranch && branchGroupContainsChoiceNode(nodeIds, nodeById)) {
			continue;
		}

		groups.push({
			id: node.id,
			nodeIds,
			rootIsJournalBranch,
		});
	}

	return mergeSharedBranchGroups(groups);
}

function isBranchSeparationParent(node: CanvasNode): boolean {
	return isJournalFileNode(node) || isChoiceNode(node);
}

function collectLocalBranchNodeIds(
	startNodeId: string,
	nodeById: Map<string, CanvasNode>,
	outgoingNodes: Map<string, string[]>,
): Set<string> {
	const nodeIds = new Set<string>();
	const queue = [startNodeId];

	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (!nodeId || nodeIds.has(nodeId)) {
			continue;
		}

		const node = nodeById.get(nodeId);
		if (!node) {
			continue;
		}
		if (nodeId !== startNodeId && isJournalFileNode(node)) {
			continue;
		}

		nodeIds.add(nodeId);
		for (const nextNodeId of outgoingNodes.get(nodeId) ?? []) {
			queue.push(nextNodeId);
		}
	}

	return nodeIds;
}

function branchGroupContainsChoiceNode(nodeIds: Set<string>, nodeById: Map<string, CanvasNode>): boolean {
	for (const nodeId of nodeIds) {
		const node = nodeById.get(nodeId);
		if (node && isChoiceNode(node)) {
			return true;
		}
	}

	return false;
}

function mergeSharedBranchGroups(groups: BranchSeparationGroup[]): BranchSeparationGroup[] {
	const mergedGroups: BranchSeparationGroup[] = [];
	for (const group of groups) {
		const existingGroup = mergedGroups.find((candidate) => branchGroupsShareNodes(candidate, group));
		if (!existingGroup) {
			mergedGroups.push({
				id: group.id,
				nodeIds: new Set(group.nodeIds),
				rootIsJournalBranch: group.rootIsJournalBranch,
			});
			continue;
		}

		for (const nodeId of group.nodeIds) {
			existingGroup.nodeIds.add(nodeId);
		}
		existingGroup.rootIsJournalBranch = existingGroup.rootIsJournalBranch && group.rootIsJournalBranch;
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (let index = 0; index < mergedGroups.length; index += 1) {
			const leftGroup = mergedGroups[index];
			if (!leftGroup) {
				continue;
			}

			for (let nextIndex = index + 1; nextIndex < mergedGroups.length; nextIndex += 1) {
				const rightGroup = mergedGroups[nextIndex];
				if (!rightGroup || !branchGroupsShareNodes(leftGroup, rightGroup)) {
					continue;
				}

				for (const nodeId of rightGroup.nodeIds) {
					leftGroup.nodeIds.add(nodeId);
				}
				leftGroup.rootIsJournalBranch = leftGroup.rootIsJournalBranch && rightGroup.rootIsJournalBranch;
				mergedGroups.splice(nextIndex, 1);
				changed = true;
				break;
			}

			if (changed) {
				break;
			}
		}
	}

	return mergedGroups;
}

function measureBranchGroup(
	context: CanvasLayoutContext,
	group: BranchSeparationGroup,
): BranchGroupBounds | null {
	const nodes = context.nodes.filter((node) => group.nodeIds.has(node.id));
	if (nodes.length === 0) {
		return null;
	}

	const topY = Math.min(...nodes.map((node) => node.y));
	const bottomY = Math.max(...nodes.map((node) => node.y + node.height));
	const leftX = Math.min(...nodes.map((node) => node.x));
	const rightX = Math.max(...nodes.map((node) => node.x + node.width));
	return {
		group,
		topY,
		bottomY,
		leftX,
		rightX,
		centerY: Math.round((topY + bottomY) / 2),
	};
}

function branchGroupsShareNodes(left: BranchSeparationGroup, right: BranchSeparationGroup): boolean {
	for (const nodeId of left.nodeIds) {
		if (right.nodeIds.has(nodeId)) {
			return true;
		}
	}

	return false;
}

function branchGroupsOverlapHorizontally(left: BranchGroupBounds, right: BranchGroupBounds): boolean {
	return left.leftX < right.rightX && right.leftX < left.rightX;
}

function measureBranchGroupLockedOverlap(
	context: CanvasLayoutContext,
	upperGroup: BranchSeparationGroup,
	lowerGroup: BranchSeparationGroup,
	gapY: number,
): number {
	const lockedGroups = [...buildLockedVerticalGroups(context).values()];
	const upperLockedGroups = lockedGroups.filter((group) => lockedGroupTouchesBranchGroup(group, upperGroup));
	const lowerLockedGroups = lockedGroups.filter((group) => lockedGroupTouchesBranchGroup(group, lowerGroup));
	let overlap = 0;

	for (const upperLockedGroup of upperLockedGroups) {
		for (const lowerLockedGroup of lowerLockedGroups) {
			if (
				upperLockedGroup.id === lowerLockedGroup.id ||
				!lockedGroupsOverlapHorizontally(upperLockedGroup, lowerLockedGroup) ||
				upperLockedGroup.topY > lowerLockedGroup.topY
			) {
				continue;
			}

			overlap = Math.max(overlap, upperLockedGroup.bottomY + gapY - lowerLockedGroup.topY);
		}
	}

	return overlap;
}

function lockedGroupTouchesBranchGroup(
	lockedGroup: LockedVerticalGroup,
	branchGroup: BranchSeparationGroup,
): boolean {
	return lockedGroup.nodes.some((node) => branchGroup.nodeIds.has(node.id));
}

interface RecordCluster {
	entryId: string;
	nodeIds: Set<string>;
	topY: number;
	bottomY: number;
	leftX: number;
	rightX: number;
}

interface ChoiceTargetCluster {
	entryId: string;
	cluster: RecordCluster;
	category: 'choice' | 'journal';
	choiceValue: number;
	sourceCenterY: number;
	anchors: Array<{ sourceNode: CanvasNode; targetNode: CanvasNode }>;
}

function balanceChoiceTargetRecordClusters(context: CanvasLayoutContext): void {
	for (let pass = 0; pass < 3; pass += 1) {
		const clustersByEntryId = buildRecordClustersByEntryId(context);
		const clusterItemsByColumn = new Map<number, ChoiceTargetCluster[]>();

		for (const edge of context.edges) {
			if (edge.fromSide !== 'right' || edge.toSide !== 'left') {
				continue;
			}

			const sourceNode = findCanvasNode(context, edge.fromNode);
			const targetNode = findCanvasNode(context, edge.toNode);
			if (!sourceNode || !targetNode || !isGateNode(targetNode)) {
				continue;
			}

			const targetCluster = clustersByEntryId.get(targetNode.id);
			if (!targetCluster) {
				continue;
			}

			const choiceValue = parseChoiceNodeValue(sourceNode);
			const category = isChoiceNode(sourceNode) ? 'choice' : isJournalFileNode(sourceNode) ? 'journal' : null;
			if (category === null) {
				continue;
			}

			const columnKey = recordClusterColumnKey(targetCluster);
			const columnItems = clusterItemsByColumn.get(columnKey) ?? [];
			let item = columnItems.find((candidate) => candidate.entryId === targetNode.id);
			if (!item) {
				item = {
					entryId: targetNode.id,
					cluster: targetCluster,
					category,
					choiceValue: choiceValue ?? Number.MAX_SAFE_INTEGER,
					sourceCenterY: edgeEndpoint(sourceNode, 'right').y,
					anchors: [],
				};
				columnItems.push(item);
			}

			if (item.category !== 'choice' && category === 'choice') {
				item.category = 'choice';
			}
			item.choiceValue = Math.min(item.choiceValue, choiceValue ?? Number.MAX_SAFE_INTEGER);
			item.anchors.push({ sourceNode, targetNode });
			item.sourceCenterY = averageNumbers(item.anchors.map((anchor) => edgeEndpoint(anchor.sourceNode, 'right').y));
			clusterItemsByColumn.set(columnKey, columnItems);
		}

		let changed = false;
		const orderedColumns = [...clusterItemsByColumn.entries()].sort((left, right) => left[0] - right[0]);
		for (const [, columnItems] of orderedColumns) {
			if (columnItems.length === 0) {
				continue;
			}

			const orderedItems = columnItems.sort(
				(left, right) => left.sourceCenterY - right.sourceCenterY
					|| compareRoutedClusterCategories(left.category, right.category)
					|| left.choiceValue - right.choiceValue
					|| left.cluster.topY - right.cluster.topY,
			);
			let nextTopY = Number.NEGATIVE_INFINITY;
			for (const item of orderedItems) {
				const targetNode = item.anchors[0]?.targetNode;
				if (!targetNode) {
					continue;
				}

				const desiredAnchorY = item.category === 'choice'
					? averageNumbers(item.anchors.map((anchor) => edgeEndpoint(anchor.sourceNode, 'right').y))
					: edgeEndpoint(targetNode, 'left').y;
				const targetOffsetY = edgeEndpoint(targetNode, 'left').y - item.cluster.topY;
				const desiredTopY = desiredAnchorY - targetOffsetY;
				const shouldCompactToPrevious = item.category === 'journal' && Number.isFinite(nextTopY);
				const nextTop = shouldCompactToPrevious ? nextTopY : Math.max(desiredTopY, nextTopY);
				const deltaY = Math.round(nextTop - item.cluster.topY);
				if (deltaY !== 0) {
					shiftRecordCluster(context, item.cluster, deltaY);
					changed = true;
				}
				nextTopY = item.cluster.bottomY + CLUSTER_GAP_Y;
			}
		}

		if (!changed) {
			return;
		}
	}
}

function recordClusterColumnKey(cluster: RecordCluster): number {
	return Math.round(cluster.leftX / 240) * 240;
}

function compareRoutedClusterCategories(left: 'choice' | 'journal', right: 'choice' | 'journal'): number {
	if (left === right) {
		return 0;
	}

	return left === 'choice' ? -1 : 1;
}

function buildRecordClustersByEntryId(context: CanvasLayoutContext): Map<string, RecordCluster> {
	const outgoingEdgesByNodeId = new Map<string, CanvasEdge[]>();
	for (const edge of context.edges) {
		const outgoingEdges = outgoingEdgesByNodeId.get(edge.fromNode) ?? [];
		outgoingEdges.push(edge);
		outgoingEdgesByNodeId.set(edge.fromNode, outgoingEdges);
	}

	const clustersByEntryId = new Map<string, RecordCluster>();
	for (const node of context.nodes) {
		if (!isGateNode(node)) {
			continue;
		}

		const nodeIds = collectRecordClusterNodeIds(context, node.id, outgoingEdgesByNodeId);
		clustersByEntryId.set(node.id, measureRecordCluster(context, node.id, nodeIds));
	}

	return clustersByEntryId;
}

function collectRecordClusterNodeIds(
	context: CanvasLayoutContext,
	entryId: string,
	outgoingEdgesByNodeId: Map<string, CanvasEdge[]>,
): Set<string> {
	const nodeIds = new Set<string>();
	const queue = [entryId];

	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (!nodeId || nodeIds.has(nodeId)) {
			continue;
		}

		const node = findCanvasNode(context, nodeId);
		if (!node) {
			continue;
		}

		nodeIds.add(nodeId);
		for (const edge of outgoingEdgesByNodeId.get(nodeId) ?? []) {
			const targetNode = findCanvasNode(context, edge.toNode);
			if (!targetNode) {
				continue;
			}

			if (isGateNode(node) && isDialogueFileNode(targetNode) && edge.fromSide === 'right' && edge.toSide === 'left') {
				queue.push(targetNode.id);
			} else if (isDialogueFileNode(node) && edge.fromSide === 'bottom' && edge.toSide === 'top') {
				queue.push(targetNode.id);
			} else if (isDialogueFileNode(node) && isChoiceNode(targetNode) && edge.fromSide === 'right' && edge.toSide === 'left') {
				queue.push(targetNode.id);
			}
		}
	}

	return nodeIds;
}

function measureRecordCluster(
	context: CanvasLayoutContext,
	entryId: string,
	nodeIds: Set<string>,
): RecordCluster {
	const nodes = context.nodes.filter((node) => nodeIds.has(node.id));
	return {
		entryId,
		nodeIds,
		topY: Math.min(...nodes.map((node) => node.y)),
		bottomY: Math.max(...nodes.map((node) => node.y + node.height)),
		leftX: Math.min(...nodes.map((node) => node.x)),
		rightX: Math.max(...nodes.map((node) => node.x + node.width)),
	};
}

function shiftRecordCluster(context: CanvasLayoutContext, cluster: RecordCluster, deltaY: number): void {
	for (const node of context.nodes) {
		if (cluster.nodeIds.has(node.id)) {
			node.y += deltaY;
		}
	}

	cluster.topY += deltaY;
	cluster.bottomY += deltaY;
}

function parseChoiceNodeValue(node: CanvasNode): number | null {
	const match = (node.text ?? '').match(/\bChoice\s+(-?\d+)/);
	return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function averageNumbers(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}

	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function findCanvasNode(context: CanvasLayoutContext, nodeId: string): CanvasNode | undefined {
	return context.nodes.find((node) => node.id === nodeId);
}

function shiftBranchGroup(context: CanvasLayoutContext, group: BranchSeparationGroup, deltaY: number): void {
	if (deltaY === 0) {
		return;
	}

	for (const node of context.nodes) {
		if (group.nodeIds.has(node.id)) {
			node.y += deltaY;
		}
	}
}

function assignDialogueInfoOrder(records: DialogueRecord[]): DialogueRecord[] {
	for (const topicRecords of groupRecordsByTopic(records).values()) {
		const orderedRecords = orderTopicRecordsByInfoSequence(topicRecords);
		for (let index = 0; index < orderedRecords.length; index += 1) {
			const record = orderedRecords[index];
			if (!record) {
				continue;
			}

			record.infoOrder = index;
		}
	}

	return records;
}

function resolveChoiceDerivedPhaseAnchors(records: DialogueRecord[]): DialogueRecord[] {
	const orderedRecordsByTopic = new Map<string, DialogueRecord[]>();
	for (const [topic, topicRecords] of groupRecordsByTopic(records)) {
		orderedRecordsByTopic.set(topic, orderTopicRecordsByInfoSequence(topicRecords));
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (const record of records) {
			for (const choiceValue of record.choiceTargets) {
				const targetRecords = resolveChoiceTransitionTargets(
					{
						topic: record.topic,
						choiceValue,
						nodeId: '',
						sourceRecords: [record],
					},
					orderedRecordsByTopic,
				);
				for (const targetRecord of targetRecords) {
					if (targetRecord.phaseAnchor >= record.phaseAnchor) {
						continue;
					}

					record.phaseAnchor = targetRecord.phaseAnchor;
					changed = true;
				}
			}
		}
	}

	return records;
}

function resolveChoiceTransitionTargets(
	anchor: ChoiceTransitionAnchor,
	orderedRecordsByTopic: Map<string, DialogueRecord[]>,
): DialogueRecord[] {
	const topicRecords = orderedRecordsByTopic.get(anchor.topic) ?? [];
	const targetRecords: Array<{ record: DialogueRecord; score: number }> = [];
	for (const candidate of topicRecords) {
		if (!candidate.choiceValues.includes(anchor.choiceValue)) {
			continue;
		}

		if (
			anchor.sourceRecords.some((sourceRecord) => (
				candidate.id !== sourceRecord.id
				&& conditionsCanFollowChoice(sourceRecord, candidate, anchor.choiceValue)
			))
		) {
			const score = Math.max(
				...anchor.sourceRecords.map((sourceRecord) => scoreChoiceTransitionTarget(sourceRecord, candidate)),
			);
			targetRecords.push({ record: candidate, score });
		}
	}

	if (targetRecords.length <= 1) {
		return targetRecords.map((target) => target.record);
	}

	const bestScore = Math.max(...targetRecords.map((target) => target.score));
	if (bestScore <= 0) {
		return targetRecords.map((target) => target.record);
	}

	return targetRecords
		.filter((target) => target.score === bestScore)
		.map((target) => target.record);
}

function orderTopicRecordsByInfoSequence(records: DialogueRecord[]): DialogueRecord[] {
	const recordsByDiagId = new Map<string, DialogueRecord>();
	const nextRecordsByPrevId = new Map<string, DialogueRecord[]>();
	for (const record of records) {
		if (record.diagId.length > 0) {
			recordsByDiagId.set(record.diagId, record);
		}
		if (record.prevId.length > 0) {
			const nextRecords = nextRecordsByPrevId.get(record.prevId) ?? [];
			nextRecords.push(record);
			nextRecordsByPrevId.set(record.prevId, nextRecords);
		}
	}

	const orderedRecords: DialogueRecord[] = [];
	const visitedRecordIds = new Set<string>();
	const visitRecord = (record: DialogueRecord): void => {
		if (visitedRecordIds.has(record.id)) {
			return;
		}

		orderedRecords.push(record);
		visitedRecordIds.add(record.id);
		for (const nextRecord of [...(nextRecordsByPrevId.get(record.diagId) ?? [])].sort(compareDialogueRecords)) {
			visitRecord(nextRecord);
		}
	};

	for (const record of [...records].sort(compareDialogueRecords)) {
		if (record.prevId.length > 0 && recordsByDiagId.has(record.prevId)) {
			continue;
		}
		visitRecord(record);
	}

	for (const record of [...records].sort(compareDialogueRecords)) {
		visitRecord(record);
	}

	return orderedRecords;
}

function conditionsCanFollowChoice(sourceRecord: DialogueRecord, candidate: DialogueRecord, choiceValue: number): boolean {
	const candidateChoiceConditions = candidate.conditions.filter((condition) => condition.kind === 'choice');
	if (
		candidateChoiceConditions.length > 0
		&& candidateChoiceConditions.some((condition) => condition.choiceValue !== choiceValue)
	) {
		return false;
	}

	if (!speakerConditionsAreCompatible(sourceRecord.speakerConditions, candidate.speakerConditions)) {
		return false;
	}

	const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
	for (const condition of candidate.conditions) {
		if (
			condition.kind !== 'journal'
			|| condition.questId === undefined
			|| condition.value === undefined
		) {
			continue;
		}

		const knownValue = knownJournalValues.get(condition.questId);
		if (knownValue !== undefined && !journalConditionMatches(knownValue, condition)) {
			return false;
		}
	}

	const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
	for (const condition of candidate.conditions) {
		if (
			condition.kind !== 'item'
			|| condition.questId === undefined
			|| condition.value === undefined
		) {
			continue;
		}

		const knownValue = knownItemValues.get(condition.questId);
		if (knownValue !== undefined && !numericConditionMatches(knownValue, condition)) {
			return false;
		}
	}

	return true;
}

function conditionsCanFollowAddTopic(sourceRecord: DialogueRecord, candidate: DialogueRecord): boolean {
	if (candidate.type !== 'Topic' || candidate.conditions.some((condition) => condition.kind === 'choice')) {
		return false;
	}

	if (!speakerConditionsAreCompatible(sourceRecord.speakerConditions, candidate.speakerConditions)) {
		return false;
	}

	const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
	for (const condition of candidate.conditions) {
		if (
			condition.kind !== 'journal'
			|| condition.questId === undefined
			|| condition.value === undefined
		) {
			continue;
		}

		const knownValue = knownJournalValues.get(condition.questId);
		if (knownValue !== undefined && !journalConditionMatches(knownValue, condition)) {
			return false;
		}
	}

	const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
	for (const condition of candidate.conditions) {
		if (
			condition.kind !== 'item'
			|| condition.questId === undefined
			|| condition.value === undefined
		) {
			continue;
		}

		const knownValue = knownItemValues.get(condition.questId);
		if (knownValue !== undefined && !numericConditionMatches(knownValue, condition)) {
			return false;
		}
	}

	return true;
}

function scoreAddTopicTransitionTarget(sourceRecord: DialogueRecord, candidate: DialogueRecord): number {
	const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
	const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
	let score = countMatchingSpeakerConditions(sourceRecord.speakerConditions, candidate.speakerConditions);

	for (const condition of candidate.conditions) {
		if (
			condition.kind === 'journal'
			&& condition.questId !== undefined
			&& condition.value !== undefined
		) {
			const knownValue = knownJournalValues.get(condition.questId);
			if (knownValue !== undefined && journalConditionMatches(knownValue, condition)) {
				score += 1;
			}
		}

		if (
			condition.kind === 'item'
			&& condition.questId !== undefined
			&& condition.value !== undefined
		) {
			const knownValue = knownItemValues.get(condition.questId);
			if (knownValue !== undefined && numericConditionMatches(knownValue, condition)) {
				score += 1;
			}
		}
	}

	return score;
}

function scoreChoiceTransitionTarget(sourceRecord: DialogueRecord, candidate: DialogueRecord): number {
	const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
	const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
	let score = countMatchingSpeakerConditions(sourceRecord.speakerConditions, candidate.speakerConditions);

	for (const condition of candidate.conditions) {
		if (
			condition.kind === 'journal'
			&& condition.questId !== undefined
			&& condition.value !== undefined
		) {
			const knownValue = knownJournalValues.get(condition.questId);
			if (knownValue !== undefined && journalConditionMatches(knownValue, condition)) {
				score += 1;
			}
		}

		if (
			condition.kind === 'item'
			&& condition.questId !== undefined
			&& condition.value !== undefined
		) {
			const knownValue = knownItemValues.get(condition.questId);
			if (knownValue !== undefined && numericConditionMatches(knownValue, condition)) {
				score += 1;
			}
		}
	}

	return score;
}

function speakerConditionsAreCompatible(sourceConditions: Condition[], candidateConditions: Condition[]): boolean {
	const sourceValuesByLabel = new Map<string, string>();
	for (const condition of sourceConditions) {
		const parsed = parseSpeakerConditionDisplayText(condition.displayText);
		if (!parsed) {
			continue;
		}
		sourceValuesByLabel.set(parsed.label, parsed.value.toLowerCase());
	}

	for (const condition of candidateConditions) {
		const parsed = parseSpeakerConditionDisplayText(condition.displayText);
		if (!parsed) {
			continue;
		}

		const sourceValue = sourceValuesByLabel.get(parsed.label);
		if (sourceValue !== undefined && sourceValue !== parsed.value.toLowerCase()) {
			return false;
		}
	}

	return true;
}

function countMatchingSpeakerConditions(sourceConditions: Condition[], candidateConditions: Condition[]): number {
	const sourceValuesByLabel = new Map<string, string>();
	for (const condition of sourceConditions) {
		const parsed = parseSpeakerConditionDisplayText(condition.displayText);
		if (!parsed) {
			continue;
		}
		sourceValuesByLabel.set(parsed.label, parsed.value.toLowerCase());
	}

	let count = 0;
	for (const condition of candidateConditions) {
		const parsed = parseSpeakerConditionDisplayText(condition.displayText);
		if (!parsed) {
			continue;
		}

		const sourceValue = sourceValuesByLabel.get(parsed.label);
		if (sourceValue !== undefined && sourceValue === parsed.value.toLowerCase()) {
			count += 1;
		}
	}

	return count;
}

function parseSpeakerConditionDisplayText(displayText: string): { label: string; value: string } | null {
	const separator = displayText.indexOf(' = ');
	if (separator === -1) {
		return null;
	}

	return {
		label: displayText.slice(0, separator),
		value: displayText.slice(separator + 3),
	};
}

function collectKnownJournalValuesAfterResult(record: DialogueRecord): Map<string, number> {
	const knownValues = new Map<string, number>();
	for (const condition of record.conditions) {
		if (
			condition.kind === 'journal'
			&& condition.questId !== undefined
			&& condition.value !== undefined
			&& condition.operator === '='
		) {
			knownValues.set(condition.questId, condition.value);
		}
	}

	for (const action of record.resultActions) {
		if (
			action.kind === 'journal-set'
			&& action.targetQuestId !== undefined
			&& action.targetJournalIndex !== undefined
		) {
			knownValues.set(action.targetQuestId, action.targetJournalIndex);
		}
	}

	return knownValues;
}

function collectKnownItemValues(conditions: Condition[]): Map<string, number> {
	const knownValues = new Map<string, number>();
	for (const condition of conditions) {
		if (
			condition.kind !== 'item'
			|| condition.questId === undefined
			|| condition.value === undefined
			|| condition.operator !== '='
		) {
			continue;
		}

		knownValues.set(condition.questId, condition.value);
	}

	return knownValues;
}

function journalConditionMatches(value: number, condition: Condition): boolean {
	if (condition.value === undefined) {
		return true;
	}

	return numericConditionMatches(value, condition);
}

function numericConditionMatches(value: number, condition: Condition): boolean {
	if (condition.value === undefined) {
		return true;
	}

	switch (condition.operator) {
		case '<=':
			return value <= condition.value;
		case '>=':
			return value >= condition.value;
		case '<':
			return value < condition.value;
		case '>':
			return value > condition.value;
		case '!=':
			return value !== condition.value;
		case '==':
			return value === condition.value;
		case '=':
		default:
			return value === condition.value;
	}
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

function compactHorizontalConnectionLayout(context: CanvasLayoutContext): void {
	const lockedGroups = buildLockedVerticalGroups(context);
	const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
	const groupByNodeId = buildLockedGroupByNodeId(lockedGroups);
	const incomingEdgesByGroup = new Map<string, CanvasEdge[]>();

	for (const edge of context.edges) {
		if (edge.fromSide !== 'right' || edge.toSide !== 'left') {
			continue;
		}

		const fromGroup = groupByNodeId.get(edge.fromNode);
		const toGroup = groupByNodeId.get(edge.toNode);
		if (!fromGroup || !toGroup || fromGroup.id === toGroup.id) {
			continue;
		}

		const incomingEdges = incomingEdgesByGroup.get(toGroup.id) ?? [];
		incomingEdges.push(edge);
		incomingEdgesByGroup.set(toGroup.id, incomingEdges);
	}

	const orderedGroups = [...lockedGroups.values()].sort(
		(left, right) => left.leftX - right.leftX || left.topY - right.topY || left.id.localeCompare(right.id),
	);
	const baseLeftX = Math.min(...orderedGroups.map((group) => group.leftX));
	const compactLeftByGroupId = new Map<string, number>();

	for (const group of orderedGroups) {
		const incomingEdges = incomingEdgesByGroup.get(group.id) ?? [];
		let compactLeftX = incomingEdges.length > 0 ? 0 : group.leftX - baseLeftX;

		for (const edge of incomingEdges) {
			const fromGroup = groupByNodeId.get(edge.fromNode);
			const toGroup = groupByNodeId.get(edge.toNode);
			const fromNode = nodeById.get(edge.fromNode);
			const toNode = nodeById.get(edge.toNode);
			if (!fromGroup || !toGroup || !fromNode || !toNode) {
				continue;
			}

			const compactFromLeftX = compactLeftByGroupId.get(fromGroup.id) ?? fromGroup.leftX - baseLeftX;
			const sourceRightOffset = fromNode.x + fromNode.width - fromGroup.leftX;
			const targetLeftOffset = toNode.x - toGroup.leftX;
			const sourceEndpointX = edgeEndpoint(fromNode, edge.fromSide).x;
			const targetEndpointX = edgeEndpoint(toNode, edge.toSide).x;
			const compactGapX = compactEdgeGapX(edge, fromNode, toNode, targetEndpointX - sourceEndpointX);
			compactLeftX = Math.max(
				compactLeftX,
				compactFromLeftX + sourceRightOffset + compactGapX - targetLeftOffset,
			);
		}

		compactLeftByGroupId.set(group.id, compactLeftX);
	}

	for (const group of orderedGroups) {
		const compactLeftX = compactLeftByGroupId.get(group.id);
		if (compactLeftX === undefined) {
			continue;
		}

		shiftLockedGroup(group, Math.round(baseLeftX + compactLeftX - group.leftX), 0);
	}
}

function buildLockedGroupByNodeId(lockedGroups: Map<string, LockedVerticalGroup>): Map<string, LockedVerticalGroup> {
	const groupByNodeId = new Map<string, LockedVerticalGroup>();
	for (const group of lockedGroups.values()) {
		for (const node of group.nodes) {
			groupByNodeId.set(node.id, group);
		}
	}
	return groupByNodeId;
}

function compactEdgeGapX(
	edge: CanvasEdge,
	fromNode: CanvasNode,
	toNode: CanvasNode,
	currentGapX: number,
): number {
	if (edge.fromSide !== 'right' || edge.toSide !== 'left') {
		return MIN_HORIZONTAL_EDGE_GAP_X;
	}

	if (isGateNode(fromNode) && isDialogueFileNode(toNode)) {
		return Math.max(MIN_HORIZONTAL_EDGE_GAP_X, Math.min(currentGapX, MIN_HORIZONTAL_EDGE_GAP_X));
	}

	if (isDialogueFileNode(fromNode) && isChoiceNode(toNode)) {
		return Math.max(MIN_HORIZONTAL_EDGE_GAP_X, Math.min(currentGapX, 160));
	}

	return Math.max(MIN_HORIZONTAL_EDGE_GAP_X, Math.min(currentGapX, MAX_COMPACT_EDGE_GAP_X));
}

function edgeEndpoint(
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

function isChoiceNode(node: CanvasNode): boolean {
	return node.type === 'text' && /^".*"\s+-\s+Choice\s+-?\d+/.test(node.text ?? '');
}

function isGateNode(node: CanvasNode): boolean {
	return node.type === 'text' && !isChoiceNode(node);
}

function isDialogueFileNode(node: CanvasNode): boolean {
	return node.type === 'file' && !node.file?.includes(`/${JOURNAL_FOLDER_NAME}/`);
}

function isJournalFileNode(node: CanvasNode): boolean {
	return node.type === 'file' && Boolean(node.file?.includes(`/${JOURNAL_FOLDER_NAME}/`));
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

				shiftLockedGroup(lowerGroup, 0, minimumLowerY - lowerGroup.topY);
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

function shiftLockedGroup(group: LockedVerticalGroup, deltaX: number, deltaY: number): void {
	if (deltaX === 0 && deltaY === 0) {
		return;
	}

	for (const node of group.nodes) {
		node.x += deltaX;
		node.y += deltaY;
	}

	group.leftX += deltaX;
	group.rightX += deltaX;
	group.topY += deltaY;
	group.bottomY += deltaY;
}

function normalizeCanvasOrigin(context: CanvasLayoutContext): void {
	if (context.nodes.length === 0) {
		return;
	}

	const minimumX = Math.min(...context.nodes.map((node) => node.x));
	const targetX = context.nodes.some((node) => isAddTopicResultNode(node)) ? INTRODUCER_ORIGIN_X : 0;
	const deltaX = targetX - minimumX;
	if (deltaX === 0) {
		return;
	}

	for (const node of context.nodes) {
		node.x += deltaX;
	}
}

function enforceGateDialogueCenterAlignment(context: CanvasLayoutContext): void {
	const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
	for (const edge of context.edges) {
		if (edge.fromSide !== 'right' || edge.toSide !== 'left') {
			continue;
		}

		const gateNode = nodeById.get(edge.fromNode);
		const dialogueNode = nodeById.get(edge.toNode);
		if (!gateNode || !dialogueNode || !isGateNode(gateNode) || !isDialogueFileNode(dialogueNode)) {
			continue;
		}

		gateNode.y = Math.round(dialogueNode.y + dialogueNode.height / 2 - gateNode.height / 2);
	}
}

function isAddTopicResultNode(node: CanvasNode): boolean {
	return node.type === 'text' && (node.text ?? '').startsWith('AddTopic ');
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
		finished: getBooleanValue(document.frontmatter, 'Finished'),
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
		infoOrder: Number.MAX_SAFE_INTEGER,
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
			const itemCondition = parseNumericVariableCondition(rawVariable);
			conditions.push({
				kind: 'item',
				displayText: `Item - ${rawVariable}`,
				questId: itemCondition?.id,
				operator: itemCondition?.operator,
				value: itemCondition?.value,
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

	const journalMatch = rawVariable.match(new RegExp(`([^\\s]+)\\s*${NUMERIC_OPERATOR_PATTERN}\\s*(-?\\d+)`));
	if (!journalMatch) {
		return {
			kind: 'journal',
			displayText: `Journal - ${rawVariable}`,
			questId: matchingQuestId,
		};
	}

	const journalQuestId = journalMatch[1] ?? matchingQuestId;
	const journalOperator = normalizeNumericOperator(journalMatch[2]);
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

function parseNumericVariableCondition(rawVariable: string): { id: string; operator: NumericOperator; value: number } | null {
	const variableMatch = rawVariable.match(new RegExp(`([^\\s]+)\\s*${NUMERIC_OPERATOR_PATTERN}\\s*(-?\\d+)`));
	if (!variableMatch) {
		return null;
	}

	const id = variableMatch[1];
	const operator = normalizeNumericOperator(variableMatch[2]);
	const value = variableMatch[3];
	if (id === undefined || operator === undefined || value === undefined) {
		return null;
	}

	return {
		id,
		operator,
		value: Number.parseInt(value, 10),
	};
}

function normalizeNumericOperator(operator: string | undefined): NumericOperator {
	if (operator === '<=' || operator === '>=' || operator === '<' || operator === '>' || operator === '==' || operator === '!=') {
		return operator;
	}
	return '=';
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

		const addTopicTarget = parseAddTopicTarget(line);
		if (addTopicTarget) {
			actions.push({
				kind: 'add-topic',
				displayText: `AddTopic "[[${addTopicTarget}]]"`,
				targetTopic: addTopicTarget,
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

function parseAddTopicTarget(line: string): string | null {
	const match = line.match(/^AddTopic\s+(.+)$/i);
	if (!match) {
		return null;
	}

	const target = stripQuotes(match[1] ?? '').trim();
	return target.length > 0 ? stripWikilinkSyntax(target) : null;
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
	const recordsByNormalizedTopic = groupRecordsByNormalizedTopic(allRecords);

	let changed = true;
	while (changed) {
		changed = false;

		for (const record of allRecords) {
			if (
				record.choiceTargets.length === 0
				&& !record.resultActions.some((action) => action.kind === 'add-topic')
			) {
				continue;
			}
			if (hasOnlyJournalResultsForOtherQuests(record, questIds)) {
				continue;
			}

			const topicRecords = recordsByTopic.get(record.topic) ?? [];
			if (relevant.has(record.id)) {
				for (const candidate of resolveChoiceTargetRecords(record, topicRecords)) {
					if (hasOnlyJournalResultsForOtherQuests(candidate, questIds) || relevant.has(candidate.id)) {
						continue;
					}

					relevant.add(candidate.id);
					changed = true;
				}
				for (const candidate of resolveAddTopicTargetRecords(record, recordsByNormalizedTopic)) {
					if (hasOnlyJournalResultsForOtherQuests(candidate, questIds) || relevant.has(candidate.id)) {
						continue;
					}

					relevant.add(candidate.id);
					changed = true;
				}
				continue;
			}

			if (recordLeadsToRelevantRecord(record, topicRecords, recordsByNormalizedTopic, relevant)) {
				relevant.add(record.id);
				changed = true;
			}
		}
	}

	return relevant;
}

function recordLeadsToRelevantRecord(
	record: DialogueRecord,
	topicRecords: DialogueRecord[],
	recordsByNormalizedTopic: Map<string, DialogueRecord[]>,
	relevant: Set<string>,
): boolean {
	return resolveChoiceTargetRecords(record, topicRecords).some((candidate) => relevant.has(candidate.id))
		|| resolveAddTopicTargetRecords(record, recordsByNormalizedTopic).some((candidate) => relevant.has(candidate.id));
}

function resolveChoiceTargetRecords(
	sourceRecord: DialogueRecord,
	topicRecords: DialogueRecord[],
): DialogueRecord[] {
	const targetRecords: DialogueRecord[] = [];
	for (const candidate of topicRecords) {
		if (candidate.id === sourceRecord.id) {
			continue;
		}

		if (
			sourceRecord.choiceTargets.some((value) => (
				candidate.choiceValues.includes(value)
					&& conditionsCanFollowChoice(sourceRecord, candidate, value)
			))
		) {
			targetRecords.push(candidate);
		}
	}

	return targetRecords;
}

function resolveAddTopicTargetRecords(
	sourceRecord: DialogueRecord,
	recordsByNormalizedTopic: Map<string, DialogueRecord[]>,
): DialogueRecord[] {
	const targetRecords: DialogueRecord[] = [];
	for (const action of sourceRecord.resultActions) {
		if (action.kind !== 'add-topic' || !action.targetTopic) {
			continue;
		}

		const resolvedTargets = resolveAddTopicTransitionTargets(sourceRecord, action.targetTopic, recordsByNormalizedTopic);
		for (const targetRecord of resolvedTargets) {
			if (!targetRecords.some((candidate) => candidate.id === targetRecord.id)) {
				targetRecords.push(targetRecord);
			}
		}
	}
	return targetRecords;
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
	const recordsByTopic = groupRecordsByTopic(allRecords);

	for (const record of allRecords) {
		ancestorsByRecordId.set(record.id, new Set<string>());
	}

	for (const record of allRecords) {
		const recordAncestors = ancestorsByRecordId.get(record.id);
		if (!recordAncestors) {
			continue;
		}

		const topicRecords = recordsByTopic.get(record.topic) ?? [];
		for (const candidate of topicRecords) {
			if (candidate.id === record.id || candidate.choiceTargets.length === 0) {
				continue;
			}

			if (
				candidate.choiceTargets.some((value) => (
					record.choiceValues.includes(value)
						&& conditionsCanFollowChoice(candidate, record, value)
				))
			) {
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
	if (left.type === right.type && left.topic === right.topic) {
		return compareFamilyChoiceBreadth(left, right)
			|| compareFamilyInfoOrder(left, right)
			|| left.priority - right.priority
			|| compareNullableNumbers(left.progressionTarget, right.progressionTarget)
			|| left.records[0]?.file.path.localeCompare(right.records[0]?.file.path ?? '')
			|| 0;
	}

	return left.priority - right.priority
		|| compareNullableNumbers(left.progressionTarget, right.progressionTarget)
		|| left.topic.localeCompare(right.topic)
		|| left.records[0]?.file.path.localeCompare(right.records[0]?.file.path ?? '')
		|| 0;
}

function compareFamilyChoiceBreadth(left: BranchFamily, right: BranchFamily): number {
	const leftChoices = familyChoiceValues(left);
	const rightChoices = familyChoiceValues(right);
	if (leftChoices.length === 0 && rightChoices.length === 0) {
		return 0;
	}

	return leftChoices.length - rightChoices.length
		|| compareNullableNumbers(maxNumber(leftChoices), maxNumber(rightChoices));
}

function familyChoiceValues(family: BranchFamily): number[] {
	return uniqueNumbers(
		family.results
			.filter((action) => action.kind === 'choice-set' && action.choiceValue !== undefined)
			.map((action) => action.choiceValue as number),
	);
}

function maxNumber(values: number[]): number | null {
	return values.length > 0 ? Math.max(...values) : null;
}

function compareDialogueRecords(left: DialogueRecord, right: DialogueRecord): number {
	return compareInfoOrder(left, right)
		|| normalizeConditionKey(left.speakerConditions).localeCompare(normalizeConditionKey(right.speakerConditions))
		|| left.file.path.localeCompare(right.file.path);
}

function compareFamilyInfoOrder(left: BranchFamily, right: BranchFamily): number {
	return minFamilyInfoOrder(left) - minFamilyInfoOrder(right);
}

function minFamilyInfoOrder(family: BranchFamily): number {
	return Math.min(...family.records.map((record) => record.infoOrder), Number.MAX_SAFE_INTEGER);
}

function compareInfoOrder(left: DialogueRecord, right: DialogueRecord): number {
	if (left.topic !== right.topic || left.type !== right.type) {
		return 0;
	}

	return left.infoOrder - right.infoOrder;
}

function determinePhaseAnchor(
	conditions: Condition[],
	resultActions: ResultAction[],
	phaseIndices: number[],
	questIds: string[],
): number {
	const conditionAnchor = determineJournalConditionPhaseAnchor(conditions, phaseIndices, questIds);
	const journalResult = firstJournalResultAction(resultActions, questIds);
	if (journalResult?.targetJournalIndex !== undefined) {
		const resultAnchor = previousPhaseBefore(journalResult.targetJournalIndex, phaseIndices);
		if (
			!conditions.some((condition) => condition.kind === 'choice')
			|| journalResultCanRunBeforeTarget(conditions, journalResult)
		) {
			return resultAnchor;
		}
	}

	if (conditionAnchor !== null && conditions.some((condition) => condition.kind === 'choice')) {
		return conditionAnchor;
	}

	if (conditionAnchor !== null) {
		return conditionAnchor;
	}

	return phaseIndices[0] ?? 0;
}

function journalResultCanRunBeforeTarget(conditions: Condition[], resultAction: ResultAction): boolean {
	if (
		resultAction.targetQuestId === undefined
		|| resultAction.targetJournalIndex === undefined
	) {
		return true;
	}

	const targetQuestConditions = conditions.filter(
		(condition) => condition.kind === 'journal'
			&& condition.questId === resultAction.targetQuestId
			&& condition.value !== undefined,
	);
	if (targetQuestConditions.length === 0) {
		return true;
	}

	return targetQuestConditions.every(
		(condition) => journalConditionAllowsValueBeforeTarget(condition, resultAction.targetJournalIndex as number),
	);
}

function journalConditionAllowsValueBeforeTarget(condition: Condition, targetJournalIndex: number): boolean {
	if (condition.value === undefined) {
		return true;
	}

	switch (condition.operator) {
		case '=':
		case '==':
			return condition.value < targetJournalIndex;
		case '>':
		case '>=':
			return condition.value < targetJournalIndex;
		case '<':
		case '<=':
			return targetJournalIndex > PRE_JOURNAL_PHASE;
		case '!=':
		default:
			return condition.value !== PRE_JOURNAL_PHASE || targetJournalIndex > PRE_JOURNAL_PHASE + 1;
	}
}

function determineJournalConditionPhaseAnchor(
	conditions: Condition[],
	phaseIndices: number[],
	questIds: string[],
): number | null {
	const journalConditions = conditions.filter(
		(condition) => condition.kind === 'journal'
			&& condition.value !== undefined
			&& condition.questId !== undefined
			&& questIds.includes(condition.questId),
	);
	if (journalConditions.length === 0) {
		return conditions.some((condition) => condition.kind === 'journal') ? phaseIndices[0] ?? 0 : null;
	}

	const matchingPhases = phaseIndices.filter(
		(phaseValue) => journalConditions.every((condition) => journalConditionMatches(phaseValue, condition)),
	);
	if (matchingPhases.length > 0) {
		return matchingPhases[0] ?? phaseIndices[0] ?? 0;
	}

	return nearestPhaseForJournalCondition(journalConditions[0], phaseIndices);
}

function linkedJournalConditionPhases(
	conditions: Condition[],
	milestones: JournalMilestone[],
	questIds: string[],
): number[] {
	const journalConditions = conditions.filter(
		(condition) => condition.kind === 'journal'
			&& condition.value !== undefined
			&& condition.questId !== undefined
			&& questIds.includes(condition.questId),
	);
	if (journalConditions.length === 0) {
		return [];
	}

	const conditionsByQuest = groupJournalConditionsByQuest(journalConditions);
	const matchingMilestones = milestones
		.filter((milestone) => milestone.index > 0)
		.filter((milestone) => {
			const questConditions = conditionsByQuest.get(milestone.questId);
			return questConditions !== undefined
				&& questConditions.every((condition) => journalConditionMatches(milestone.index, condition));
		})
		.sort(compareJournalMilestones);
	const firstMatching = matchingMilestones[0];
	if (!firstMatching) {
		return [];
	}
	if (!firstMatching.finished) {
		return [firstMatching.index];
	}

	return uniqueNumbers(matchingMilestones
		.filter((milestone) => milestone.finished)
		.map((milestone) => milestone.index));
}

function groupJournalConditionsByQuest(conditions: Condition[]): Map<string, Condition[]> {
	const conditionsByQuest = new Map<string, Condition[]>();
	for (const condition of conditions) {
		if (condition.questId === undefined) {
			continue;
		}

		const questConditions = conditionsByQuest.get(condition.questId) ?? [];
		questConditions.push(condition);
		conditionsByQuest.set(condition.questId, questConditions);
	}
	return conditionsByQuest;
}

function compareJournalMilestones(left: JournalMilestone, right: JournalMilestone): number {
	const byIndex = left.index - right.index;
	if (byIndex !== 0) {
		return byIndex;
	}

	return left.file.path.localeCompare(right.file.path);
}

function nearestPhaseForJournalCondition(condition: Condition | undefined, phaseIndices: number[]): number | null {
	if (!condition || condition.value === undefined) {
		return phaseIndices[0] ?? 0;
	}

	switch (condition.operator) {
		case '>':
			return firstPhaseAbove(condition.value, phaseIndices) ?? nearestPhaseAtOrBelow(condition.value, phaseIndices);
		case '>=':
		case '=':
		case '==':
			return firstPhaseAtOrAbove(condition.value, phaseIndices) ?? nearestPhaseAtOrBelow(condition.value, phaseIndices);
		case '<':
			return lastPhaseBelow(condition.value, phaseIndices) ?? phaseIndices[0] ?? condition.value;
		case '<=':
			return nearestPhaseAtOrBelow(condition.value, phaseIndices);
		case '!=':
		default:
			return nearestPhaseAtOrBelow(condition.value, phaseIndices);
	}
}

function nearestPhaseAtOrBelow(value: number, phaseIndices: number[]): number {
	const eligible = phaseIndices.filter((phaseValue) => phaseValue <= value);
	if (eligible.length > 0) {
		return eligible[eligible.length - 1] ?? phaseIndices[0] ?? value;
	}
	return phaseIndices[0] ?? value;
}

function firstPhaseAtOrAbove(value: number, phaseIndices: number[]): number | null {
	return phaseIndices.find((phaseValue) => phaseValue >= value) ?? null;
}

function firstPhaseAbove(value: number, phaseIndices: number[]): number | null {
	return phaseIndices.find((phaseValue) => phaseValue > value) ?? null;
}

function lastPhaseBelow(value: number, phaseIndices: number[]): number | null {
	const lower = phaseIndices.filter((phaseValue) => phaseValue < value);
	return lower[lower.length - 1] ?? null;
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
	return firstJournalResultAction(resultActions, questIds)?.targetJournalIndex ?? null;
}

function firstJournalResultAction(resultActions: ResultAction[], questIds: string[]): ResultAction | null {
	let earliestTarget: number | null = null;
	let earliestAction: ResultAction | null = null;
	for (const action of resultActions) {
		if (
			action.kind === 'journal-set'
			&& action.targetJournalIndex !== undefined
			&& action.targetQuestId !== undefined
			&& questIds.includes(action.targetQuestId)
		) {
			if (earliestTarget === null || action.targetJournalIndex < earliestTarget) {
				earliestTarget = action.targetJournalIndex;
				earliestAction = action;
			}
		}
	}
	return earliestAction;
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

function nodeCanReach(context: CanvasLayoutContext, fromNode: string, toNode: string): boolean {
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

function groupRecordsByNormalizedTopic(records: DialogueRecord[]): Map<string, DialogueRecord[]> {
	const grouped = new Map<string, DialogueRecord[]>();
	for (const record of records) {
		const topicKey = normalizeTopicKey(record.topic);
		const topicRecords = grouped.get(topicKey) ?? [];
		topicRecords.push(record);
		grouped.set(topicKey, topicRecords);
	}

	for (const [topicKey, topicRecords] of grouped) {
		grouped.set(topicKey, orderTopicRecordsByInfoSequence(topicRecords));
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

function hasOnlyJournalResultsForOtherQuests(record: DialogueRecord, questIds: string[]): boolean {
	const journalResults = record.resultActions.filter(
		(action) => action.kind === 'journal-set' && Boolean(action.targetQuestId),
	);
	return journalResults.length > 0
		&& journalResults.every((action) => !questIds.includes(action.targetQuestId as string));
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

function normalizeTopicKey(text: string): string {
	return stripWikilinkSyntax(stripQuotes(text))
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
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

function getBooleanValue(frontmatter: Record<string, FrontmatterValue>, key: string): boolean {
	return getStringValue(frontmatter, key)?.toLowerCase() === 'true';
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

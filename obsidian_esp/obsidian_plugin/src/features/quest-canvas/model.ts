import { TFile, TFolder } from 'obsidian';

export const DIALOGUE_TYPES = ['Greeting', 'Topic', 'Persuasion', 'Voice'] as const;

export const CANVAS_BODY_BLOCK_PREFIX = 'obsidian-esp-canvas';

export const QUEST_NAME_FIELD = 'Quest Name';

export const JOURNAL_FOLDER_NAME = 'Journal';

export const QUESTS_FOLDER_NAME = 'Quests';

export const DIALOGUE_COLOR = '3';

export const GATE_COLOR = '4';

export const RESULT_COLOR = '5';

export const JOURNAL_COLOR = '6';

export const JUMP_COLOR = '2';

export const GATE_WIDTH = 385;

export const CHOICE_WIDTH = 320;

export const DIALOGUE_WIDTH = 440;

export const JOURNAL_WIDTH = 440;

export const JUMP_WIDTH = 128;

export const FILE_NODE_MIN_HEIGHT = 96;

export const FILE_NODE_PADDING_Y = 40;

export const TEXT_NODE_HORIZONTAL_PADDING = 48;

export const APPROX_TEXT_CHAR_WIDTH = 8;

export const PHASE_GAP_X = 1320;

export const GATE_GAP_X = 520;

export const DIALOGUE_GAP_X = 980;

export const CHOICE_GAP_X = 1580;

export const LANE_GAP_Y = 560;

export const RESULT_GAP_Y = 30;

export const TOPIC_SEGMENT_GAP_X = 1920;

export const FOLLOWUP_GROUP_GAP_X = 500;

export const CLUSTER_GAP_Y = 140;

export const DENSE_VARIANT_GAP_Y = 64;

export const INTRODUCER_ORIGIN_X = -GATE_GAP_X;

export const MIN_HORIZONTAL_EDGE_GAP_X = 75;

export const LAYER_GAP_X = 180;

export const LAYER_UNIT_GAP_Y = 160;

export const CHOICE_STACK_GAP_Y = 24;

export const SPACER_UNIT_SIZE = 110;

export const SPACER_UNIT_GAP_Y = 70;

export const PRE_JOURNAL_PHASE = 0;

export const NUMERIC_OPERATOR_PATTERN = '(<=|>=|==|!=|=|<|>)';

export type DialogueType = (typeof DIALOGUE_TYPES)[number];

export type FrontmatterValue = string | string[];

export interface MarkdownDocument {
	file: TFile;
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
}

export interface QuestScope {
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

export interface JournalMilestone {
	id: string;
	questId: string;
	questTitle: string;
	index: number;
	finished: boolean;
	file: TFile;
	summary: string;
}

/**
 * The subset of {@link JournalMilestone} needed to render `Journal` result
 * lines as wikilinks. The sync engine reconstructs these from canvas
 * provenance metadata, where no TFile is available.
 */
export interface MilestoneLink {
	questId: string;
	index: number;
	file: { path: string };
}

export interface Condition {
	kind: 'speaker' | 'journal' | 'item' | 'variable' | 'choice' | 'other';
	displayText: string;
	questId?: string;
	value?: number;
	operator?: NumericOperator;
	choiceValue?: number;
}

export type NumericOperator = '<=' | '>=' | '<' | '>' | '=' | '==' | '!=';

export interface ResultAction {
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
	/** choice-set only: the bare prompt string (canvas choice-card text). */
	choiceText?: string;
	targetTopic?: string;
}

export interface DialogueRecord {
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
	sourcePhaseAnchor: number;
	directlyRelevant: boolean;
	conditionQuestReferences: string[];
	resultQuestReferences: string[];
	ownedQuestReferences: string[];
	questReferences: string[];
	infoOrder: number;
	primaryChoiceValue: number | null;
	choiceValues: number[];
	choiceTargets: number[];
	suppressChoiceTransitions?: boolean;
}

export interface BranchFamily {
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

export interface ChoiceGroup {
	choiceValue: number | null;
	families: BranchFamily[];
}

export interface ChoiceAnchor {
	choiceValue: number;
	nodeId: string;
	x: number;
	y: number;
}

export interface ChoiceAnchorGroup {
	choiceValue: number;
	nodeIds: string[];
	x: number;
	y: number;
}

export interface ChoiceTransitionAnchor {
	topic: string;
	choiceValue: number;
	nodeId: string;
	sourceRecords: DialogueRecord[];
}

export interface AddTopicTransition {
	sourceRecord: DialogueRecord;
	sourceNodeId: string;
	targetNodeId: string;
}

export interface TopicLayoutResult {
	rootEntryIds: string[];
	topY: number;
	bottomY: number;
	mainLaneCenterY: number;
	nodeIds: string[];
}

export interface AnchoredTopicLayout {
	choiceValue: number;
	anchorY: number;
	layout: TopicLayoutResult;
}

export interface PhaseTopicSegment {
	topic: string;
	families: BranchFamily[];
}

export interface PhaseGraph {
	orderedPhases: number[];
	familiesByPhase: Map<number, BranchFamily[]>;
	segmentsByPhase: Map<number, PhaseTopicSegment[]>;
	incomingTransitions: Map<number, Set<number>>;
	outgoingTransitions: Map<number, Set<number>>;
	mainTargets: Map<number, number | null>;
}

export interface PendingPhaseEntryEdge {
	phaseNodeId: string;
	phaseValue: number;
	entryId: string;
	families: BranchFamily[];
}

/**
 * Provenance metadata stored on every generated canvas node so the sync
 * engine can map a card back to the note (and line) it projects. Obsidian
 * preserves unknown node keys on save; accessors in card-meta.ts are the
 * only readers/writers so the storage backend can be swapped if that ever
 * breaks (sidecar file fallback).
 */
export interface EspCardMeta {
	/** What the card projects. Nodes without meta are ignored by the sync engine. */
	role: 'gate' | 'dialogue' | 'result' | 'choice' | 'journal' | 'jump' | 'header' | 'derived';
	/** Vault path of the note this card belongs to (absent for jump/header). */
	file?: string;
	/** Choice cards only: the n in the parent record's `Choice "…" n`. */
	choiceValue?: number;
	/** Journal nodes only. */
	questId?: string;
	/** Schema version for migrations. */
	rev: number;
}

export interface CanvasNode {
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
	espCard?: EspCardMeta;
}

/**
 * Marker on generated edges the sync engine must not interpret: phase-entry
 * heuristics, AddTopic/body-link routing, jump chains, structural pairings.
 * Unmarked edges between espCard nodes are live wires (editing plan §7).
 */
export interface EspEdgeMeta {
	role: 'derived';
	rev: number;
}

export interface CanvasEdge {
	id: string;
	fromNode: string;
	fromSide: 'left' | 'right' | 'top' | 'bottom';
	toNode: string;
	toSide: 'left' | 'right' | 'top' | 'bottom';
	label?: string;
	espCard?: EspEdgeMeta;
}

export interface CanvasBuildResult {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	relatedFiles: TFile[];
	warnings: string[];
}

export interface QuestCanvasGenerationResult {
	questTitle: string;
	outputCanvasPath: string;
	warnings: string[];
}

export interface CanvasLayoutContext {
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

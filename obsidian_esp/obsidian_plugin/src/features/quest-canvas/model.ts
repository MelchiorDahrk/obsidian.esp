/**
 * @file Shared types and layout constants for the quest-canvas package.
 *
 * Everything flows through these shapes: discovery produces a
 * {@link QuestScope}, family grouping produces {@link BranchFamily}s, layout
 * produces {@link CanvasNode}s/{@link CanvasEdge}s, and the sync engine reads
 * the {@link EspCardMeta} provenance stamped onto every generated node.
 * The higher-level design is documented in `canvas_generation_framework.md`
 * and `canvas_editing_internals.md` at the repo root.
 */
import { TFile, TFolder } from 'obsidian';

/** Dialogue types that can appear on a quest canvas (Journal is separate). */
export const DIALOGUE_TYPES = ['Greeting', 'Topic', 'Persuasion', 'Voice'] as const;

/** Prefix of the `^block-id`s the canvas writes into dialogue notes. */
export const CANVAS_BODY_BLOCK_PREFIX = 'obsidian-esp-canvas';

/** Frontmatter key marking a journal entry as the quest-name record. */
export const QUEST_NAME_FIELD = 'Quest Name';

export const JOURNAL_FOLDER_NAME = 'Journal';

export const QUESTS_FOLDER_NAME = 'Quests';

// --- Canvas node colors (Obsidian's palette indices 1-6) ------------------

export const DIALOGUE_COLOR = '3';

export const GATE_COLOR = '4';

export const RESULT_COLOR = '5';

export const JOURNAL_COLOR = '6';

export const JUMP_COLOR = '2';

// --- Layout metrics --------------------------------------------------------
// All values are canvas px. Widths size the node kinds; the GAP constants
// space phases, lanes, and clusters apart in layout.ts. Tune with care:
// refresh mode preserves user-moved nodes, so changed defaults only apply to
// newly generated nodes.

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

/** Phase value for dialogue reachable before any journal stage is set. */
export const PRE_JOURNAL_PHASE = 0;

/** Regex source matching the comparison operators used in filter variables. */
export const NUMERIC_OPERATOR_PATTERN = '(<=|>=|==|!=|=|<|>)';

export type DialogueType = (typeof DIALOGUE_TYPES)[number];

export type FrontmatterValue = string | string[];

/** A dialogue/journal note read from disk with parsed frontmatter. */
export interface MarkdownDocument {
	file: TFile;
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
}

/**
 * Everything discovery learns about the quest being canvassed: which journal
 * folders define it, its IDs and milestones, and where the canvas file goes.
 * Produced by `discoverQuestScope` in discovery.ts.
 */
export interface QuestScope {
	/** The project root (folder containing `header.md`). */
	projectRoot: TFolder;
	/** The folder the user invoked generation on. */
	selectedFolder: TFolder;
	questTitle: string;
	/** Normalized quest-name key used to match sibling quest folders. */
	questKey: string | null;
	/** All journal topic IDs belonging to this quest (a quest may span several). */
	questIds: string[];
	journalFolders: TFolder[];
	journalDocuments: MarkdownDocument[];
	journalMilestones: JournalMilestone[];
	/** Journal documents directly in the selected folder (not a subfolder). */
	rootJournalDocuments: MarkdownDocument[];
	outputCanvasPath: string;
}

/** One journal stage of the quest (an `Index: N` journal entry). */
export interface JournalMilestone {
	id: string;
	questId: string;
	questTitle: string;
	/** The journal index the stage sets. */
	index: number;
	/** Whether the entry carries the `Finished` flag. */
	finished: boolean;
	file: TFile;
	/** First sentence of the entry, used as the card label. */
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

/**
 * A parsed dialogue filter/condition rendered for display on gate cards.
 * `questId`/`value`/`operator` are populated for journal conditions so phase
 * assignment can reason about stage ranges; `choiceValue` for Choice filters.
 */
export interface Condition {
	kind: 'speaker' | 'journal' | 'item' | 'variable' | 'choice' | 'other';
	displayText: string;
	questId?: string;
	value?: number;
	operator?: NumericOperator;
	choiceValue?: number;
}

export type NumericOperator = '<=' | '>=' | '<' | '>' | '=' | '==' | '!=';

/** A parsed line of a record's `Result` script, rendered on result cards. */
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

/**
 * One dialogue response note, fully analyzed for canvas purposes: parsed
 * conditions and results, quest references, its assigned phase, and choice
 * relationships. Built by discovery.ts, grouped into {@link BranchFamily}s
 * by families.ts.
 */
export interface DialogueRecord {
	id: string;
	type: DialogueType;
	topic: string;
	file: TFile;
	diagId: string;
	prevId: string;
	bodyText: string;
	/** All parsed filter conditions on the record. */
	conditions: Condition[];
	/** Conditions identifying the speaker (ID/Faction/Race/Class/Cell/...). */
	speakerConditions: Condition[];
	/** Everything else (journal stages, variables, choices, items). */
	nonSpeakerConditions: Condition[];
	resultActions: ResultAction[];
	/** Raw `Result` script lines as written in the note. */
	resultLines: string[];
	/** Journal stage the record is gated on (adjusted during grouping). */
	phaseAnchor: number;
	/** The phase derived purely from the record's own conditions. */
	sourcePhaseAnchor: number;
	/** Whether the record references the selected quest itself. */
	directlyRelevant: boolean;
	conditionQuestReferences: string[];
	resultQuestReferences: string[];
	/** Quest IDs whose journal folder contains this record's topic. */
	ownedQuestReferences: string[];
	/** Union of the reference lists above. */
	questReferences: string[];
	/** Position within the topic's response chain (for engine eval order). */
	infoOrder: number;
	/** The `Choice n` filter value gating this record, if exactly one. */
	primaryChoiceValue: number | null;
	choiceValues: number[];
	/** Choice values this record's results set (outgoing choice edges). */
	choiceTargets: number[];
	/** Set when choice edges are drawn elsewhere (e.g. via jump nodes). */
	suppressChoiceTransitions?: boolean;
}

/**
 * A group of records that render as one dialogue card: same topic and phase,
 * same effective results, bodies differing only by speaker variant.
 */
export interface BranchFamily {
	id: string;
	type: DialogueType;
	topic: string;
	phaseAnchor: number;
	records: DialogueRecord[];
	/** Conditions common to every record (rendered on the gate card). */
	sharedConditions: Condition[];
	results: ResultAction[];
	bodyText: string;
	/** Engine evaluation priority (lower = evaluated first). */
	priority: number;
	/** Journal stage the family's results advance the quest to, if any. */
	progressionTarget: number | null;
}

/** Families bucketed by the choice value that gates them. */
export interface ChoiceGroup {
	choiceValue: number | null;
	families: BranchFamily[];
}

/** Canvas position of a single rendered choice card. */
export interface ChoiceAnchor {
	choiceValue: number;
	nodeId: string;
	x: number;
	y: number;
}

/** All rendered cards for one choice value (a choice can appear on several). */
export interface ChoiceAnchorGroup {
	choiceValue: number;
	nodeIds: string[];
	x: number;
	y: number;
}

/** Where a `Choice n` edge should terminate within a topic's layout. */
export interface ChoiceTransitionAnchor {
	topic: string;
	choiceValue: number;
	nodeId: string;
	sourceRecords: DialogueRecord[];
}

/** A pending AddTopic edge from a result card to the added topic's entry. */
export interface AddTopicTransition {
	sourceRecord: DialogueRecord;
	sourceNodeId: string;
	targetNodeId: string;
}

/** Bounding info returned after laying out one topic's cards. */
export interface TopicLayoutResult {
	/** Node IDs that entry edges into this topic should target. */
	rootEntryIds: string[];
	topY: number;
	bottomY: number;
	mainLaneCenterY: number;
	nodeIds: string[];
}

/** A follow-up topic layout pinned next to the choice card that leads to it. */
export interface AnchoredTopicLayout {
	choiceValue: number;
	anchorY: number;
	layout: TopicLayoutResult;
}

/** One topic's families within a phase column. */
export interface PhaseTopicSegment {
	topic: string;
	families: BranchFamily[];
}

/**
 * The quest's phase structure: which families/topics belong to each journal
 * stage and how stages transition into each other (via progression results).
 * Built in layout.ts and used to order the phase columns.
 */
export interface PhaseGraph {
	orderedPhases: number[];
	familiesByPhase: Map<number, BranchFamily[]>;
	segmentsByPhase: Map<number, PhaseTopicSegment[]>;
	incomingTransitions: Map<number, Set<number>>;
	outgoingTransitions: Map<number, Set<number>>;
	/** The single dominant next phase per phase, when one exists. */
	mainTargets: Map<number, number | null>;
}

/** An entry edge from a phase's journal node, recorded before targets exist. */
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

/** A node in Obsidian's JSON Canvas format, plus our `espCard` extension. */
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
 * Unmarked edges between espCard nodes are live wires
 * (canvas_editing_internals.md, "Functional edges").
 */
export interface EspEdgeMeta {
	role: 'derived';
	rev: number;
}

/** An edge in Obsidian's JSON Canvas format, plus our `espCard` extension. */
export interface CanvasEdge {
	id: string;
	fromNode: string;
	fromSide: 'left' | 'right' | 'top' | 'bottom';
	toNode: string;
	toSide: 'left' | 'right' | 'top' | 'bottom';
	label?: string;
	espCard?: EspEdgeMeta;
}

/** Output of `buildQuestCanvas`: the graph plus files it references. */
export interface CanvasBuildResult {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	relatedFiles: TFile[];
	warnings: string[];
}

/** Summary returned to command handlers after a canvas is written. */
export interface QuestCanvasGenerationResult {
	questTitle: string;
	outputCanvasPath: string;
	warnings: string[];
}

/**
 * Mutable state threaded through layout.ts while a canvas is being built:
 * accumulated nodes/edges, dedup sets, and cross-topic bookkeeping (phase
 * node positions, record entry points, pending choice anchors).
 */
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

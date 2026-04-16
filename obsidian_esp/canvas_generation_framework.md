# Procedural Canvas Framework For Journal Folders

## Goal

Generate an Obsidian canvas for a single quest journal folder that is readable as a dialogue flowchart, faithful to the underlying dialogue data, and deterministic enough to regenerate.

The model below is based on the authored sample canvas at `tests/test vault/TES3 Plugins/OAAB_Grazelands/Quests/The Eerie Lantern.canvas` plus the linked notes in the same test vault.

## What The Sample Canvas Is Actually Doing

The existing canvas is not a freeform mood board. It is a structured quest conversation graph with a consistent visual grammar.

- It contains 86 nodes and 104 edges.
- It uses 34 file nodes and 52 text nodes.
- 91 edges move left to right.
- 13 edges are short vertical attachments used for local result text beneath a file node.
- The graph reads as a left-to-right story spine anchored by journal milestones.
- Dialogue records are shown as file nodes.
- Conditions, player choices, and branch gates are shown as text nodes to the left or right of dialogue file nodes.
- Journal updates and script results are shown as text nodes below dialogue nodes, with journal note file nodes to the right when the result advances quest state.
- Repeated dialogue variants for different NPC classes are not merged away. They are stacked vertically in the same column and share downstream choice or journal nodes.

## Stable Visual Semantics In The Sample

The sample already implies a semantic color map.

- `2`: section headers such as `## [[Greeting 1]]` and `## [[Salkurnudai]]`
- `3`: dialogue file nodes such as `Greeting 1 ~57.md` and `Salkurnudai ~23.md`
- `4`: gate conditions and player choice nodes
- `6`: journal file nodes and result script text

This should be preserved as the baseline because it is already legible. The generator should snap layout to a grid more aggressively than the hand-authored version, but it should not change the reading model.

## Source Of Truth

The generator should derive logic from frontmatter, not from prose body text and not from an existing canvas.

Use the note body only for preview content already shown by Obsidian file nodes.

Use these fields as authoritative inputs:

- `Type`
- `Topic`
- `Index` for journal notes
- `FunctionN` and `VariableN`
- `Result`
- file path and folder

Treat these fields as optional enrichment only:

- custom quest properties such as `The Eerie Lantern:`
- `canvas:` backlinks
- body wikilinks

## Input Scope

The procedural entry point should be a journal folder, for example:

- `Journal/OAAB_TVos_HauntedLantern`

From that folder, determine the quest id from the folder name.

For a journal folder named `Journal/<QuestId>`:

- quest id = `<QuestId>`
- journal notes = all markdown files in that folder whose filename ends in a numeric index
- root journal note = `<QuestId>.md` if present, but do not place it on the canvas unless explicitly requested

Then scan the standard dialogue folders under the same project root:

- `Greeting`
- `Topic`
- `Persuasion`
- `Voice`

A dialogue note belongs to the quest canvas if any of the following are true:

1. Any `VariableN` references the quest id.
2. Its `Result` sets, checks, or advances the quest journal id.
3. Its `Result` contains a `Choice` that leads to notes which satisfy rule 1 or 2.
4. It is a direct predecessor or successor in the same topic branch to a note that satisfies rule 1 or 2.

Rule 4 matters because some topic notes are quest-adjacent entry points or follow-up reminders even when their own conditions are partially indirect.

## Data Model To Build Before Layout

Build a logical graph first. Do not place nodes while discovering them.

### 1. Journal Milestones

Each journal note becomes a milestone object.

Suggested shape:

```ts
type JournalMilestone = {
  id: string;
  questId: string;
  index: number;
  filePath: string;
  summary: string;
  incoming: string[];
  outgoing: string[];
};
```

### 2. Dialogue Records

Each dialogue markdown note becomes a record object.

```ts
type DialogueRecord = {
  id: string;
  filePath: string;
  type: 'Greeting' | 'Topic' | 'Persuasion' | 'Voice';
  topic: string;
  conditions: Condition[];
  result: ResultAction[];
  bodyText: string;
};
```

### 3. Conditions

Normalize every `FunctionN` and `VariableN` pair into a typed condition.

```ts
type Condition = {
  kind: 'journal' | 'item' | 'choice' | 'speaker' | 'other';
  rawFunction: string;
  rawVariable: string;
  displayText: string;
};
```

Map common cases into higher-level kinds.

- `Journal OAAB_TVos_HauntedLantern = 20` -> `journal`
- `Function Choice = 2` -> `choice`
- `Item ABtv_light_AshlLanternGhost >= 1` -> `item`
- `Class = Wise Woman` and `Faction = Ashlanders` -> `speaker`

### 4. Results

Parse the `Result` block into ordered actions.

```ts
type ResultAction = {
  kind: 'journal-set' | 'choice-set' | 'add-topic' | 'goodbye' | 'script' | 'disposition';
  raw: string;
  displayText: string;
  targetJournalIndex?: number;
  targetTopic?: string;
  choiceValue?: number;
};
```

## Branch Family Grouping

The sample canvas does not collapse every note into a single abstract step. It preserves authored note files, but it visually groups near-duplicates.

Use a branch family layer between records and layout.

Group dialogue records into a `BranchFamily` when all of the following match:

- same `Type`
- same `Topic`
- same normalized non-speaker conditions
- same normalized ordered `Result`
- same prose body text after trimming whitespace

Do not require speaker conditions to match. Speaker-only differences should produce variants inside the same family.

Suggested shape:

```ts
type BranchFamily = {
  id: string;
  topic: string;
  records: DialogueRecord[];
  sharedConditions: Condition[];
  speakerVariants: Condition[][];
  results: ResultAction[];
  phaseKey: string;
};
```

This is the reason the sample stacks `Wise Woman` and `Wise Woman Service` notes vertically in the same column while sharing the same choice nodes and journal targets.

## Phase Partitioning

The generator needs a left-to-right backbone. The cleanest unit is a quest phase bounded by journal state.

Define a phase as:

- one active journal milestone or journal range condition
- plus all branch families whose dominant quest condition points at that milestone or range
- until a result advances the quest to a different milestone

In the sample, the practical phases are:

1. Quest introduction leading to journal 20
2. Journal 20 conversation and topic discovery
3. Journal 22 return-lantern branch
4. Journal 30 active quest branch
5. Journal 100 and 110 aftermath branches

Do not hardcode those numbers. Derive them from journal predicates and journal-setting results.

## Layout Rules

### Reading Order

Always read left to right.

Within a phase, use a three-part micro-layout:

1. gate column
2. dialogue column
3. output column

Then either:

- attach a short result block below the dialogue node
- or advance to the next phase backbone journal node on the right

### Canonical Column Roles

Use these semantic columns repeatedly.

- section header column
- gate conditions column
- dialogue file column
- choice or consequence column
- journal milestone column
- optional jump column when fan-out becomes visually noisy

### Suggested Distances

These values match the sample well enough to preserve its shape while removing manual drift.

```ts
const LayoutConfig = {
  laneGapY: 480,
  variantGapY: 460,
  headerGapX: 260,
  gateToDialogueGapX: 460,
  dialogueToChoiceGapX: 640,
  dialogueToJournalGapX: 640,
  attachmentGapY: 24,
  phaseGapX: 1200,
  jumpFanoutThreshold: 4,
  jumpSpanThresholdY: 900,
};
```

The important part is not the exact numbers. The important part is that all x positions are snapped to semantic columns and all y positions are snapped to lanes.

### Suggested Node Sizes

The current canvas varies widths without a semantic reason. The procedural generator should standardize them.

- section header text node: `240 x 56`
- gate condition node: `385 x auto`
- choice node: `300 x auto`
- dialogue file node: `440 x 360`
- journal file node: `440 x 220`
- result text node below dialogue: same width as parent dialogue node, `auto` height
- jump node: `160 x 72`

Use height by line count for text nodes.

## Concrete Placement Algorithm

### Step 1. Sort phases

Sort phases by quest progression, not just by numeric journal index.

Primary key:

- topological order of journal transitions extracted from results

Fallback key:

- numeric journal index

### Step 2. Create backbone journal nodes

Place journal milestones on the horizontal spine of the canvas.

- first milestone near the left side
- each subsequent milestone at `previousPhaseX + phaseGapX`
- y should be centered on the local cluster it anchors

### Step 3. Create section headers per topic group

For each topic or greeting section inside a phase, place one header node to the left of its first gate column.

Example from the sample:

- `## [[Greeting 1]]`
- `## [[Salkurnudai]]`

Only create a new header when the topic changes or when the same topic appears again after a major journal transition.

### Step 4. Create branch-family lanes

Within each phase, branch families are placed on vertical lanes.

- one family = one lane anchor
- family variants stack vertically on that lane
- identical downstream nodes are shared

Lane ordering should prefer:

1. acceptance and successful progression near the visual center
2. reminder or neutral branches nearby
3. failure, refusal, and dead-end branches above or below the center band

This keeps the main path readable while leaving terminal branches visible.

### Step 5. Place gate condition nodes

Each record variant gets its own gate node if its speaker conditions differ.

Each gate node should contain the full normalized condition text in a stable order:

1. disposition
2. speaker filters such as class, faction, id
3. quest journal predicates
4. item predicates
5. choice predicates
6. any remaining conditions

This ordering matches how a human reads relevance.

### Step 6. Place dialogue file nodes

Place dialogue file nodes directly to the right of their gate nodes.

- use color `3`
- keep all records in a branch family on the same x
- stack variants vertically with `variantGapY`
- connect gate `right -> left` into the dialogue file node

### Step 7. Place outputs

Handle outputs by type.

If the result is a local consequence only, place a text node directly below the dialogue file node and connect `bottom -> top`.

Examples:

- `Goodbye`
- `AddTopic "Ghost Lantern"`
- `ModDisposition -30`

If the result sets a journal index, do both:

1. place the local result text below the dialogue node
2. place the target journal note on the next phase backbone to the right

Connect the dialogue file node horizontally to the journal file node.

If the result presents player choices, create one choice text node per choice string to the right of the prompting family. Reuse those choice nodes for every variant in the same family.

### Step 8. Create jump nodes only when needed

The sample uses `# Jump` nodes to prevent ugly long fan-out edges.

Create a jump node if both conditions are true:

1. a source node would otherwise feed at least `jumpFanoutThreshold` targets
2. those targets span at least `jumpSpanThresholdY` vertically

Use jump nodes as invisible routers with visible labels, not as semantic content.

The generator should label them more specifically than the sample when possible.

Preferred labels:

- `# Return branches`
- `# Outcome split`
- `# Reminder branches`

Fallback label:

- `# Jump`

## Edge Routing Rules

The routing rules should be simple and consistent.

- Primary flow edges: `fromSide = right`, `toSide = left`
- Local result attachments: `fromSide = bottom`, `toSide = top`
- Avoid right-to-bottom unless there is no cleaner option
- Reuse downstream nodes instead of duplicating them when the consequence is identical

This reproduces the sample's strongest property: almost the entire graph can be read as a straight horizontal progression.

## What To Preserve From The Sample

- Dialogue note files remain visible as note-backed file nodes.
- Journal notes remain visible as note-backed file nodes.
- Speaker-specific authored variants remain visible in full-fidelity mode.
- Choice text remains explicit rather than being buried in result parsing.
- Result scripts remain visible beneath the dialogue that fires them.

## What To Improve Over The Sample

### 1. Snap To A Grid

The authored canvas drifts slightly within the same logical columns, for example `2495` versus `2500` and `2040` versus `2060`.

The generator should quantize x and y positions so semantically identical columns line up perfectly.

### 2. Split Journal And Result Colors

The sample uses color `6` for both journal file nodes and result text. That works, but it makes state changes and script actions visually similar.

Recommended improvement:

- keep journal file nodes at `6`
- move result script text to `5` if available in the target canvas palette

If the palette must remain unchanged, add a prefix convention to result nodes such as `Journal ...`, `AddTopic ...`, or `Goodbye` on the first line exactly as parsed.

### 3. Standardize Widths

Standard widths make scanning faster.

- all dialogue file nodes same width
- all journal file nodes same width
- all gate nodes same width

### 4. Make Jump Nodes Purposeful

Generic `# Jump` nodes are functional but vague. A procedural canvas can name them based on why the fan-out exists.

### 5. Offer Two Render Modes

Support both modes from the same logical graph.

- `full-fidelity`: preserve separate file nodes for each authored dialogue record
- `merged-variants`: collapse speaker-only variants into one text-backed summary node with backlinks to the source files

The sample should map to `full-fidelity` by default.

## Minimal Implementation Contract

This is the level of interface that would make the feature straightforward to build.

```ts
type CanvasRenderMode = 'full-fidelity' | 'merged-variants';

type QuestCanvasRequest = {
  projectRoot: string;
  journalFolderPath: string;
  outputCanvasPath?: string;
  renderMode?: CanvasRenderMode;
};

type QuestCanvasPlan = {
  canvasPath: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  relatedFiles: string[];
  warnings: string[];
};
```

Generation entry point:

```ts
async function generateQuestCanvas(request: QuestCanvasRequest): Promise<QuestCanvasPlan>
```

Recommended internal pipeline:

```ts
discoverQuestScope()
parseDialogueConditionsAndResults()
buildQuestGraph()
partitionIntoPhases()
groupBranchFamilies()
layoutQuestCanvas()
serializeCanvasJson()
writeCanvasFile()
updateCanvasBacklinks()
```

## Repo Integration Points

If this is implemented in the plugin, the cleanest home is a dedicated feature module.

Recommended placement:

- new feature module near `obsidian_plugin/src/features/`
- file writing through `obsidian_plugin/src/utils/vault-writer.ts`
- command wiring in `obsidian_plugin/src/main.ts`

The existing code already has the right primitives for this style of feature.

- folder scanning patterns already exist in `compile-folder.ts`
- deterministic vault writes already exist in `vault-writer.ts`
- context-menu command wiring already exists in `main.ts`

## Practical Acceptance Criteria

The feature is ready when it can do all of the following from only a journal folder path:

1. Find every quest-relevant journal note and dialogue note.
2. Build a logical graph without depending on an existing canvas.
3. Render a left-to-right flow with explicit gates, dialogue records, choices, results, and journal milestones.
4. Regenerate deterministically with stable coordinates.
5. Keep the main success path visually central and easy to follow.
6. Preserve speaker-specific branches in full-fidelity mode.
7. Avoid unnecessary edge crossings through jump nodes and shared consequence nodes.

## Recommended Next Implementation Slice

Build this in three small slices instead of one large feature.

1. Scope discovery and graph extraction for a journal folder.
2. Deterministic layout that only emits text placeholder nodes.
3. Swap placeholders for file-backed dialogue and journal nodes, then write the final `.canvas` file.

That sequence will validate the hard part first, which is graph extraction and layout, before dealing with canvas polish.
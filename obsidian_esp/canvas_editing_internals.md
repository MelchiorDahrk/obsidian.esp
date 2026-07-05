# Quest Canvas Editing — Internals

Technical companion to [canvas_editing.md](canvas_editing.md). This documents how the editing system is built, the invariants it maintains, and how to verify changes to it. The generation/layout side is documented in [canvas_generation_framework.md](canvas_generation_framework.md); the markdown grammar it round-trips with is [md_dialogue_spec.md](md_dialogue_spec.md).

## Architecture

The single load-bearing decision: **quest data never lives only in the canvas.** The canvas is an editable projection of the markdown notes, and every edit follows one loop:

```
user edits canvas card / edge
        │  (Obsidian writes the .canvas file continuously)
        ▼
sync engine debounces, diffs against its snapshot
        │
        ▼
semantic edits are translated into note edits
(frontmatter surgeon: filter slots, Result lines, speaker keys)
        │
        ▼
notes are written (format-preserving line surgery)
        │
        ▼
projection refresh ("echo") re-renders the affected cards
from the notes, in place — no relayout
```

The compile path (`compile-folder.ts` → WASM) is untouched; it already reads the notes. If a note and the canvas disagree (external edit, sync bug, parse failure), the note wins and the projection is refreshed from it.

### Module map

Everything lives in `obsidian_plugin/src/features/quest-canvas/`:

| Module | Responsibility |
|---|---|
| `model.ts` | Shared types (`Condition`, `ResultAction`, `DialogueRecord`, `CanvasNode/Edge`, `EspCardMeta`, `EspEdgeMeta`, `MilestoneLink`) and layout constants |
| `cards.ts` | The bidirectional card grammar: parse/render pairs for gate lines, result lines, choice prompts; gate-line ↔ filter-slot mapping |
| `frontmatter-surgeon.ts` | Format-preserving note writes (line surgery), plus the tolerant frontmatter reader |
| `card-meta.ts` | The only reader/writer of `espCard` provenance metadata (swappable storage backend) |
| `sync-core.ts` | Pure sync engine: canvas snapshots, text diff, edge-gesture diff, note-edit planning, echo rendering |
| `sync.ts` | Obsidian wiring: vault watchers, debounce, loop guards, plan application, edge-removal confirmation, note-side live refresh |
| `actions.ts` | Pure planners for the generative actions (add choice branch, speaker variant, journal link, choice renumber) and single-card refresh |
| `inspector.ts` | Quest inspector `ItemView`, structured editors, canvas context-menu wiring |
| `refresh.ts` | Provenance-matched merge for position-preserving refresh |
| `migration.ts` | One-shot legacy block-id / dead-backlink cleanup |
| `discovery.ts`, `families.ts`, `transitions.ts`, `layout.ts`, `emit.ts`, `generate.ts` | The generation pipeline (scope discovery → records → branch families → edges → layered layout → canvas emit) |
| `index.ts` | Public API; the headless harness imports `discoverQuestScope`/`buildQuestCanvas` from here |

The generation pipeline and the editing engine share one grammar (`cards.ts`) and one writer (`frontmatter-surgeon.ts`); that shared core is what makes edits round-trip.

## Provenance metadata (`espCard`)

Every generated node carries a namespaced metadata object serialized directly into the canvas JSON:

```jsonc
{
  "id": "c19d2d658e011f19",
  "type": "text",
  "text": "Choice = 2\nJournal OAAB_TVos_HauntedLantern = 10",
  "color": "4",
  "espCard": {
    "role": "gate",          // gate | dialogue | result | choice | journal | jump | header | derived
    "file": "TES3 Plugins/.../Salkurnudai ~12.md",
    "choiceValue": 2,        // choice cards only
    "questId": "OAAB_TVos_HauntedLantern",  // journal nodes only
    "rev": 1                 // schema version for migrations
  }
}
```

- `role` + `file` (+ `choiceValue`) let a canvas alone identify which note (and which line of it) any card projects — node ids are opaque hashes and not recoverable otherwise.
- Nodes without `espCard` (user-created notes, pasted nodes) are invisible to the sync engine.
- Generated **edges** the engine must not interpret carry `espCard: {role: "derived", rev: 1}` (see [Functional edges](#functional-edges)).
- All reads/writes go through `getCardMeta`/`setCardMeta` in `card-meta.ts`. Obsidian preserving unknown canvas keys is undocumented behavior (relied on by major community plugins); if a release breaks it, swap the storage backend inside `card-meta.ts` for a sidecar map keyed by node id — nothing else touches `node.espCard`. A manual verification checklist lives in `canvas_generation_framework.md` §"Manual spike checklist".

## Card grammar

Display text is canonical and bidirectional: `render(parse(x)) === normalize(x)`. The grammar is intentionally identical to the note grammar (md_dialogue_spec.md §6) so parse-back is unambiguous.

**Gate lines** (`parseGateLine`/`renderGateLine`, `GateLine` union):

| Line form | Parsed as | Round-trips with |
|---|---|---|
| `<SpeakerField> = <value>` | `{kind: 'speaker'}` | top-level frontmatter key |
| `Choice = <n>` | `{kind: 'choice'}` | `Function<n>: Function` + `Variable<n>: Choice = <n>` |
| `<FilterKind> <id> <op> <value>` | `{kind: 'filter'}` | `Function<n>: <kind>` + `Variable<n>: <id> <op> <value>` |
| anything else | `{kind: 'filter', filterKind: 'Function'}` | `Function<n>: Function` + `Variable<n>: <line>` |

Filter ids may contain spaces (`Dead kashtes ilabael > 0`); `normalizeVariableExpression` matches the operator from the right. A bare filter-kind word (`Journal` on its own) is a parse error, not a Function filter — that is the main guard against destructive typos. `gateLineToFrontmatter`/`filterSlotToGateLine` are the slot mapping and its inverse.

**Result lines** (`parseResultCardLine`/`renderResultNoteLine`, `ResultLine` union): journal lines are accepted in wikilink render (`Journal [[Note|Quest 20]]`) and raw form (`Journal Quest 20`, `Journal "Quest" 20`) and always write back quoted-raw (`Journal "Quest" 20`, matching exporter output); `AddTopic` in four quoting/wikilink variants; `Choice "…" n`; everything else is a `script` line preserved verbatim.

**Choice cards** display only the prompt string; the value lives in `espCard.choiceValue`, never in the visible text.

Verified by `scripts/canvas-harness/cards-test.mjs` (round-trips for every speaker field × filter kind × operator, normalization, slot-mapping inverses, result-line forms).

## Frontmatter surgeon

`app.fileManager.processFrontMatter` is deliberately never used: it re-serializes YAML and would reformat exporter-written files (empty keys like `Race:`, `Result: |` block scalars, key order), which the Rust exporter/compiler round-trips byte-for-byte. Instead `frontmatter-surgeon.ts` does line surgery on the raw text:

- `setFrontmatterKey(content, key, value)` — replaces the value on the existing key line in place (empty value keeps the exporter's `Key:` form); appends before the closing `---` when absent. Replacing a key with continuation lines (block scalar / list) removes them too.
- `removeFrontmatterKey`, `setFilterSlot(n, fn, var)` / `clearFilterSlot(n)` — slot pairs are written adjacently after the last existing slot.
- `setResultLines(content, lines)` — rewrites the `Result:` value while preserving the note's scalar style: an existing block scalar stays a block (with its detected indentation), an inline `Result: Goodbye` stays inline while one line fits, an emptied result keeps the bare `Result:` key.
- `applyGateLines(content, gateLines)` — the composite gate write: speaker keys are set, or blanked back to `Key:` when the card no longer lists them (never deleted); filter slots are re-allocated compactly in card order; slots beyond the new count are cleared. Compaction means a gate edit may renumber slots once (slot order is semantically irrelevant to the compiler); after that, writes are byte-stable fixed points.

All vault writes go through `app.vault.process` (atomic, respects editor state).

## Sync engine

`sync-core.ts` is pure and synchronous — no Obsidian imports — so the entire engine runs headlessly under the harness. `sync.ts` owns the wiring:

1. **Snapshots.** On plugin load (for open canvases), on `file-open`, and lazily on first modify, each quest canvas (any canvas containing `espCard` nodes) is parsed and cached as the diff baseline.
2. **Watcher + debounce.** `vault.on('modify')` for `.canvas` files, debounced 500 ms per path (Obsidian writes canvas JSON continuously while editing).
3. **Loop guards.** Every canvas write records `hash(json)` in `lastWrittenHash`; a modify event whose content hash matches is our own echo and only updates the snapshot. An `applying` set serializes passes per canvas; a re-run is queued if edits land mid-apply.
4. **Text diff** (`diffCanvasTextEdits`): text changes on `gate`/`result`/`choice` nodes that carry meta. Position/size changes, user nodes, *added* nodes, and *deleted* nodes are all layout-only. A leading `⚠️` line from a previous failure is stripped before comparing (`editableCardText`).
5. **Planning** (`planSyncFromEdits`): gate text → `parseGateCardText` → `applyGateLines`; result text → `parseResultCardText` → `applyResultCardLines` (line surgery that keeps the note's `Choice` lines in position — card lines replace the non-choice lines around them); choice text → `renameChoiceInResult` (rewrites only the `"text" n` pair for that value). Multiple edits to one note chain on a working copy; unchanged notes are dropped from the plan.
6. **Echo refresh.** Accepted edits re-render from the *new* note content via `renderCardFromNote` — gates through `parseConditions` + `renderConditionBlock`, results through `parseResultActions` + `renderResultAction` (with milestone wikilinks), choices back to their prompt. Heights are recomputed from the node's own width. Quest context (milestones, quest ids) is reconstructed from the canvas itself: journal nodes carry `file`/`questId`, and their notes provide `Index` (`deriveQuestContext`).
7. **Failure UX.** A parse failure writes nothing; the card text becomes `⚠️ <error>\n<user text>` and a `Notice` fires. The warning line is invisible to the next diff, so fixing the text below it syncs normally.
8. **Note-side refresh.** `modify` events on `.md` files referenced by any snapshot re-render that note's cards on every tracked canvas (`refreshCardFromNote`), with the same debounce/guards. This is what makes external note edits show up live, and it is idempotent against the engine's own echoes.

## Functional edges

Only whitelisted, unambiguous gestures are interpreted (`diffCanvasEdgeGestures` → `classifyEdgeGesture`); everything else is visual:

| Endpoints (`espCard.role`) | Gesture | Note write |
|---|---|---|
| dialogue → journal | `journal-advance` | upsert `Journal "<quest>" <index>` result line (replaces an existing line for the same quest) |
| dialogue → choice | `offer-choice` | ensure `Choice "<prompt>" <n>` result pair |
| choice → gate, or choice → dialogue (gateless) | `choice-gate` | add/remove the `Choice = <n>` filter on the target record |
| journal → gate | `availability-gate` | add/remove the `Journal <quest> = <index>` filter on the target record |

Ignored by construction: edges marked `espCard: {role: 'derived'}` (the generator marks its heuristic wiring — phase-entry edges, AddTopic/body-link routing, jump chains, gate→dialogue and dialogue→result pairings), edges with any endpoint lacking card meta, and any endpoint-role pair not in the table.

Adds apply immediately in the same sync pass as text edits (edge planning reads note contents *after* the text plan). Removals delete note data, so they are gated behind a modal (`ConfirmEdgeRemovalModal`) that lists `describeEdgeGesture` strings naming the exact frontmatter change; cancelling leaves the data, and a refresh restores the edge.

## Inspector and node actions

`inspector.ts` registers the `esp-quest-inspector` `ItemView` and canvas context-menu items via the unofficial `canvas:node-menu` workspace event. The event is typed with a local call-site cast (a `declare module` augmentation of `Workspace.on` perturbs overload resolution for every other event — don't), registering it is harmless on Obsidian versions that never fire it, and node internals (`node.getData()`, `node.canvas.view.file`) are accessed defensively. File-level watching remains the load-bearing mechanism: the inspector and menu actions only ever write vault files, never canvas view internals.

The generative actions are pure planners in `actions.ts` returning an `ActionPlan` (`noteUpdates`, `noteCreations`, `canvasInsertion`, `cardUpdates`, `metaUpdates`) that the UI applies through the vault:

- `planAddChoiceBranch` — next free choice value from the parent's `Choice` pairs; new note templated with `Type`/`Topic`, gated on the choice plus the parent's journal conditions; canvas insertion of choice/gate/dialogue nodes wired to the parent. **Node ids reuse the generator's seeds** (`gate:<path>`, `dialogue:<path>`, `choice:<path>:<n>:<display>`) so a later regeneration matches the inserted nodes by provenance instead of duplicating them.
- `planAddSpeakerVariant` — duplicates the note, blanks speaker keys and record identity (`DiagID`/`PrevID`), keeps non-speaker filters, results, and body.
- `planLinkJournalMilestone` — upserts the `Journal` result line and draws the dialogue→journal edge with the generator's edge seed.
- `planRenumberChoice` — inspector-only because it is multi-file: rewrites the parent's `"text" n` pair and every `Variable<n>: Choice = old` on the topic, retargets the choice card's `choiceValue` meta, and echoes affected gate cards.

## Provenance-matched refresh

`refresh.ts` / `mergeCanvasPreservingLayout(existing, fresh)` implements *Refresh quest canvas*:

- Nodes match by provenance key `role:file:choiceValue` — not by node id, because choice-card ids include the (mutable) prompt text. Matched nodes take the fresh node's identity, text, color, and meta but keep the existing x/y/width (and height for file nodes; text cards keep their re-measured height).
- An old→new id remap carries user-drawn edges across id changes; user edges survive when both endpoints still exist and aren't superseded by fresh wiring.
- Genuinely new nodes are positioned relative to a matched graph neighbor (`merged = matchedNeighbor + (fresh − freshNeighbor)`), falling back to raw layout coordinates.
- Orphaned generated nodes are dropped; user-created nodes always survive; fresh edges replace all generated wiring.

`generateQuestCanvasForScope` uses mode `'refresh'` (merge into the existing canvas when present) by default; `'full'` writes the fresh layout unconditionally. Both run through the same emit path, so `espCard` is always written.

## Migration and ecosystem

- `migration.ts` / **Clean canvas block ID markers**: strips trailing `^obsidian-esp-canvas-<hash>` block ids from note bodies (the pre-editing display hack, retired in favor of CSS property hiding behind the `esp-hide-canvas-properties` body class), removes `#^obsidian-esp-canvas…` subpaths and stale wikilink subpaths from canvases, and prunes `canvas:` backlinks whose target canvas no longer exists. Idempotent; also runnable headlessly (`scripts/canvas-harness/migrate.mjs <vaultDir>`).
- Enhanced Canvas is detected via `app.plugins.enabledPlugins` and produces a one-time startup warning; no cooperative writing is attempted. The content-hash loop guards make our writes idempotent if its saves race ours.

## Testing

All engine logic is exercised headlessly by the canvas harness (esbuild bundles the TS with `obsidian` aliased to `scripts/canvas-harness/obsidian-stub.mjs`):

| Script | Covers |
|---|---|
| `node scripts/canvas-harness/cards-test.mjs` | Grammar round-trips: every speaker field, filter kind, operator; result-line forms; slot mapping inverses |
| `node scripts/canvas-harness/sync-test.mjs` | Byte-exact note fixtures for gate/result/choice edits (unknown keys, unknown script lines, `Result: \|` vs inline style preserved), warning-card UX, convergence/idempotence, every edge gesture add+remove, ambiguous-edge rejection, the refresh merge |
| `node scripts/canvas-harness/actions-test.mjs` | A full authored branch (choice + gated response + journal advance) from canvas state alone; variant/renumber planners |
| `node scripts/canvas-harness/run.mjs …` + `metrics.mjs` / `compare-edges.mjs` | Generation output and layout quality (see canvas_generation_framework.md) |

When changing the sync engine, keep the fixtures byte-exact: the assertion style is "this exact note content comes out", because exporter round-trip safety is the whole point. Note that `compare-edges.mjs` identifies edges by node display text, so text renames show up as false edge diffs — compare edge ids when in doubt.

## Known constraints

- Slot compaction can reorder `Function<n>`/`Variable<n>` pairs once after a gate edit (display order is sorted; slot order follows card order). Semantically neutral; byte-stable thereafter.
- Renaming a choice card writes to the card's provenance note only; identical `Choice` pairs on sibling variant records are not chased (use the inspector/notes).
- `PrevID`/`DiagID` ordering is deliberately not editable from the canvas (too easy to corrupt master round-trips), and canvas node deletion never deletes note files.
- The `warnings` array returned by `buildQuestCanvas` currently reports unreachable `Choice` branches (a `Choice "…" n` result no record on the topic filters on).

# Editing Quest Canvases

Quest canvases are no longer just a visualization — they are an editing surface for quest dialogue. You can change conditions, results, and choices directly on the canvas, wire responses to journal milestones by drawing edges, and grow new dialogue branches without leaving the graph. Everything you do on the canvas is written back into the markdown notes, which remain the single source of truth that compiles to the ESP.

For how this works under the hood, see [canvas_editing_internals.md](canvas_editing_internals.md).

## The one rule that explains everything

**The notes are the source of truth. The canvas is a live projection of them.**

Every canvas edit is translated into an edit of the underlying dialogue or journal note within about half a second. Right after writing the note, the plugin re-renders the affected cards from the note — so what you typed may get lightly reformatted into the canonical spelling (this "echo" is how you know the edit landed). If the canvas and a note ever disagree, the note wins.

Consequences worth internalizing:

- Regenerating or refreshing a canvas can never lose your work, because your edits became note edits the moment you made them.
- Editing notes directly (or through any other tool) is always safe; open canvases update their cards live.
- Deleting things from the canvas does **not** delete quest data (see [Deleting things](#deleting-things)).

## Reading a quest canvas

| Element | Appearance | Meaning |
|---|---|---|
| Journal node | File embed, cyan (color 6) | A journal milestone note; each quest phase column is anchored by one |
| Dialogue node | File embed, yellow (color 3) | A dialogue response note; the embed shows the spoken text |
| Gate card | Text card, green (color 4), left of a dialogue node | The conditions under which that response plays |
| Result card | Text card, red (color 5), or cyan when it advances the journal, below a dialogue node | The MW script lines from the note's `Result:` |
| Choice card | Text card, green (color 4), right of a dialogue node | One player choice the response offers; shows only the prompt text |
| Jump node | Small gray card (`Jump #1`) | Visual routing helper for edges that would otherwise cross the whole canvas |

Frontmatter properties are hidden inside canvas embeds by default so dialogue nodes show only the spoken text (the gate card already shows the filter data). Toggle this with the **Hide properties in canvas cards** setting.

You can also add your own notes and cards to a quest canvas freely — anything you create yourself is ignored by the syncing machinery and survives refreshes.

## Editing cards inline

Double-click a card and type. When you finish, the plugin parses the text, writes the note, and echoes the canonical form back.

### Gate cards — one condition per line

```
Class = Wise Woman
Journal OAAB_TVos_HauntedLantern >= 10
Item ABgh_guarHides >= 1
Dead kashtes ilabael > 0
Choice = 2
PCLevel > 5
```

- `Field = value` sets a speaker filter. Fields: `Disposition`, `Sex`, `Race`, `Class`, `Faction`, `Rank`, `PC Faction`, `PC Rank`, `Cell`, `ID`.
- `<Kind> <id> <op> <value>` sets a filter slot. Kinds: `Global`, `Local`, `Journal`, `Item`, `Dead`, `NotId`, `NotFaction`, `NotClass`, `NotRace`, `NotCell`, `NotLocal`. Operators: `=`, `==`, `!=`, `<`, `<=`, `>`, `>=`.
- `Choice = n` gates the response on a player choice.
- Any other expression (like `PCLevel > 5`) becomes a `Function` filter.

This is exactly the `Function<n>:`/`Variable<n>:` grammar from [md_dialogue_spec.md](md_dialogue_spec.md) §6, so a gate card is a faithful, editable rendering of the note's frontmatter. Adding a line adds a filter, removing a line removes it, and spacing is forgiving (`Choice=2` works and echoes back as `Choice = 2`).

### Result cards — one script line per line

```
MessageBox "You feel watched."
Journal [[HauntedLantern 20|OAAB_TVos_HauntedLantern 20]]
Player->RemoveItem "ABgh_guarHides" 1
Goodbye
```

- Journal lines display as clickable links to the milestone note. When editing you can type either the link form or the raw form (`Journal OAAB_TVos_HauntedLantern 20`); notes always store the raw script line.
- Lines the plugin doesn't recognize (`StartScript`, `PositionCell`, custom commands…) are preserved verbatim and in order — edit them like plain text.
- `Choice` lines never appear on result cards; they live on choice cards instead. They keep their place in the note automatically when you edit around them.

### Choice cards — just the prompt

A choice card shows only the text the player sees, e.g. `I will take the job.` Renaming the card rewrites the corresponding `Choice "…" n` entry in the parent response's `Result:`. The choice *number* is not part of the text — change it via the inspector (see below), which renumbers the parent and every response gated on that choice in one step.

### When an edit doesn't parse

Nothing is written. The card re-renders with a warning line on top and your text preserved underneath:

```
⚠️ Filter "Journal" is missing its condition (expected "Journal <id> <op> <value>").
Journal
```

Fix the text below the warning and the card syncs normally. Your input is never destroyed.

## Drawing edges that mean something

Most edges on a quest canvas are explanatory wiring that the generator derives (phase entries, AddTopic routing, jumps). Four specific gestures, drawn between generated elements, actually edit the quest:

| Draw this edge | Effect on the notes |
|---|---|
| dialogue node → journal node | The response advances the quest: writes `Journal <quest> <index>` into its `Result:` |
| dialogue node → choice card | The response offers that choice: writes `Choice "<prompt>" <n>` into its `Result:` |
| choice card → gate card (or dialogue node without a gate) | That branch fires on the choice: adds a `Choice = <n>` filter to the target response |
| journal node → gate card | Availability gate: adds a `Journal <quest> = <index>` condition to the target response |

**Deleting** one of these live edges removes the corresponding line or filter from the note — after a confirmation dialog that names the exact change, so nothing is removed silently. If you cancel, the data stays and the next refresh redraws the edge.

Any other edge — between your own cards, between unrelated elements, or any of the generator's derived wiring — is purely visual.

## The context menu and the quest inspector

Right-click a generated card on the canvas:

- **Open source note** — jump to the markdown behind the card.
- **Edit in inspector** — open the card in the *Quest inspector* sidebar: gate conditions as rows with kind dropdowns, result actions as a reorderable list, choice prompt and value as fields.
- **Refresh card** — re-render this one card from its note.
- On dialogue nodes, the generative actions below.

### Growing the quest from the canvas

- **Add choice branch** — prompts for the choice text, then: appends the `Choice "…" n` line to the response, creates a new response note in the same topic folder gated on that choice (inheriting the parent's journal gate), and drops the choice card, gate card, and dialogue node onto the canvas already wired up. Open the new note and write the reply.
- **Add speaker variant** — duplicates the response note with the speaker fields cleared, so you can write the same beat for a different NPC. The new gate and dialogue node appear beneath the original.
- **Link journal milestone** — pick a milestone from the quest; writes the `Journal` result line and draws the edge.
- **Choice value** (inspector) — renumbers a choice, rewriting the parent's `Choice` line and every `Choice = n` filter on the topic together.

## Refreshing and regenerating

- **Refresh quest canvas** (command palette or the quest folder's context menu) is the everyday operation: it re-reads the notes and rebuilds cards, wiring, and colors, but keeps the positions and sizes of everything you've arranged by hand. New dialogue appears next to its neighbors; cards whose notes are gone disappear; your own notes and wires are untouched.
- **Regenerate quest canvas (full relayout)** recomputes the entire layout from scratch — use it when the graph has drifted too far to be worth preserving.

Because deleting a card is layout-only, refresh doubles as undo: delete a gate card by accident, refresh, and it's back (its conditions were in the note all along).

## Deleting things

Deleting nodes or cards from the canvas never deletes quest data or files — it's treated as layout cleanup. Actually removing data is always explicit:

- delete lines *inside* a gate or result card,
- delete a live edge and confirm the dialog,
- use the inspector's remove buttons.

## Housekeeping

- **Generation is read-only over your notes.** Building or refreshing a canvas modifies zero dialogue notes. If you want each note to carry a `canvas:` backlink to its canvas, enable the **Write canvas backlinks** setting (off by default).
- **Clean canvas block ID markers** (command palette) is a one-shot migration for vaults generated before this system: it strips the legacy `^obsidian-esp-canvas-…` block ids from note bodies, removes stale block references from canvases, and prunes `canvas:` backlinks that point at deleted canvases.
- **Enhanced Canvas**: if you use that community plugin, the plugin warns you at startup — its property syncing writes into the same files and can race quest canvas editing. Prefer excluding quest canvases from it.

## Current limitations

- `PrevID`/`DiagID` ordering is not editable from the canvas; keep managing response order in the notes.
- Renaming a choice card edits the note the card belongs to. If sibling variant responses repeat the same `Choice` line, update those via the inspector or the notes.
- Header/jump cards are decorative; edit them freely, but a refresh may recreate them.
- The canvas cannot delete note files, ever.

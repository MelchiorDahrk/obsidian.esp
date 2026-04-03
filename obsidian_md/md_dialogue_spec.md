# TES3 Markdown Dialogue Format

> [!IMPORTANT]
> This document describes the Markdown format currently implemented by `obsidian_md`.
> It covers both directions:
> - authoring Markdown and compiling it into a TES3 plugin
> - exporting a TES3 plugin back into Markdown

---

## 1. Project Layout

A dialogue project directory contains:

- exactly one `header.md`
- zero or more dialogue entry files named like `<Topic> ~<N>.md`

Example:

```text
header.md
Greeting 1 ~0.md
Greeting 1 ~1.md
test topic ~0.md
test topic ~1.md
```

Each non-header Markdown file represents exactly one `DialogueInfo`.
The topic is normally derived from the filename, but can be overridden in frontmatter with `Topic:`.

---

## 2. `header.md`

`header.md` must begin with YAML-like frontmatter in the format the parser actually accepts:

```yaml
---
Author: Melchior Dahrk
Description: dialogue test
File Type: ESP
Masters:
  - Morrowind.esm
  - Tribunal.esm
---
```

### Supported header keys

| Key | Required | Notes |
|---|---|---|
| `Author` | No | Defaults to empty string |
| `Description` | No | Defaults to empty string |
| `File Type` | No | `ESP`, `ESM`, or `ESS`; defaults to `ESP` |
| `Masters` | No | List of master filenames in load order |

### Compiler behavior

- The compiler always writes plugin version `1.3`.
- `Header.num_objects` is computed during TES3 save.
- `Header.masters[*].size` is resolved from disk during the resolve pass, not authored in Markdown.
- `Masters` should be in real load order if the project modifies dialogue defined in master plugins.

---

## 3. Dialogue Entry Files

Every dialogue entry file must start with frontmatter delimited by `---`.
After the closing `---`, the remaining content becomes `DialogueInfo.text`.

Example:

```yaml
---
Type: Topic
PrevID: 123456789
Faction: Ashlanders
PC Faction: Ashlanders
PC Rank: Rank 3
FunctionIndex: 0
Function: Function
Variable: Choice = 2
---
This is the response text.
```

### Filename rules

The parser looks for files ending in ` ~<number>.md`.

- The portion before ` ~<number>` is treated as the topic id.
- The numeric suffix is used only as a directory ordering hint.
- Files are sorted by that numeric suffix before compilation.
- If a file has no ` ~<number>` suffix, it sorts last.

### `Topic:` override

The frontmatter may override the filename-derived topic:

```yaml
Topic: Greeting 0
```

This is primarily used by the TES3-to-Markdown exporter so it can generate safe filenames while preserving the original TES3 topic id exactly.

---

## 4. Entry Frontmatter Fields

These keys are recognized by the parser.

| Key | Meaning |
|---|---|
| `Topic` | Overrides the topic id derived from the filename |
| `Type` | Dialogue type: `Topic`, `Journal`, `Voice`, `Greeting`, or `Persuasion` |
| `DiagID` | Preserved TES3 `DialogueInfo.id`; must be numeric if present |
| `PrevID` | TES3 `prev_id`; must be numeric if present |
| `ID` | `speaker_id` |
| `Disposition` | Dialogue disposition for non-journal entries |
| `Index` | Journal index; parsed into the same internal `disposition` field |
| `Race` | `speaker_race` |
| `Sex` | `Any`, `Male`, or `Female` |
| `Class` | `speaker_class` |
| `Faction` | `speaker_faction` |
| `Rank` | `speaker_rank`; accepts `-1`, raw integers, or `Rank <n>` |
| `Cell` | `speaker_cell` |
| `PC Faction` | `player_faction` |
| `PC Rank` | `player_rank`; accepts `-1`, raw integers, or `Rank <n>` |
| `Sound Path` | `sound_path` |
| `SoundPath` | Alias for `Sound Path` |
| `Result` | `script_text`; supports escaped `\\r\\n` and `\\n` |
| `Quest Name` | If `true`, sets journal quest state to `Name` |
| `Finished` | If `true`, sets journal quest state to `Finished` |
| `Restart` | If `true`, sets journal quest state to `Restart` |
| `FunctionIndex` | Filter slot index |
| `Function` | Filter type name for the following `Variable` line |
| `Variable` | Filter expression for the current filter |

Unknown keys are ignored by the parser.

---

## 5. Field Semantics

### `Type`

Recognized values:

- `Topic`
- `Journal`
- `Voice`
- `Greeting`
- `Persuasion`

If omitted, the compiler defaults to `Topic`.

### `DiagID`

`DiagID` preserves an exact TES3 INFO id during import/export.

- Must contain only ASCII digits if present.
- If omitted, the compiler generates a random numeric id unique within that topic group.
- The exporter always writes `DiagID`.

### `PrevID`

`PrevID` controls insertion ordering.

- Must contain only ASCII digits if present.
- If omitted, the compiler links the entry after the previously compiled entry for the same topic.
- If present, it is preserved verbatim during compile.
- During resolve, rounded authored `PrevID` values may be reconciled to exact master ids when possible.

### `Disposition` and `Index`

- For `Topic`, `Voice`, `Greeting`, and `Persuasion`, use `Disposition`.
- For `Journal`, use `Index`.
- Internally both map to `DialogueData.disposition`.

### `Rank` and `PC Rank`

Accepted forms:

- `-1`
- `3`
- `Rank 3`

The exporter writes non-default ranks as `Rank <n>`.

### `Sex`

Accepted values:

- `Any`
- `Male`
- `Female`

If omitted, the compiler uses `Any`.

### Quest flags

These map to `DialogueInfo.quest_state`:

- `Quest Name: true` -> `Name`
- `Finished: true` -> `Finished`
- `Restart: true` -> `Restart`

If multiple are set to `true`, the last one encountered in parse order wins.

### `Result`

`Result` maps to `DialogueInfo.script_text`.

- Inline `\r\n` and `\n` escape sequences are decoded by the parser.
- The exporter writes multiline scripts back out using escaped newlines on one line.

### Body text

Everything after the closing `---` becomes `DialogueInfo.text`.

The parser:

- trims leading blank space before the body
- trims trailing line endings at the end of the file
- normalizes text line endings to CRLF internally

The exporter writes the text body exactly after a blank line following the closing `---`.

---

## 6. Filter Format

Filters are expressed as repeated triples:

```yaml
FunctionIndex: 0
Function: Function
Variable: Choice = 2
```

or:

```yaml
FunctionIndex: 1
Function: Journal
Variable: my_quest >= 10
```

Each `Variable` line consumes the current `FunctionIndex` and `Function` values, then resets them.

### Filter type values accepted in `Function:`

- `Function`
- `Global`
- `Local`
- `Journal`
- `Item`
- `Dead`
- `NotId`
- `NotFaction`
- `NotClass`
- `NotRace`
- `NotCell`
- `NotLocal`

### `Variable:` syntax

The parser accepts:

- `name = 1`
- `name == 1`
- `name != 1`
- `name > 1`
- `name >= 1`
- `name < 1`
- `name <= 1`

The value is parsed as:

- `Integer` if it does not contain `.`, `e`, or `E`
- `Float` otherwise

### Filter function mapping

The compiler derives TES3 `FilterFunction` values from the parsed filter type:

- `Function` uses the function name from the left-hand side of `Variable:`
  - Example: `Variable: Choice = 2`
- `Journal` maps to `JournalType`
- `Dead` maps to `DeadType`
- `Item` maps to `ItemType`
- `Global`, `Local`, and `NotLocal` map to `VariableCompare` unless an explicit recognized function name is provided
- `NotId`, `NotFaction`, `NotClass`, `NotRace`, and `NotCell` map to their TES3 negative-check function variants

For `Function`, the left-hand side is stored as `function_name` and the TES3 filter `id` becomes empty.
For other filter types, the left-hand side becomes the TES3 filter `id`.

### Exported filter shape

The exporter writes filters back as:

- `FunctionIndex: <n>`
- `Function: <FilterType>`
- `Variable: <expression>`

For `FilterType::Function`, the expression is written using the TES3 function name:

```yaml
Function: Function
Variable: Choice = 2
```

For non-function filters, the expression uses the TES3 `id`:

```yaml
Function: Global
Variable: Random100 < 33
```

---

## 7. Compile Behavior

### Header creation

The compiler builds a fresh TES3 header using:

- `version = 1.3`
- `file_type` from `header.md`
- `author` from `header.md`
- `description` from `header.md`
- an empty `masters` list initially

The resolve pass later restores the authored masters with real file sizes.

### Dialogue grouping

Entries are grouped by lowercased topic id internally, but the first encountered original casing is preserved on the emitted TES3 `Dialogue`.

### INFO id generation

If `DiagID` is absent, the compiler generates a numeric id using random 15-bit chunks concatenated into a string.

### Link repair strategy

After compilation:

- topics with preserved TES3 links (`DiagID` present or explicit `PrevID` present) only get `next_id` repaired
- topics without preserved links get full `repair_links()`

This distinction lets authored Markdown keep its simpler sequential behavior while exported Markdown preserves master-facing `PrevID` values accurately.

---

## 8. Resolve Behavior

When compiling against masters, the resolve pass:

1. loads the master plugins from the current OpenMW load order
2. reconciles modified INFO ids by matching `Original text: ...` markers when present
3. also attempts to reconcile rounded numeric `PrevID` values against exact master ids
4. merges the authored plugin into the master data
5. normalizes touched journal topics by journal index
6. removes unmodified records
7. restores the original authored masters list and sets the output file type to `ESP`

### `Original text:` convention

The code recognizes this marker inside body text:

```text
Original text: Enough %PCName. You beat me fairly.
```

When present, resolve uses it to locate the original master INFO and recover the exact TES3 INFO id.

This is especially important for modifying existing dialogue imported from a plugin.

---

## 9. TES3-to-Markdown Export Format

The reverse exporter writes Markdown in the same format described above.

### Exported `header.md`

The exporter writes:

- `Author`
- `Description`
- `File Type`
- `Masters`

### Exported entry frontmatter

The exporter writes:

- `Topic`
- `Type`
- `DiagID`
- `PrevID`
- `Disposition` or `Index`
- speaker/player condition fields
- `Sound Path`
- `Result`
- `Quest Name`
- `Finished`
- `Restart`
- zero or more filter triples

### Export ordering

Dialogue groups are exported in TES3 serialization order:

1. `Journal`
2. `Topic`
3. `Voice`
4. `Greeting`
5. `Persuasion`

Within a type, groups are sorted alphabetically by dialogue id.

Within a group, files are written in the existing INFO order as:

```text
<safe topic stem> ~0.md
<safe topic stem> ~1.md
<safe topic stem> ~2.md
```

### Safe filenames

The exporter sanitizes Windows-invalid filename characters:

- `<`
- `>`
- `:`
- `"`
- `/`
- `\`
- `|`
- `?`
- `*`

It replaces them with `_`, trims trailing spaces and periods, and falls back to `dialogue` if needed.
Because the real topic id is also written in `Topic:`, the original TES3 dialogue id still round-trips even when the filename is sanitized.

---

## 10. Authoring Notes

- One file corresponds to one `DialogueInfo`, not one whole topic block.
- `DiagID` is optional for hand-authored content but always present in exported content.
- `PrevID` should be numeric if used.
- If you are modifying existing master dialogue, include complete and correct `Masters` in `header.md`.
- If you are importing/exporting existing plugin data, preserve `DiagID`, `PrevID`, and `Original text:` lines when present.
- The body text is not parsed for semantic fields except for the optional `Original text:` reconciliation helper used during resolve.

---

## 11. Minimal Examples

### Header

```yaml
---
Author: Example Author
Description: demo plugin
File Type: ESP
Masters:
  - Morrowind.esm
---
```

### New topic entry

```yaml
---
Type: Topic
Faction: Ashlanders
PC Faction: Ashlanders
PC Rank: Rank 3
FunctionIndex: 0
Function: Function
Variable: Choice = 2
---
This is the first response.
```

### Export-style preserved entry

```yaml
---
Topic: Greeting 1
Type: Greeting
DiagID: 50716010272305400
PrevID: 891314329736518839
Result: Goodbye
FunctionIndex: 1
Function: Local
Variable: dancingGirl = 1
FunctionIndex: 2
Function: Function
Variable: SameSex = 1
---
If you want a job here, you'll have to talk to Helviane. Excuse me.
```

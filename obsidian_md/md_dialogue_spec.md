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
Topic: test topic
PrevID: 123456789
Faction: Ashlanders
PC Faction: Ashlanders
PC Rank: Rank 3
Function0: Function
Variable0: Choice = 2
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
Type: Topic
Topic: Greeting 0
```

This is primarily used by the TES3-to-Markdown exporter so it can generate safe filenames while preserving the original TES3 topic id exactly.

---

## 4. Entry Frontmatter Fields

These keys are recognized by the parser.

| Key | Meaning |
|---|---|
| `Type` | Dialogue type: `Topic`, `Journal`, `Voice`, `Greeting`, or `Persuasion` |
| `Topic` | Overrides the topic id derived from the filename |
| `DiagID` | Preserved TES3 `DialogueInfo.id`; must be numeric if present |
| `PrevID` | TES3 `prev_id`; preserved as an opaque string identifier |
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
| `Sound Path` | `sound_path`; **Voice only** |
| `SoundPath` | Alias for `Sound Path` |
| `Result` | `script_text`; supports escaped `\\r\\n` or standard YAML literal block scalars (`\|`) |
| `Quest Name` | If `true`, sets journal quest state to `Name`; **Journal only** |
| `Finished` | If `true`, sets journal quest state to `Finished`; **Journal only** |
| `Restart` | If `true`, sets journal quest state to `Restart`; **Journal only** |
| `Function<n>` | Filter type name for filter slot `n`; **Not for Journal** |
| `Variable<n>` | Filter expression for filter slot `n`; **Not for Journal** |

### `Sex`

Accepted values:

- `Any` (or blank)
- `Male`
- `Female`

If omitted or blank, the compiler uses `Any`. The exporter only writes `Sex` if it is `Male` or `Female`.

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

- `PrevID` is treated as a string identifier reference, not a numeric value.
- If omitted, the compiler links the entry after the previously compiled entry for the same topic.
- If present, it is preserved verbatim during compile.
- For edits to existing dialogue, `PrevID` should be the exact upstream INFO id you want to link after.

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

The exporter writes multiline scripts back out using the standard YAML literal block scalar syntax (`|`):

```yaml
Result: |
  AddTopic "Girith's guar hides"
  Goodbye
```

The parser reconstructs the script by joining these indented lines with `\r\n`.
Alternatively, inline `\r\n` and `\n` escape sequences are decoded by the parser if used on a single line.
For `Voice` entries, the exporter always writes a `Result:` field even when the script text is empty.

### Body text

Everything after the closing `---` becomes `DialogueInfo.text`.

The parser:

- trims leading blank space before the body
- trims trailing line endings at the end of the file
- normalizes text line endings to CRLF internally

The exporter writes the text body exactly after a blank line following the closing `---`.

---

## 6. Filter Format

Filters are expressed as indexed pairs:

```yaml
Function0: Function
Variable0: Choice = 2
```

or:

```yaml
Function1: Journal
Variable1: my_quest >= 10
```

The numeric suffix `n` corresponds to the TES3 filter slot index (0-5).
Both `Function<n>` and `Variable<n>` must be present for a filter to be compiled.

### Filter type values accepted in `Function<n>:`

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

### `Variable<n>:` syntax

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

- `Function` uses the function name from the left-hand side of `Variable<n>:`
  - Example: `Variable0: Choice = 2`
- `Journal` maps to `JournalType`
- `Dead` maps to `DeadType`
- `Item` maps to `ItemType`
- `Global`, `Local`, and `NotLocal` map to `VariableCompare` unless an explicit recognized function name is provided
- `NotId`, `NotFaction`, `NotClass`, `NotRace`, and `NotCell` map to their TES3 negative-check function variants

For `Function`, the left-hand side is stored as `function_name` and the TES3 filter `id` becomes empty.
For other filter types, the left-hand side becomes the TES3 filter `id`.

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
2. merges the authored plugin into the master data
3. normalizes touched journal topics by journal index
4. removes unmodified records
5. restores the original authored masters list and sets the output file type to `ESP`

The resolver does not infer or recover missing dialogue ids from body text. Existing-record edits should carry the exact `DiagID` and any needed exact `PrevID` values in Markdown.

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

- `Type`
- `Topic`
- `DiagID`
- `PrevID`
- `Disposition` or `Index`
- speaker/player condition fields
- `Sound Path`
- `Result`
- `Quest Name`
- `Finished`
- `Restart`
- zero or more indexed filter pairs

For `Voice` entries specifically, `Result:` is always emitted so the Markdown shape stays stable even when the TES3 `script_text` is empty.

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
- `PrevID` should be treated as an exact identifier string.
- If you are modifying existing master dialogue, include complete and correct `Masters` in `header.md`.
- If you are importing/exporting existing plugin data, preserve `DiagID` and `PrevID` values when present.

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
Topic: My Topic
Faction: Ashlanders
PC Faction: Ashlanders
PC Rank: Rank 3
Function0: Function
Variable0: Choice = 2
---
This is the first response.
```

### Export-style preserved entry

```yaml
---
Type: Greeting
Topic: Greeting 1
DiagID: 50716010272305400
PrevID: 891314329736518839
Result: |
  Journal OAAB_TVos_MoraTrader 103
  ModDisposition -40
  goodbye
Function1: Local
Variable1: dancingGirl = 1
Function2: Function
Variable2: SameSex = 1
---
If you want a job here, you'll have to talk to Helviane. Excuse me.
```

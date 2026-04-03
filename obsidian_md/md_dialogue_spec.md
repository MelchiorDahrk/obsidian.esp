# TES3 Markdown Dialogue Authoring — Mandatory Field Specification

> [!IMPORTANT]
> This document defines what every `.md` dialogue/quest file **must** contain to be successfully compiled into a valid TES3 plugin (`.esp`/`.esm`). Fields marked **REQUIRED** must always be present. Fields marked **OPTIONAL** may be omitted; the compiler will use safe defaults.

---

## 1. File-Level Frontmatter (Plugin Header)

Every file must begin with a YAML frontmatter block. This block maps to the `Header` record (`TES3` tag) that must be the **first object** in any valid TES3 plugin.

```yaml
---
plugin_author: "AuthorName"          # REQUIRED — maps to Header.author (max 32 chars)
plugin_description: "Short note"     # REQUIRED — maps to Header.description (max 256 chars)
plugin_version: 1.3                  # OPTIONAL — defaults to 1.3 (the only version used in practice)
file_type: esp                       # OPTIONAL — "esp" or "esm", defaults to "esp"

masters:                             # REQUIRED if any IDs reference vanilla/mod content
  - Morrowind.esm                    # List master filenames in load-order (ascending)
  - Tribunal.esm
  - Bloodmoon.esm
---
```

### Why `masters` is mandatory

The TES3 linked-list model for **dialogue** (`DialogueGroup`) depends on inserting new `DialogueInfo` records *after* existing ones in the merged load order. To build that ordered list correctly, `merge_load_order()` must first know **all master files** so it can:

1. Collect master metadata (`Header::collect_masters`) and build a reference-remap table.
2. Give each INFO record a `prev_id` that resolves to a real INFO already present in a master.

If a master is omitted, the loaded `DialogueGroup.infos` list is incomplete, and `insert_info()` will silently append the new INFO to the **wrong position** — breaking NPC dialogue flow.

> [!WARNING]
> Masters must be listed in **exact load order** (the same order a user would put them in their `Morrowind.ini`). The file sizes used in `Header.masters` are read from disk at compile time — only the filenames need to be in the Markdown.

---

## 2. Dialogue Block Types

A single `.md` file may contain multiple dialogue blocks. Each block maps to one `DialogueGroup` (a `Dialogue` header + its ordered `DialogueInfo` records).

The first heading in a block declares its **type** and **ID**:

```
## [DialogueType] "<id>"
```

| `DialogueType` | TES3 Enum          | `Dialogue.id` convention                       |
|----------------|--------------------|------------------------------------------------|
| `Topic`        | `DialogueType2::Topic`      | Any string, e.g. `"little advice"`   |
| `Journal`      | `DialogueType2::Journal`    | Quest script ID, e.g. `"my_quest"`   |
| `Greeting`     | `DialogueType2::Greeting`   | Must be `"Greeting 0"` – `"Greeting 9"` |
| `Voice`        | `DialogueType2::Voice`      | e.g. `"Hello"`, `"Attack"`, `"Flee"` |
| `Persuasion`   | `DialogueType2::Persuasion` | e.g. `"Admire"`, `"Taunt"`, etc.     |

### REQUIRED fields per block

| Field        | Maps to               | Notes                                    |
|--------------|-----------------------|------------------------------------------|
| `type`       | `Dialogue.dialogue_type` | One of the five types above           |
| `id`         | `Dialogue.id`         | Case-insensitive; stored lowercase in maps |

---

## 3. DialogueInfo Records (Entries)

Each entry within a dialogue block maps to one `DialogueInfo` record.

### 3.1  Entry ID

```yaml
- id: "unique_info_id_001"   # REQUIRED
```

- Must be **globally unique** across the entire plugin and its masters.
- Used as the key for the linked-list (`prev_id` / `next_id`) that controls ordering.
- Recommended convention: `<topic_slug>_<NNN>` (e.g., `my_quest_010`).

> [!CAUTION]
> Duplicate INFO IDs within the same `DialogueGroup` cause `insert_info()` to **replace** the existing record silently. Duplicates across different topics or plugins produce undefined engine behavior.

### 3.2  Ordering / Position

```yaml
  prev_id: "unique_info_id_000"   # OPTIONAL — empty string = insert at front of list
```

- `prev_id` controls where this INFO is inserted in the linked list.
- **Empty string** → inserted at the **front** (highest evaluation priority).
- **Valid ID** → inserted immediately *after* that INFO.
- **Missing / unresolvable ID** → appended to the **end**.
- The compiler calls `repair_links()` after all inserts, so explicit `next_id` is never needed in source.

> [!IMPORTANT]
> For Topics and Greetings the engine evaluates entries **top-to-bottom** and uses the **first match**. More specific entries (single NPC, more filters) **must be listed before** less specific ones. Ordering in the Markdown must reflect intended evaluation order.

### 3.3  Speaker Conditions

Maps to `DialogueInfo` string fields. All are **OPTIONAL** (empty = no constraint):

```yaml
  speaker_id:      "caius cosades"   # Specific NPC ID (ONAM sub-record)
  speaker_race:    "Imperial"        # Race ID
  speaker_class:   "Operative"       # Class ID
  speaker_faction: "Blades"          # Faction ID
  speaker_cell:    "Balmora"         # Cell name (interior) or leave empty
  player_faction:  "Mages Guild"     # Player must be in this faction
```

### 3.4  DialogueData Fields

Maps to the `DialogueData` sub-record embedded in each INFO:

```yaml
  dialogue_type: Topic               # REQUIRED — must match the parent block's type
  disposition:   50                  # REQUIRED (for Topic/Voice/Greeting/Persuasion) OR journal index for Journal type
  speaker_rank:  -1                  # OPTIONAL — -1 = any rank; 0+ = minimum rank in speaker_faction
  speaker_sex:   Any                 # OPTIONAL — "Any" (-1), "Male" (0), "Female" (1)
  player_rank:   -1                  # OPTIONAL — -1 = any rank; 0+ = minimum rank in player_faction
```

> [!IMPORTANT]
> **For Journal entries**, `disposition` is **repurposed as the journal index** (stage number, 0–32767), not a disposition requirement. Do not confuse the two.

### 3.5  Text

```yaml
  text: |
    "There is a hidden passage behind the bookshelf."
```

- **REQUIRED** for Topic, Greeting, Voice, and Persuasion entries.
- **OPTIONAL** for Journal entries (used as the journal log text shown to the player).
- Hard engine limit: **512 characters**. The compiler should enforce this.

### 3.6  Quest State (Journal only)

```yaml
  quest_state: Name       # OPTIONAL — one of: Name | Finished | Restart | (omit for plain entry)
```

| Value      | Meaning                                            |
|------------|----------------------------------------------------|
| `Name`     | This index displays the quest name in the journal  |
| `Finished` | Marks the quest as completed                       |
| `Restart`  | Restarts a finished/failed quest                   |
| *(omit)*   | Plain journal entry, no special state change       |

> [!NOTE]
> Every Journal dialogue block should have **exactly one** entry with `quest_state: Name` to give the quest a display name. A quest without it will appear with a blank name in the in-game journal.

### 3.7  Sound Path (Voice lines)

```yaml
  sound_path: "Sound\\Vo\\n\\m\\attck1.wav"   # OPTIONAL — path relative to Data Files\
```

Required only for **Voice** type entries that have recorded audio. Leave empty otherwise.

### 3.8  Result Script

```yaml
  script_text: |
    Journal "my_quest" 20
    StartScript "mq_trigger"
```

- **OPTIONAL** — MWScript source code that runs when this INFO is selected.
- Maps to `DialogueInfo.script_text` (the `BNAM` sub-record).
- This is **interpreted script text**, not a compiled `Script` record. It runs as an immediate result script.

### 3.9  Filters (Conditions)

Up to **6 filters** per INFO entry. Each filter maps to a `Filter` struct.

```yaml
  filters:
    - index:      0              # REQUIRED — slot 0–5 (must be unique per entry)
      type:       Journal        # REQUIRED — see FilterType table below
      function:   ~              # REQUIRED for type=Function; omit otherwise
      comparison: ">="           # REQUIRED — one of: == != > >= < <=
      id:         "my_quest"     # REQUIRED for Journal/Item/Global/Local/Dead/Not* types
      value:      10             # REQUIRED — integer or float
```

#### FilterType Reference

| Markdown value | `FilterType` enum  | `id` field meaning                        |
|----------------|--------------------|-------------------------------------------|
| `Function`     | `Function`         | *(not used — use `function` field)*       |
| `Global`       | `Global`           | Global variable name                      |
| `Local`        | `Local`            | Local script variable name                |
| `Journal`      | `Journal`          | Quest ID                                  |
| `Item`         | `Item`             | Item BASE ID                              |
| `Dead`         | `Dead`             | NPC/Creature ID                           |
| `NotId`        | `NotId`            | NPC ID (speaker must NOT be this NPC)     |
| `NotFaction`   | `NotFaction`       | Faction ID (speaker must NOT be in it)    |
| `NotClass`     | `NotClass`         | Class ID                                  |
| `NotRace`      | `NotRace`          | Race ID                                   |
| `NotCell`      | `NotCell`          | Cell name                                 |
| `NotLocal`     | `NotLocal`         | Local variable (negative check)           |

#### FilterFunction Reference (type=Function only)

Used when `type: Function`. The `id` field is unused; the value is compared against the function result.

```yaml
      function: PcLevel          # e.g. PcLevel >= 5
```

Key functions: `PcLevel`, `PcReputation`, `PcHealth`, `PcGold`, `PcSex`, `Reputation`,
`Disposition`, `Choice`, `TalkedToPc`, `Attacked`, `SameFaction`, `SameRace`,
`FactionRankDifference`, `Weather`, `Werewolf`, etc.

#### FilterComparison Symbols

| Markdown | `FilterComparison` |
|----------|--------------------|
| `==`     | `Equal`            |
| `!=`     | `NotEqual`         |
| `>`      | `Greater`          |
| `>=`     | `GreaterEqual`     |
| `<`      | `Less`             |
| `<=`     | `LessEqual`        |

---

## 4. Dialogue Type Quick-Reference

### 4.1 Topic

```yaml
## Topic "little advice"

- id: "little_advice_caius_001"
  prev_id: ""                         # First in list (front)
  dialogue_type: Topic
  speaker_id: "caius cosades"
  disposition: 30
  speaker_sex: Any
  speaker_rank: -1
  player_rank: -1
  text: "Stay out of trouble, outlander."
  filters:
    - index: 0
      type: Journal
      comparison: "<"
      id: "my_quest"
      value: 10
  script_text: ""
```

### 4.2 Journal

```yaml
## Journal "my_quest"

- id: "my_quest_000"
  dialogue_type: Journal
  disposition: 0          # journal index = 0
  quest_state: Name
  text: "My Quest"        # Quest display name

- id: "my_quest_010"
  dialogue_type: Journal
  disposition: 10         # journal index = 10
  text: "I heard a rumor about treasure in the cave."

- id: "my_quest_100"
  dialogue_type: Journal
  disposition: 100        # journal index = 100
  quest_state: Finished
  text: "I found the treasure."
```

### 4.3 Greeting

```yaml
## Greeting "Greeting 0"

- id: "greet0_essential_npc_001"
  prev_id: ""
  dialogue_type: Greeting
  speaker_id: "vital npc"
  disposition: 0
  speaker_sex: Any
  speaker_rank: -1
  player_rank: -1
  text: "I've been expecting you."
  filters:
    - index: 0
      type: Journal
      comparison: ">="
      id: "my_quest"
      value: 10
```

### 4.4 Voice

```yaml
## Voice "Hello"

- id: "hello_guard_001"
  prev_id: ""
  dialogue_type: Voice
  speaker_class: "Guard"
  disposition: 0
  speaker_sex: Any
  speaker_rank: -1
  player_rank: -1
  sound_path: ""
  text: "Move along, citizen."
```

### 4.5 Persuasion

```yaml
## Persuasion "Taunt"

- id: "taunt_generic_001"
  prev_id: ""
  dialogue_type: Persuasion
  disposition: 0
  speaker_sex: Any
  speaker_rank: -1
  player_rank: -1
  text: "You can't intimidate me!"
```

---

## 5. Global Compile-Time Requirements

These apply to the **entire file**, not individual records:

| Requirement | Reason |
|---|---|
| Unique `id` values across all INFO entries in the file | `insert_info()` replaces on duplicate — silent data loss |
| `masters` list complete and in load order | Required to build the pre-existing INFO linked list correctly |
| `disposition` for Journal entries interpreted as journal index | Compiler must treat this field differently per dialogue type |
| Journal Dialogues serialized **before** all other types | Required by the TES3 engine (`into_objects()` enforces this; compiler must too) |
| Words in `id`, `speaker_id`, etc. match the case used in masters *exactly* | The engine is case-insensitive at runtime, but `merge_to_master` lowercases keys — IDs from masters must already be lowercase or the compiler must normalize them |
| Filter `index` values 0–5, no duplicates per INFO | The engine only reads 6 filter slots; extras are silently ignored |
| `text` ≤ 512 characters | Hard engine limit; the `Save` trait omits null terminator to stay within it |

---

## 6. What the Compiler Must Supply Automatically

These values are **not authored** in Markdown but must be computed by the compiler:

| Field | How the compiler derives it |
|---|---|
| `Header.num_objects` | Count of all records written |
| `Header.masters[*].size` | Read file size of each master from disk |
| `DialogueInfo.next_id` | Computed by `repair_links()` after all inserts |
| `DialogueInfo.prev_id` (final) | Computed by `repair_links()` for new records inserted mid-list |
| `ObjectFlags` | Default (`0`) for new records; preserve flags from merged masters |
| Plugin sort order | `PluginData::into_plugin()` / `sort_objects()` handles this |

---

## 7. Recommended File Structure Summary

```
---
plugin_author: "..."
plugin_description: "..."
masters:
  - Morrowind.esm
  [additional masters in order]
---

## Journal "<quest_id>"        ← Journals FIRST (engine requirement)
[entries...]

## Topic "<topic name>"
[entries...]

## Greeting "Greeting N"
[entries...]

## Voice "<voice id>"
[entries...]

## Persuasion "<persuasion id>"
[entries...]
```

> [!TIP]
> Splitting one quest into **one `.md` file per dialogue type** (e.g., `my_quest_journal.md`, `my_quest_topics.md`) is valid as long as each file has its own complete `masters` frontmatter. The compiler merges them using the same `PluginData::merge_into()` path used for regular plugins.

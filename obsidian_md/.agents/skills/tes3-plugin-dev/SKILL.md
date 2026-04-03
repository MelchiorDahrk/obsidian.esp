---
name: tes3-plugin-dev
description: Reference for working with the `tes3` and `merge_to_master` Rust crates to read, write, merge, and query TES3 (Morrowind) plugin data. Use this skill whenever the task involves TES3 plugin structures, dialogue/quest authoring, plugin merging, load-order resolution, or any Morrowind modding data manipulation in Rust. Consult this skill even if the user doesn't say "skill" — any mention of TES3, Morrowind plugins, ESP/ESM files, dialogue records, journal entries, or the `tes3`/`merge_to_master` crates should trigger it.
---

# TES3 Plugin Development with `tes3` and `merge_to_master`

This skill documents the two Rust libraries used in the `obsidian_md` project for reading, writing, merging, and querying TES3 (The Elder Scrolls III: Morrowind) plugin files.

## Crate Overview

### `tes3` (git: Greatness7/tes3)
Low-level library for serializing and deserializing TES3 plugin files (`.esm`, `.esp`). Provides:
- The `Plugin` container (a flat `Vec<TES3Object>`)
- All 36+ record types as Rust structs
- Load/Save traits for binary I/O
- Parallel deserialization via rayon

### `merge_to_master` (git: Greatness7/merge_to_master, branch: merge_load_order)
Higher-level library that organizes raw plugin data into indexed collections and provides merge logic. Provides:
- `PluginData` — structured representation with separate maps for objects, cells, and dialogues
- `merge_load_order()` / `par_merge_load_order()` — merge an entire load order into one resolved dataset
- `merge_plugins()` — merge a single plugin into its master
- Traits for merging, remapping masters, converting back to objects

---

## Core Architecture

```
┌─────────────────────────────────────────────────┐
│                  Plugin (tes3)                   │
│  A flat Vec<TES3Object> — the raw file format   │
└─────────────────┬───────────────────────────────┘
                  │ PluginData::from_plugin()
                  ▼
┌─────────────────────────────────────────────────┐
│              PluginData (merge_to_master)        │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │  header   │ │  objects  │ │   dialogues    │  │
│  │ (Header)  │ │ (Objects) │ │ (Dialogues)    │  │
│  └──────────┘ └──────────┘ └────────────────┘  │
│  ┌──────────────────────────────────────────┐   │
│  │                 cells                     │   │
│  │  ┌───────────┐    ┌───────────┐          │   │
│  │  │ exteriors  │    │ interiors  │          │   │
│  │  └───────────┘    └───────────┘          │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## `tes3::esp::Plugin`

The raw plugin file representation.

```rust
pub struct Plugin {
    pub objects: Vec<TES3Object>,
}
```

### Key Methods
```rust
// Load / Save
Plugin::from_path(path) -> io::Result<Self>
Plugin::from_path_filtered(path, |tag| bool) -> io::Result<Self>
plugin.save_path(path) -> io::Result<()>
plugin.load_bytes(&[u8]) -> io::Result<()>
plugin.save_bytes() -> io::Result<Vec<u8>>

// Querying objects by type
plugin.header() -> Option<&Header>
plugin.header_mut() -> Option<&mut Header>
plugin.objects_of_type::<T>() -> impl Iterator<Item = &T>
plugin.objects_of_type_mut::<T>() -> impl Iterator<Item = &mut T>
plugin.into_objects_of_type::<T>() -> impl Iterator<Item = T>
```

Objects are deserialized in parallel using rayon. The `from_path_filtered` variant only loads record types matching the filter predicate (checked against the 4-byte tag).

---

## `TES3Object` Enum

All record types in the TES3 format. Every variant wraps its struct and has a 4-byte tag:

```rust
pub enum TES3Object {
    Header(Header),           // TES3
    GameSetting(GameSetting), // GMST
    GlobalVariable(GlobalVariable), // GLOB
    Class(Class),             // CLAS
    Faction(Faction),         // FACT
    Race(Race),               // RACE
    Sound(Sound),             // SOUN
    SoundGen(SoundGen),       // SNDG
    Skill(Skill),             // SKIL
    MagicEffect(MagicEffect), // MGEF
    Script(Script),           // SCPT
    Region(Region),           // REGN
    Birthsign(Birthsign),     // BSGN
    StartScript(StartScript), // SSCR
    LandscapeTexture(LandscapeTexture), // LTEX
    Spell(Spell),             // SPEL
    Static(Static),           // STAT
    Door(Door),               // DOOR
    MiscItem(MiscItem),       // MISC
    Weapon(Weapon),           // WEAP
    Container(Container),     // CONT
    Creature(Creature),       // CREA
    Bodypart(Bodypart),       // BODY
    Light(Light),             // LIGH
    Enchanting(Enchanting),   // ENCH
    Npc(Npc),                 // NPC_
    Armor(Armor),             // ARMO
    Clothing(Clothing),       // CLOT
    RepairItem(RepairItem),   // REPA
    Activator(Activator),     // ACTI
    Apparatus(Apparatus),     // APPA
    Lockpick(Lockpick),       // LOCK
    Probe(Probe),             // PROB
    Ingredient(Ingredient),   // INGR
    Book(Book),               // BOOK
    Alchemy(Alchemy),         // ALCH
    LeveledItem(LeveledItem), // LEVI
    LeveledCreature(LeveledCreature), // LEVC
    Cell(Cell),               // CELL
    Landscape(Landscape),     // LAND
    PathGrid(PathGrid),       // PGRD
    Dialogue(Dialogue),       // DIAL
    DialogueInfo(DialogueInfo), // INFO
}
```

The `TES3Object` enum implements `TryInto<&T>` for each inner type, enabling `plugin.objects_of_type::<Dialogue>()`.

---

## `PluginData` (merge_to_master)

Structured, indexed representation of a plugin's contents.

```rust
pub struct PluginData {
    pub header: Header,
    pub objects: Objects,
    pub cells: Cells,
    pub dialogues: Dialogues,
}
```

### Type Aliases
```rust
pub type ObjectId = String;
pub type Tag = &'static [u8; 4];
pub type TaggedId = (Tag, ObjectId);
pub type Objects = HashMap<TaggedId, TES3Object>;
pub type Dialogues = HashMap<ObjectId, DialogueGroup>;
```

### Object Keying Strategy

**Non-physical objects** (Script, Sound, Faction, etc.) use `(tag, lowercase_id)` as their key, so different record types can share the same ID string.

**Physical objects** (Activator, Armor, Weapon, Npc, Creature, etc.) all use a fixed tag `&[0; 4]` plus lowercase ID, enforcing globally unique IDs among placed objects.

### Key Methods
```rust
// Construction
PluginData::new() -> Self                        // empty
PluginData::from_path(path) -> Result<Self>      // load full plugin
PluginData::from_path_partial(path) -> Result<Self> // load only cells + dialogue
PluginData::from_plugin(plugin: Plugin) -> Self  // convert from raw Plugin

// Conversion
plugin_data.into_plugin() -> Plugin              // convert back (sorted)
plugin_data.save_path(path) -> Result<()>        // save to disk

// Utilities
plugin_data.set_all_ignored(bool)                // mark all records ignored
plugin_data.count_objects() -> usize             // total record count
```

---

## Header

```rust
pub struct Header {
    pub flags: ObjectFlags,
    pub version: f32,           // default: 1.3
    pub file_type: FileType,    // Esp, Esm, or Ess
    pub author: FixedString<32>,
    pub description: FixedString<256>,
    pub num_objects: u32,
    pub masters: Vec<(String, u64)>,  // (master_name, file_size)
}
```

### Extension Methods (merge_to_master)
```rust
// Collect (name, size) pairs for all plugins in a load order
Header::collect_masters(plugin_paths: &[PathBuf]) -> Result<Vec<(String, u64)>>

// Build a lookup table mapping master names to indices (for reference remapping)
Header::build_master_remap(masters: &[(String, u64)]) -> HashMap<&UncasedStr, u32>

// Ensure a master is in the masters list (for single-plugin merge)
header.ensure_master_present(master_path: &Path) -> Result<&str>
```

---

## Dialogue System (Critical for Quest/Dialogue Authoring)

### `Dialogue` (tes3::esp)

A dialogue topic header. Every topic, journal, greeting, voice line, and persuasion entry is a `Dialogue`.

```rust
pub struct Dialogue {
    pub flags: ObjectFlags,
    pub id: String,                    // Topic name or journal ID
    pub dialogue_type: DialogueType2,  // Topic, Voice, Greeting, Persuasion, or Journal
}
```

### `DialogueType2` / `DialogueType`

```rust
// DialogueType2 (u8, used in Dialogue)
pub enum DialogueType2 {
    Topic = 0,       // Conversation topics  (e.g. "little advice")
    Voice = 1,       // Idle/combat voice lines (e.g. "Hello", "Attack")
    Greeting = 2,    // NPC greeting lines (Greeting 0..9)
    Persuasion = 3,  // Admire / Intimidate / Taunt / Bribe responses
    Journal = 4,     // Quest journal entries
}

// DialogueType (u32, used in DialogueData inside DialogueInfo)
pub enum DialogueType {
    Topic = 0,
    Voice = 1,
    Greeting = 2,
    Persuasion = 3,
    Journal = 4,
}
```

### `DialogueInfo` (tes3::esp)

An individual response within a dialogue topic. This is where the actual text, conditions, and quest state live.

```rust
pub struct DialogueInfo {
    pub flags: ObjectFlags,
    pub id: String,              // Unique INFO record ID
    pub prev_id: String,         // Links to previous INFO (doubly-linked list)
    pub next_id: String,         // Links to next INFO
    pub data: DialogueData,      // Type, disposition, rank, sex requirements
    pub speaker_id: String,      // Specific NPC ID who speaks this (ONAM)
    pub speaker_race: String,    // Required speaker race
    pub speaker_class: String,   // Required speaker class
    pub speaker_faction: String, // Required speaker faction
    pub speaker_cell: String,    // Required cell location
    pub player_faction: String,  // Required player faction
    pub sound_path: String,      // Path to voice audio file
    pub text: String,            // The displayed text (max 512 chars in engine)
    pub quest_state: Option<QuestState>, // For journal entries only
    pub filters: Vec<Filter>,    // Additional conditions (up to 6)
    pub script_text: String,     // Result script (BNAM) — runs when this info is selected
}
```

### `DialogueData`

Sub-record embedded in each `DialogueInfo`:

```rust
pub struct DialogueData {
    pub dialogue_type: DialogueType, // u32 version of the type
    pub disposition: i32,            // Minimum NPC disposition required
    pub speaker_rank: i8,            // Required rank in speaker_faction (-1 = any)
    pub speaker_sex: Sex,            // Any (-1), Male (0), or Female (1)
    pub player_rank: i8,             // Required rank in player_faction (-1 = any)
}
```

### `QuestState`

Used only for journal-type dialogues:

```rust
pub enum QuestState {
    Name = 0,      // This journal index has a quest name displayed in journal
    Finished = 1,  // This index marks the quest as finished
    Restart = 2,   // This index restarts the quest
}
```

### `Filter`

Conditions that must be met for a `DialogueInfo` to be shown. Up to 6 per INFO.

```rust
pub struct Filter {
    pub index: u8,                   // Filter slot (0-5)
    pub filter_type: FilterType,     // Category of condition
    pub function: FilterFunction,    // Specific function to check
    pub comparison: FilterComparison,// How to compare (==, !=, >, >=, <, <=)
    pub id: String,                  // Reference ID (variable name, item ID, etc.)
    pub value: FilterValue,          // Value to compare against
}

pub enum FilterValue {
    Float(f32),
    Integer(i32),
}
```

### `FilterType`

The category of a dialogue filter condition:

```rust
pub enum FilterType {
    None = b'0',       // No filter
    Function = b'1',   // Built-in function (PcLevel, Reputation, etc.)
    Global = b'2',     // Global variable check
    Local = b'3',      // Local script variable check
    Journal = b'4',    // Journal index check (e.g. "quest_stage >= 10")
    Item = b'5',       // Player has item count
    Dead = b'6',       // NPC is dead count
    NotId = b'7',      // Speaker is NOT this NPC
    NotFaction = b'8', // Speaker is NOT in this faction
    NotClass = b'9',   // Speaker is NOT this class
    NotRace = b'A',    // Speaker is NOT this race
    NotCell = b'B',    // Speaker is NOT in this cell
    NotLocal = b'C',   // Local variable negative check
}
```

### `FilterFunction`

Built-in functions used when `filter_type == Function`. Key ones for dialogue/quests:

```rust
pub enum FilterFunction {
    // Player stats
    PcLevel, PcReputation, PcHealth, PcHealthPercent, PcMagicka, PcFatigue,
    PcStrength, PcIntelligence, PcWillpower, PcAgility, PcSpeed, PcEndurance,
    PcPersonality, PcLuck,

    // Player skills (PcBlock, PcArmorer, ..., PcHandToHand)

    // NPC stats
    HealthPercent, Reputation, Level,

    // Social
    Disposition (via disposition field, not filter), ReactionLow, ReactionHigh,
    RankRequirement, SameSex, SameRace, SameFaction, FactionRankDifference,

    // Dialogue flow
    Choice,        // Player selected dialogue choice N
    Hello,         // Hello distance check
    Fight, Flee, Alarm, // AI settings
    TalkedToPc, Attacked, Detected, Alarmed,

    // Status
    PcSex, PcExpelled, PcCommonDisease, PcBlightDisease, PcCorprus, PcVampire,
    PcClothingModifier, PcCrimeLevel, PcGold,
    Werewolf, WerewolfKills, CreatureTarget, FriendHit, ShouldAttack,
    Weather,

    // ... (full list in enums.rs)
}
```

### `FilterComparison`

```rust
pub enum FilterComparison {
    Equal = b'0',
    NotEqual = b'1',
    Greater = b'2',
    GreaterEqual = b'3',
    Less = b'4',
    LessEqual = b'5',
}
```

---

## `DialogueGroup` (merge_to_master)

Groups a `Dialogue` header with its ordered list of `DialogueInfo` records:

```rust
pub struct DialogueGroup {
    pub dialogue: Dialogue,
    pub infos: VecDeque<DialogueInfo>,
}
```

### Key Methods
```rust
// Find the index of a DialogueInfo by its id
group.find(id: &str) -> Option<usize>

// Insert a new info, respecting prev_id ordering.
// If an INFO with the same id exists, it replaces it.
// If prev_id is empty, inserts at front.
// If prev_id references an existing INFO, inserts after it.
// Otherwise appends to end.
group.insert_info(info: DialogueInfo)

// Repair the prev_id/next_id linked list after modifications
group.repair_links()
```

### INFO Ordering Rules

`DialogueInfo` records form a doubly-linked list via `prev_id` and `next_id`. The engine evaluates them top-to-bottom, using the **first matching** INFO. This ordering is critical:
- INFOs with empty `prev_id` go to the front
- INFOs specify their position by referencing the `prev_id` they should follow
- `repair_links()` fixes up the linked list after bulk modifications

### Dialogue Serialization Order

When converting back to `Plugin` via `into_objects()`, dialogues are sorted:
1. **Journals first** (required by the engine)
2. Then Topics, Voice, Greeting, Persuasion
3. Within each type, sorted alphabetically by `dialogue.id`

Each `DialogueGroup` emits: `Dialogue` record, then all `DialogueInfo` records in order.

---

## Cells

```rust
pub struct Cells {
    pub exteriors: HashMap<(i32, i32), Exterior>,  // keyed by grid coords
    pub interiors: HashMap<UString, Interior>,      // keyed by cell name (case-insensitive)
}

pub struct Interior {
    pub cell: Option<Cell>,
    pub pathgrid: Option<PathGrid>,
}

pub struct Exterior {
    pub cell: Option<Cell>,
    pub landscape: Option<Landscape>,
    pub pathgrid: Option<PathGrid>,
}
```

### Key Methods
```rust
cells.get_interior(name) / cells.get_interior_mut(name)
cells.get_exterior(coords) / cells.get_exterior_mut(coords)
cells.get_or_create_interior(name) -> &mut Interior
cells.get_or_create_exterior(coords) -> &mut Exterior
cells.get_cell(CellKey) -> Option<&Cell>
cells.iter() / cells.iter_mut()       // iterate all cells
cells.par_iter() / cells.par_iter_mut() // parallel iteration
cells.len() -> usize
cells.references() -> impl Iterator<Item = &Reference>
```

---

## Merge Functions

### `merge_load_order` — Primary Entry Point

Merges an entire load order into one resolved `PluginData`. This is the function to use when you need the complete game state.

```rust
pub fn merge_load_order(plugin_paths: &[PathBuf]) -> Result<PluginData>
```

**How it works:**
1. Collects master metadata from all plugins (`Header::collect_masters`)
2. Builds a master index remap table (`Header::build_master_remap`)
3. Iterates plugins in order, loading each and remapping its reference indices
4. Remaps textures to resolve conflicts
5. Merges each plugin into the accumulator via `plugin.merge_into(&mut merged)`
6. Sets the result type to ESM and cleans up ignored records

### `par_merge_load_order` — Parallel Version

Same as above but loads and preprocesses plugins in parallel batches (batch size = `max(num_threads, 8)`). Merge itself is still sequential to preserve order.

```rust
pub fn par_merge_load_order(plugin_paths: &[PathBuf]) -> Result<PluginData>
```

### `merge_plugins` — Single Plugin Merge

Merges one plugin into its master file:

```rust
pub fn merge_plugins(plugin_path: &PathBuf, master_path: &PathBuf, options: MergeOptions) -> Result<PluginData>
```

```rust
pub struct MergeOptions {
    pub remove_deleted: bool,
    pub apply_moved_references: bool,
    pub preserve_duplicate_references: bool,
}
```

### `MergeInto` Trait

```rust
pub trait MergeInto {
    fn merge_into(self, target: &mut Self);
}
```

Implemented for:
- **`PluginData`** — merges header, objects, cells, and dialogues separately
- **`TES3Object`** — simple replacement (`*target = self`)
- **`Interior`** / **`Exterior`** — merges cell data and replaces pathgrid/landscape if present
- **`Cell`** — merges attributes and extends references
- **`DialogueGroup`** — replaces the Dialogue header, inserts all INFOs via `insert_info()`, then calls `repair_links()`

---

## ObjectFlags

Bitflags present on every record:

```rust
pub struct ObjectFlags: u32 {
    const MODIFIED   = 0x2;
    const DELETED    = 0x20;
    const PERSISTENT = 0x400;
    const IGNORED    = 0x1000;
    const BLOCKED    = 0x2000;
}
```

- `DELETED` — record is marked for deletion (used by plugins to remove master records)
- `IGNORED` — internal flag used by merge logic to skip records from non-target masters
- `PERSISTENT` — record persists across cell changes (important for quest NPCs)

---

## Usage Pattern: Loading a Merged Database

The canonical way to get a fully resolved game database:

```rust
use std::path::PathBuf;
use anyhow::Result;
use merge_to_master::merge_load_order;
use merge_to_master::{PluginData, Dialogues};
use tes3::esp::{DialogueType2, DialogueInfo};

fn load_game_data(plugin_paths: &[PathBuf]) -> Result<PluginData> {
    merge_to_master::merge_load_order(plugin_paths)
}
```

### Querying Dialogues

```rust
fn print_all_journal_entries(data: &PluginData) {
    for (id, group) in &data.dialogues {
        if group.dialogue.dialogue_type == DialogueType2::Journal {
            println!("Journal: {}", group.dialogue.id);
            for info in &group.infos {
                let state = match info.quest_state {
                    Some(QuestState::Name) => " [QUEST NAME]",
                    Some(QuestState::Finished) => " [FINISHED]",
                    Some(QuestState::Restart) => " [RESTART]",
                    None => "",
                };
                println!("  Index {}: {}{}", info.data.disposition, info.text, state);
            }
        }
    }
}

fn find_topic_responses(data: &PluginData, topic: &str) -> Vec<&DialogueInfo> {
    let key = topic.to_ascii_lowercase();
    data.dialogues
        .get(&key)
        .map(|group| group.infos.iter().collect())
        .unwrap_or_default()
}
```

### Creating New Dialogue

```rust
use tes3::esp::*;
use merge_to_master::*;

fn create_journal_entry(data: &mut PluginData) {
    let journal_id = "my_quest";
    let key = journal_id.to_ascii_lowercase();

    let group = data.dialogues.entry(key).or_insert_with(|| {
        DialogueGroup {
            dialogue: Dialogue {
                flags: ObjectFlags::default(),
                id: journal_id.to_string(),
                dialogue_type: DialogueType2::Journal,
            },
            infos: Default::default(),
        }
    });

    // Add a journal entry at index 10
    let info = DialogueInfo {
        id: "unique_info_id_001".to_string(),
        data: DialogueData {
            dialogue_type: DialogueType::Journal,
            disposition: 10,  // For journals, disposition = journal index
            speaker_rank: -1,
            speaker_sex: Sex::Any,
            player_rank: -1,
        },
        text: "I heard a rumor about treasure in the cave.".to_string(),
        quest_state: Some(QuestState::Name),
        ..Default::default()
    };
    group.insert_info(info);
}
```

### Creating a Topic with Filters

```rust
fn create_filtered_topic(data: &mut PluginData) {
    let topic = "secret passage";
    let key = topic.to_ascii_lowercase();

    let group = data.dialogues.entry(key).or_insert_with(|| {
        DialogueGroup {
            dialogue: Dialogue {
                id: topic.to_string(),
                dialogue_type: DialogueType2::Topic,
                ..Default::default()
            },
            infos: Default::default(),
        }
    });

    let info = DialogueInfo {
        id: "secret_passage_001".to_string(),
        speaker_id: "caius cosades".to_string(),       // Only Caius says this
        data: DialogueData {
            dialogue_type: DialogueType::Topic,
            disposition: 50,                             // Needs 50+ disposition
            speaker_rank: -1,
            speaker_sex: Sex::Any,
            player_rank: -1,
        },
        text: "There's a hidden passage behind the bookshelf.".to_string(),
        filters: vec![
            Filter {
                index: 0,
                filter_type: FilterType::Journal,
                function: FilterFunction::default(),
                comparison: FilterComparison::GreaterEqual,
                id: "my_quest".to_string(),
                value: FilterValue::Integer(10),          // Journal index >= 10
            },
        ],
        script_text: "Journal \"my_quest\" 20".to_string(), // Advance journal
        ..Default::default()
    };
    group.insert_info(info);
}
```

### Saving Back to Plugin

```rust
fn save_plugin(data: PluginData, path: &std::path::Path) -> Result<()> {
    data.save_path(path)
}
```

When `PluginData::into_plugin()` is called (internally by `save_path`):
1. A new `Plugin` is created
2. Header object is pushed first
3. Objects are added (`self.objects.into_values()`)
4. Cells are added (exteriors then interiors, each sorted)
5. Dialogues are added (journals first, then alphabetical within type)
6. `plugin.sort_objects()` is called for final ordering

---

## TES3 Dialogue System: How It Works

### Topic Resolution (Runtime Behavior)

When the player talks to an NPC:
1. Engine collects all `Dialogue` records of the relevant type
2. For each topic, iterates through `DialogueInfo` records **in order** (linked list)
3. The **first** INFO whose conditions ALL match is displayed
4. Conditions checked: speaker_id, speaker_race, speaker_class, speaker_faction, speaker_cell, player_faction, data.disposition, data.speaker_rank, data.speaker_sex, data.player_rank, plus all filters

### Journal System

- Each quest has a `Dialogue` with `type = Journal`
- Journal entries are `DialogueInfo` records where `data.disposition` = the journal index (0-100+)
- `quest_state = Some(QuestState::Name)` marks an entry that shows the quest name in the journal
- `quest_state = Some(QuestState::Finished)` marks the quest complete
- Scripts set journal entries via: `Journal "quest_id" <index>`

### Greeting System

- Greetings use `type = Greeting`
- The dialogue ID is "Greeting 0" through "Greeting 9"
- "Greeting 0" is checked first (highest priority)
- Only the first matching greeting INFO is shown

### Disposition Field

- For **Topic/Voice/Greeting/Persuasion**: minimum NPC disposition required
- For **Journal**: serves as the journal **index** (the stage number)

---

## Complete Enum Reference

### `FileType`
```rust
Esp = 0, Esm = 1, Ess = 32
```

### `Sex`
```rust
Any = -1, Male = 0, Female = 1
```

### Key Flag Types

| Flag Type | Key Flags |
|-----------|-----------|
| `CellFlags` | `IS_INTERIOR`, `HAS_WATER`, `RESTING_IS_ILLEGAL`, `BEHAVES_LIKE_EXTERIOR` |
| `NpcFlags` | `FEMALE`, `ESSENTIAL`, `RESPAWN`, `IS_BASE`, `AUTO_CALCULATE` |
| `CreatureFlags` | `BIPED`, `RESPAWN`, `WEAPON_AND_SHIELD`, `ESSENTIAL`, `SWIMS`, `FLIES`, `WALKS` |

---

## Important Implementation Notes

1. **Case-insensitive IDs**: All dialogue lookups in `merge_to_master` use lowercased IDs. The `Dialogues` HashMap keys are always lowercase. The `Cells.interiors` map uses `UString` (uncased string) for case-insensitive lookup.

2. **Text limit**: `DialogueInfo.text` has a 512-character engine limit. The `Save` implementation intentionally omits the null terminator to avoid exceeding this.

3. **Info ordering matters**: The engine evaluates INFOs top-to-bottom and uses the first match. More specific conditions should come first (specific NPC before generic race/class).

4. **Journal index via disposition**: For journal entries, `DialogueData.disposition` is repurposed as the journal index number, not an actual disposition requirement.

5. **prev_id / next_id linked list**: DialogueInfo records form a doubly-linked list. `insert_info()` handles correct insertion. Always call `repair_links()` after bulk modifications.

6. **Script text**: The `script_text` field (BNAM) contains MWScript source code that runs as a "result script" when the INFO is displayed. This is distinct from compiled scripts (`Script` records).

7. **Parallel loading**: `Plugin::load_bytes` uses rayon to deserialize records in parallel. The `par_merge_load_order` function also parallelizes across plugins.

8. **Filter indexing**: Filter indices are stored as ASCII chars internally (`b'0'` through `b'5'`), but the library converts them to `u8` (0-5) on load and back on save.

9. **Plugin sort order**: When saving, objects follow a specific tag order defined in `sort_objects.rs`. Journals must come before other dialogue types.

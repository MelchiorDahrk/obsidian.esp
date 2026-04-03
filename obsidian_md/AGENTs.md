# Project Overview: obsidian_md

**Goal:** A Rust application that allows The Elder Scrolls III: Morrowind quests and dialogue to be authored in Markdown and exported directly to native TES3 Plugin format (.esp/.esm).

## Architecture & Core Tools

This project sits on top of two essential Rust libraries (documented thoroughly in `.agents/skills/tes3-plugin-dev/SKILL.md`, which you should **always** read when doing deep implementation):

1. **`tes3` crate:** Provides low-level serialization/deserialization for TES3 plugins and provides the basic record structs (e.g. `Dialogue`, `DialogueInfo`, `Header`).
2. **`merge_to_master` crate:** Provides the higher-level `PluginData` struct. It parses raw plugins into indexed HashMaps (`objects`, `cells`, `dialogues`). We use this to build and merge load orders to understand the full game state.

## Current State & Entry Point

- **`src/main.rs`:** Currently acts as the entry point. It has routines to read the user's `openmw.cfg`, collect their active load order, map it out using the Virtual File System (`vfstool_lib`), and load the full `.esm` base into `PluginData`.
- Next steps for this project involve parsing markdown input and converting it into `DialogueGroup` structures to define new quests and entries.

## Crucial Implementation Details for Agents

When generating Rust code to manipulate TES3 quests and dialogue, you **MUST** adhere to the following rules:

1. **Info Ordering (The Linked List):** `DialogueInfo` records are evaluated top-to-bottom by the Morrowind engine. Inside `merge_to_master`, they are stored in a `DialogueGroup` and form a doubly-linked list via `prev_id` and `next_id`. Always use `group.insert_info(info)` when adding items and call `group.repair_links()` after making bulk modifications.
2. **Case Insensitivity:** Record IDs are largely case-insensitive. Specifically, the `Dialogues` map in `merge_to_master` uses **lowercase string keys**. Ensure your queries to `PluginData.dialogues` are lowercased.
3. **Journal Mechanics:** For Journal entries (`DialogueType2::Journal`), the `disposition` field inside `DialogueData` is repurposed by the game engine to represent the **journal index** (the quest stage number), not an actual disposition requirement.
4. **Text Limits:** The game engine supports a maximum of 512 characters for `DialogueInfo.text`.
5. **Filtering / Branches:** You can append up to 6 `Filter` structures on a `DialogueInfo` to restrict when it plays (e.g., specific journal stage, item count, level, etc.). 
6. **Result Scripts:** The `script_text` field on `DialogueInfo` can contain MWScript code that fires when the player clicks that dialogue choice (e.g., `Journal "my_quest" 20`).

## Workflow for Agents

- **Reference material:** Always consult `.agents/skills/tes3-plugin-dev/SKILL.md` for exact struct definitions (`FilterType`, `FilterFunction`, `DialogueData`, `QuestState`, etc.) when mapping Markdown AST features into plugin data.
- **Testing:** We have tests mapped in `main.rs`. Execute tests to ensure you aren't breaking the parser or merge logic.

**Remember:** We are not just transforming text. We are correctly interleaving new Markdown-authored logic into the complex doubly-linked list structures that the Morrowind dialogue engine requires.

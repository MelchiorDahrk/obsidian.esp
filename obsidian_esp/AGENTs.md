# Project Overview: obsidian_esp

**Goal:** A Rust application that allows The Elder Scrolls III: Morrowind quests and dialogue to be authored in Markdown and exported directly to native TES3 Plugin format (.esp/.esm).

## In-memory game database

The plugin supports loading a full ESP/ESM file into a `PluginData` held in WASM memory. The user loads it via the status bar button; once loaded it persists for the session.

**WASM side (`src/lib.rs`):** `GameDatabase` is a `#[wasm_bindgen]` struct wrapping `PluginData`. Add query methods to its `impl` block to expose data to TypeScript — keep heavy iteration on the Rust side and return only what JS needs.

**TS side (`obsidian_plugin/src/database/game-database.ts`):** `GameDatabase` holds the WASM handle. Add methods here that call into the WASM handle and return typed results to the rest of the plugin.

**Accessing the DB in the plugin:** The loaded database is at `plugin.db` (typed `GameDatabase | null`). Check for `null` before use — it is only set after the user picks a file.

## Parallel Master Loading
Large master files (Morrowind.esm, etc.) are loaded and parsed in parallel.

- **Workers:** `obsidian_plugin/src/database/worker.ts` is a Web Worker that initializes a WASM instance to parse a single plugin into records.
- **Coordination:** `obsidian_plugin/src/database/parallel-loader.ts` manages the worker pool and `Promise.all` logic.
- **WASM Side:** Use `GameDatabase::load_objects` (standalone) in workers, and `GameDatabase::loadWithPreparsedMasters` on the main thread to merge results.

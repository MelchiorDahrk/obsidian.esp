# System Architecture: `obsidian_esp`

This document provides a high-level overview of the `obsidian_esp` repository, its goals, system components, and data flows. It is intended for both human contributors and AI agents to quickly understand the project's design and responsibilities.

## 1. Project Goal

The primary goal of `obsidian_esp` is to provide a modern, text-based workflow for authoring **The Elder Scrolls III: Morrowind** quests and dialogue. By using Markdown as the source format, authors can leverage version control (Git), modern editors (Obsidian), and professional proofreading tools, while maintaining full compatibility with the native `.esp` and `.esm` plugin formats.

## 2. System Components

The project is divided into two main environments: the **Rust Core** and the **Obsidian Plugin**, connected via **WebAssembly (WASM)**.

### A. Rust Core (`src/`)
The engine of the application, responsible for all heavy lifting regarding TES3 data structures and file formats.

- **`lib.rs`**: The primary entry point for the WASM library. It exposes the `GameDatabase` struct and compilation functions to TypeScript.
- **`main.rs`**: A CLI wrapper for the core logic, allow the tool to be used outside of Obsidian (e.g., in CI/CD pipelines).
- **`parse/`**: Converts Markdown files into internal `ParsedMarkdown` structures using the `winnow` parser combinator library.
- **`compile/`**: Transforms parsed Markdown into valid TES3 records. 
    - `resolve.rs`: Handles merging with master plugins and ID resolution.
    - `validate.rs`: High-level validation of dialogue flow and integrity.
- **`export.rs`**: Handles the "Unpack" functionality—converting a binary TES3 plugin back into the Markdown directory structure.
- **`logging.rs`**: A unified logging system that redirects `tracing` output to the browser console (in WASM) or stdout (in CLI).
- **`src/lib.rs` / `load_objects`**: Lightweight record parsing used by workers to deserialize plugins in parallel.

### B. Obsidian Plugin (`obsidian_plugin/`)
The user interface and integration layer, built for the [Obsidian](https://obsidain.md) knowledge management app.

- **`src/main.ts`**: The plugin entry point. Manages UI integration (commands, context menus, status bar) and lifecycle.
- **`src/database/`**: Manages the WASM instance and provides a typed TypeScript interface to the `GameDatabase` held in WASM memory.
    - `worker.ts`: Background Web Worker that handles heavy WASM parsing off the main thread.
    - `parallel-loader.ts`: Coordinator that spawns and tracks workers for multi-master loading.
- **`src/ui/`**: Contains the Database Explorer and custom views.
- **`src/features/`**: High-level plugin features.
    - `database-manager.ts`: Orchestrates core operations (load, unpack, unload) and maintains database state.
    - `path-manager.ts`: Centralizes vault path resolution and Morrowind project structure.
- **`src/utils/`**: Shared utilities.
    - `vault-writer.ts`: Atomic batch file operations and folder management.
    - `progress-reporter.ts`: Unified interface for reporting long-running operation status to the UI.

## 3. Directory Structure

```text
.
├── src/                        # Rust Core Logic
│   ├── compile/                # Transformation logic (Markdown -> TES3)
│   ├── parse/                  # Parsing logic (Markdown -> Internal Repr)
│   ├── export.rs               # Export logic (TES3 -> Markdown)
│   ├── lib.rs                  # WASM Entry Point & GameDatabase
│   └── main.rs                 # CLI Entry Point
├── obsidian_plugin/            # Obsidian Plugin Source
│   ├── src/
│   │   ├── database/           # TS/WASM Bridge & DB Management
│   │   ├── ui/                 # View and component logic
│   │   ├── features/           # DatabaseManager and PathManager
│   │   └── utils/              # VaultWriter and ProgressReporter
│   └── pkg/                    # Compiled WASM artifacts (generated)
├── md_dialogue_spec.md         # Documentation for the Markdown format
└── ARCHITECTURE.md             # This document
```

## 4. Key Data Flows

### Loading the Database (Binary -> DB)
1. **Header Scan**: The plugin reads the header of the selected file to find required masters.
2. **Parallel Disk Read**: All masters are searched for and read from disk in parallel using `Promise.all`.
3. **Parallel Parse**: Each master is sent to a dedicated **Web Worker**. Each worker initializes a separate WASM instance and parses the records concurrently.
4. **Merge**: Worker results (parsed record arrays) are returned to the main thread and merged into a single `GameDatabase` using `loadWithPreparsedMasters` in the Rust core.
5. **UI Update**: The Database Explorer and status bar are updated once the merge is complete.

### Compilation (Markdown -> ESP)
1. **Read**: The Obsidian plugin reads Markdown files from the vault.
2. **Parse**: Files are passed to the Rust core, where `src/parse` uses `winnow` to extract frontmatter and body text.
3. **Compile**: `src/compile` converts these into `Dialogue` and `DialogueInfo` records.
4. **Export**: `tes3` crate serializes these records into a binary `.esp` file.

### Unpacking (ESP -> Markdown)
1. **Load**: User selects a `.esp` or `.esm` file.
2. **Load into DB**: The Rust core parses the binary file into a `PluginData` structure in WASM memory.
3. **Generate Markdown**: `src/export.rs` iterates over the records and generates Markdown strings according to the [Dialogue Specification](file:///c:/Users/Admin/Projects/obsidian.esp/obsidian_esp/md_dialogue_spec.md).
4. **Filter Changes**: The Rust core identifies "link-only changes"—dialogue responses where ONLY the `PrevID` or `NextID` changed due to insertions elsewhere in the chain. These are often filtered out to prevent excessive vault updates.
5. **Write**: The Obsidian plugin writes these files to the vault.

### Game Database
- The **`GameDatabase`** struct in `src/lib.rs` holds the state of loaded plugins.
- It is persistent across the Obsidian session once loaded.
- TypeScript queries this database for autocomplete, property validation, and the Database Explorer view.

## 5. Technology Stack

- **Rust**:
    - `tes3`: Native library for reading/writing Morrowind files.
    - `winnow`: Modern, fast parser combinators.
    - `wasm-bindgen`: Creating the JS/Rust bridge.
    - `merge_to_master`: Internal library for handling load-order merging.
- **TypeScript**:
    - `obsidian`: The Obsidian API.
    - `pkg/`: Generated by `wasm-pack` to provide the WASM interface.
- **Build System**:
    - `wasm-pack`: For building the Rust core.
    - `esbuild`: For bundling the TypeScript plugin. Configured with multiple entry points (`main.ts`, `worker.ts`).
    - `build-and-package.bat`: Orchestrates the full build process, WASM patching, and release packaging.

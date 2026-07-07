# obsidian_esp

Author **The Elder Scrolls III: Morrowind** quests and dialogue in Markdown, and
compile them straight to native TES3 plugin files (`.esp` / `.esm`).

A Markdown-first workflow means quest writing gets everything text gets: Git
version control, real editors, proofreading tools, and readable diffs — while
still producing files the Morrowind engine (and OpenMW) load natively.

The project has two halves that share one code path:

- A **Rust core** (`src/`) that parses Markdown, compiles it to TES3 records,
  merges against master files, and unpacks plugins back into Markdown. It builds
  both as a native CLI and as WebAssembly.
- An **Obsidian plugin** (`obsidian_plugin/`) that hosts the WASM core and adds
  the UI: a folder-compile command, plugin unpacking, an in-memory game
  database, property autocomplete, and an interactive **quest canvas** that
  visualizes and edits dialogue as a flowchart.

## Repository layout

```text
.
├── src/                          # Rust core (native CLI + WASM library)
│   ├── lib.rs                    # WASM API surface + GameDatabase
│   ├── main.rs                   # Native scratch binary
│   ├── parse/                    # Markdown → ParsedPlugin (winnow parsers)
│   ├── compile/                  # ParsedPlugin → TES3 records
│   │   ├── mod.rs                #   lowering to Dialogue/DialogueInfo
│   │   ├── validate.rs           #   reference checks against masters
│   │   └── resolve.rs            #   master merge + diff (semantic vs link-only)
│   ├── export.rs                 # TES3 records → Markdown (the reverse trip)
│   └── logging.rs                # tracing setup (stdout native / console WASM)
│
├── obsidian_plugin/              # Obsidian plugin (TypeScript)
│   └── src/
│       ├── main.ts               # Plugin entry point
│       ├── settings.ts           # Settings tab + defaults
│       ├── database/             # WASM bridge, worker pool, header sniffing
│       ├── features/             # Compile, unpack, property gen, topic links…
│       │   └── quest-canvas/     # Quest canvas: discovery → layout → sync
│       ├── ui/                   # Modals, database explorer, virtual table
│       └── utils/                # Frontmatter helpers, vault writer, progress
│
├── tests/                        # Rust integration tests + fixtures
├── scripts/                      # Build helpers (WASM loader patch, harness)
├── build-and-package.bat         # Full build + release packaging (Windows)
└── *.md                          # Design docs (indexed below)
```

## How it fits together

```text
Markdown files ──parse──▶ ParsedPlugin ──compile──▶ PluginData ──resolve──▶ .esp bytes
                                                          ▲
                                        master plugins ───┘  (merge + diff)

.esp / .esm ────────────────load───────────────────▶ GameDatabase ──export──▶ Markdown files
```

- **Compile** and **unpack** are inverses: a project unpacked from a plugin
  re-compiles to the same records. The `format_*` helpers in `src/export.rs`
  mirror the grammar accepted by `src/parse/` exactly — change them together.
- **Master resolution** merges the authored plugin over its masters and diffs
  the result, so only genuinely modified records ship. Changes that only moved a
  record's prev/next link pointers are classified as "link-only" and dropped.
- The **GameDatabase** is the in-memory merged view the plugin queries; large
  masters are parsed in parallel across a pool of Web Workers before merging.

For the full component breakdown and data-flow diagrams, see
[ARCHITECTURE.md](ARCHITECTURE.md).

## Building

Prerequisites: [Rust](https://rustup.rs/) with the `wasm32-unknown-unknown`
target, [`wasm-pack`](https://rustwasm.github.io/wasm-pack/), and
[Node.js](https://nodejs.org/) (npm).

### One-shot (Windows)

`build-and-package.bat` runs the whole pipeline — builds the WASM package,
patches the generated loader, installs npm dependencies, runs the production
plugin build, and produces a distributable zip under `obsidian_plugin/release/`.

### Manual

```sh
# 1. Build the Rust core to WASM, output into the plugin folder.
wasm-pack build --release --target web --out-dir obsidian_plugin/pkg
node scripts/patch-wasm-loader.cjs

# 2. Build the Obsidian plugin (type-check + bundle).
cd obsidian_plugin
npm install
npm run build          # → main.js, worker.js
```

Copy `manifest.json`, `main.js`, `worker.js`, `styles.css`, and the `pkg/`
folder into your vault's `.obsidian/plugins/obsidian-esp/` directory to install.

### Rust-only checks

```sh
cargo check            # type-check the core
cargo test             # run the integration tests in tests/
```

## Documentation

| Document | What it covers |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | High-level system overview, components, and data flows. |
| [md_dialogue_spec.md](md_dialogue_spec.md) | The Markdown dialogue format — the grammar compile and unpack round-trip through. |
| [canvas_editing.md](canvas_editing.md) | User guide to editing dialogue on a quest canvas. |
| [canvas_editing_internals.md](canvas_editing_internals.md) | How the canvas↔note sync engine and node actions are built. |
| [canvas_generation_framework.md](canvas_generation_framework.md) | How a quest canvas is procedurally generated and laid out. |
| [CLAUDE.md](CLAUDE.md) / [AGENTs.md](AGENTs.md) | Orientation notes for AI agents working in this repo. |

Source-level documentation lives inline: every Rust module has a `//!` header
and rustdoc on its items; every TypeScript module has a `@file` header and
TSDoc on exported functions and types.

## License

The Obsidian plugin is licensed 0-BSD (see `obsidian_plugin/package.json`).

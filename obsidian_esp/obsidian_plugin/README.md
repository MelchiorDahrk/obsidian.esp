# ESP

An Obsidian plugin for unpacking TES3 plugin files (.ESP/.ESM) into structured markdown.

## Usage

1. Click the file-input icon in the ribbon, or use the command palette: **Unpack TES3 plugin file**
2. Select an `.ESP` or `.ESM` file from the file picker
3. The plugin data is unpacked into markdown files under a configurable output folder (default: `TES3 Plugins/`)

## Settings

- **Output folder** — The vault folder where unpacked files are written.

## Building

```bash
# Build the WASM library first (from the repo root)
wasm-pack build --release --target web --out-dir obsidian_plugin/pkg

# Then build the plugin
cd obsidian_plugin
npm install
npm run build
```

## Development

```bash
npm run dev
```

## Installing

Copy these files to your vault at `VaultFolder/.obsidian/plugins/esp/`:

- `main.js`
- `styles.css`
- `manifest.json`
- `pkg/obsidian_esp_bg.wasm`

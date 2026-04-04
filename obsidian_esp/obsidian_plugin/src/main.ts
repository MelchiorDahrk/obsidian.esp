import { Notice, Plugin, TFolder, normalizePath } from 'obsidian';
import { initSync, unpack_plugin } from '../pkg/obsidian_esp.js';
import { DEFAULT_SETTINGS, ObsidianEspSettings, ObsidianEspSettingTab } from './settings';

export default class ObsidianEsp extends Plugin {
	settings: ObsidianEspSettings;
	wasmReady = false;

	async onload() {
		await this.loadSettings();

		await this.initWasm();

		this.addRibbonIcon('file-input', 'Unpack TES3 plugin', () => {
			this.promptForFile();
		});

		this.addCommand({
			id: 'unpack',
			name: 'Unpack TES3 plugin file',
			callback: () => {
				this.promptForFile();
			},
		});

		this.addSettingTab(new ObsidianEspSettingTab(this.app, this));
	}

	async initWasm() {
		const wasmPath = normalizePath(
			`${this.manifest.dir}/pkg/obsidian_esp_bg.wasm`,
		);
		const wasmBuffer = await this.app.vault.adapter.readBinary(wasmPath);
		initSync({ module: new Uint8Array(wasmBuffer) });
		this.wasmReady = true;
	}

	promptForFile() {
		if (!this.wasmReady) {
			new Notice('WASM module is not ready yet.');
			return;
		}

		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.esp,.esm,.ESP,.ESM';

		input.addEventListener('change', async () => {
			const file = input.files?.[0];
			if (!file) return;

			try {
				await this.unpackFile(file);
			} catch (e) {
				const message =
					e instanceof Error ? e.message : String(e);
				new Notice(`Failed to unpack: ${message}`);
			}
		});

		input.click();
	}

	async unpackFile(file: File) {
		const buffer = await file.arrayBuffer();
		const bytes = new Uint8Array(buffer);

		const files: [string, string][] = unpack_plugin(bytes);

		const baseName = file.name.replace(/\.[^.]+$/, '');
		const outputDir = normalizePath(
			`${this.settings.outputFolder}/${baseName}`,
		);

		let created = 0;
		for (const [relativePath, content] of files) {
			const fullPath = normalizePath(`${outputDir}/${relativePath}`);

			const parentDir = fullPath.substring(
				0,
				fullPath.lastIndexOf('/'),
			);
			if (parentDir) {
				await this.ensureFolder(parentDir);
			}

			await this.app.vault.create(fullPath, content);
			created++;
		}

		new Notice(`Unpacked ${created} files to ${outputDir}`);
	}

	async ensureFolder(path: string) {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return;
		if (existing) return;
		await this.app.vault.createFolder(path);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ObsidianEspSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

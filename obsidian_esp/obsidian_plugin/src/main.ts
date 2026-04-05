import { Notice, Plugin, TFolder, normalizePath } from 'obsidian';
import { initSync, unpack_plugin } from '../pkg/obsidian_esp.js';
import {
	compileFolderSelection,
	compileVaultFolder,
} from './features/compile-folder';
import { generatePropertyFilesForFolder } from './features/generate-properties';
import {
	DEFAULT_SETTINGS,
	ObsidianEspSettings,
	ObsidianEspSettingTab,
} from './settings';

export default class ObsidianEsp extends Plugin {
	settings: ObsidianEspSettings;
	wasmReady = false;

	async onload() {
		await this.loadSettings();
		await this.initWasm();

		this.addRibbonIcon('file-input', 'Unpack plugin file', () => {
			this.promptForFile();
		});

		this.addCommand({
			id: 'unpack',
			name: 'Unpack plugin file',
			callback: () => {
				this.promptForFile();
			},
		});

		this.addCommand({
			id: 'compile-folder',
			name: 'Compile dialogue folder',
			callback: () => {
				void this.compileFolder();
			},
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFolder)) {
					return;
				}

				menu.addItem((item) => {
					item
						.setTitle('Compile dialogue folder')
						.setIcon('folder')
						.onClick(() => {
							void this.compileSelectedFolder(file);
						});
				});

				menu.addItem((item) => {
					item
						.setTitle('Generate property files')
						.setIcon('list-filter')
						.onClick(() => {
							void this.generatePropertyFiles(file);
						});
				});
			}),
		);

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
			new Notice('Wasm module is not ready yet.');
			return;
		}

		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.esp,.esm,.ESP,.ESM';
		input.addEventListener('change', () => {
			void this.handleSelectedFile(input);
		});
		input.click();
	}

	async handleSelectedFile(input: HTMLInputElement) {
		const file = input.files?.[0];
		if (!file) {
			return;
		}

		try {
			await this.unpackFile(file);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			new Notice(`Failed to unpack: ${message}`);
		}
	}

	async unpackFile(file: File) {
		const buffer = await file.arrayBuffer();
		const bytes = new Uint8Array(buffer);
		const unpackedFiles = unpack_plugin(bytes) as unknown;

		if (!Array.isArray(unpackedFiles)) {
			throw new Error('Unexpected unpacked plugin output.');
		}

		const files = unpackedFiles as [string, string][];
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

	async compileFolder() {
		if (!this.wasmReady) {
			new Notice('Wasm module is not ready yet.');
			return;
		}

		await compileVaultFolder(this.app);
	}

	async compileSelectedFolder(folder: TFolder) {
		if (!this.wasmReady) {
			new Notice('Wasm module is not ready yet.');
			return;
		}

		await compileFolderSelection(this.app, folder);
	}

	async generatePropertyFiles(folder: TFolder) {
		if (!this.wasmReady) {
			new Notice('Wasm module is not ready yet.');
			return;
		}

		await generatePropertyFilesForFolder(this.app, folder);
	}

	async ensureFolder(path: string) {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) {
			return;
		}

		if (existing) {
			return;
		}

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

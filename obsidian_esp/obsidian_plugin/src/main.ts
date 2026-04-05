import { Menu, Notice, Plugin, TFolder, normalizePath } from 'obsidian';
import { initSync } from '../pkg/obsidian_esp.js';
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
import { updateTopicLinksForFolder } from './features/topic-linker';
import {
	registerMultilinkHandlers,
	multilinkEditorExtension,
} from './features/multilink-handler';
import { addMasterToHeaderContent } from './features/master-files';
import { GameDatabase } from './database/game-database';
import { DATABASE_VIEW_TYPE, DatabaseView } from './ui/database-view';

export default class ObsidianEsp extends Plugin {
	settings: ObsidianEspSettings;
	wasmReady = false;
	private db: GameDatabase | null = null;
	private statusBarItem: HTMLElement;

	async onload() {
		await this.loadSettings();
		await this.initWasm();

		this.registerView(
			DATABASE_VIEW_TYPE,
			(leaf) => new DatabaseView(leaf),
		);

		this.statusBarItem = this.addStatusBarItem();
		this.renderStatusBar();

		this.addCommand({
			id: 'unpack',
			name: 'Unpack loaded database',
			callback: () => {
				void this.unpackDatabase();
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

				menu.addItem((item) => {
					item
						.setTitle('Update topic links')
						.setIcon('link')
						.onClick(() => {
							void this.updateTopicLinks(file);
						});
				});
			}),
		);

		registerMultilinkHandlers(this);
		this.registerEditorExtension([multilinkEditorExtension]);

		this.addSettingTab(new ObsidianEspSettingTab(this.app, this));
	}

	onunload() {
		this.db?.free();
		this.db = null;
	}

	private renderStatusBar() {
		this.statusBarItem.empty();

		if (this.db === null) {
			const btn = this.statusBarItem.createEl('button', {
				text: 'Load database',
				cls: 'esp-db-status-btn',
				attr: {
					'aria-label': 'Load a game database file (ESP/ESM)',
					'data-tooltip-position': 'top',
				},
			});
			btn.addEventListener('click', () => this.promptForDatabase());
		} else {
			const { fileName, objectCount } = this.db.info;
			const btn = this.statusBarItem.createEl('button', {
				text: `${fileName} (${objectCount.toLocaleString()} records)`,
				cls: 'esp-db-status-btn',
				attr: {
					'aria-label': 'Database options',
					'data-tooltip-position': 'top',
				},
			});
			btn.addEventListener('click', (e) =>
				this.showDatabaseMenu(e),
			);
		}
	}

	private showDatabaseMenu(e: MouseEvent) {
		const menu = new Menu();

		menu.addItem((item) => {
			item.setTitle('View data')
				.setIcon('table')
				.onClick(() => {
					void this.openDatabaseView();
				});
		});

		menu.addItem((item) => {
			item.setTitle('Unpack database')
				.setIcon('file-input')
				.onClick(() => {
					void this.unpackDatabase();
				});
		});

		menu.addSeparator();

		menu.addItem((item) => {
			item.setTitle('Load different database')
				.setIcon('folder-open')
				.onClick(() => this.promptForDatabase());
		});

		menu.addItem((item) => {
			item.setTitle('Unload database')
				.setIcon('x')
				.onClick(() => {
					this.db?.free();
					this.db = null;
					this.renderStatusBar();
				});
		});

		menu.showAtMouseEvent(e);
	}

	private async openDatabaseView() {
		if (!this.db) return;

		// Reuse an existing database view leaf if one is already open.
		const existing = this.app.workspace.getLeavesOfType(DATABASE_VIEW_TYPE);
		const leaf = existing[0] ?? this.app.workspace.getLeaf('tab');

		await leaf.setViewState({ type: DATABASE_VIEW_TYPE, active: true });

		const view = leaf.view as DatabaseView;
		view.setDatabase(this.db);
		await view.onOpen();
		this.app.workspace.revealLeaf(leaf);
	}

	private promptForDatabase() {
		if (!this.wasmReady) {
			new Notice('WASM module is not ready yet.');
			return;
		}

		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.esp,.esm,.ESP,.ESM';
		input.addEventListener('change', () => {
			void this.loadDatabase(input);
		});
		input.click();
	}

	private async loadDatabase(input: HTMLInputElement) {
		const file = input.files?.[0];
		if (!file) {
			return;
		}

		this.db?.free();
		this.db = null;
		this.statusBarItem.empty();
		this.statusBarItem.createEl('span', { text: 'Loading database...' });

		try {
			const buffer = await file.arrayBuffer();
			const bytes = new Uint8Array(buffer);
			this.db = GameDatabase.load(bytes, file.name);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to load database: ${message}`);
		}

		this.renderStatusBar();
	}

	async initWasm() {
		const wasmPath = normalizePath(
			`${this.manifest.dir}/pkg/obsidian_esp_bg.wasm`,
		);
		const wasmBuffer = await this.app.vault.adapter.readBinary(wasmPath);
		initSync({ module: new Uint8Array(wasmBuffer) });
		this.wasmReady = true;
	}

	async unpackDatabase() {
		if (!this.db) {
			new Notice('No database loaded.');
			return;
		}

		try {
			const files = this.db.unpack();
			const fileName = this.db.info.fileName;

			// Add the plugin itself as a master in header.md
			const headerEntry = files.find(([path]) => path === 'header.md');
			if (headerEntry) {
				headerEntry[1] = addMasterToHeaderContent(
					headerEntry[1],
					fileName,
				);
			}

			const baseName = fileName.replace(/\.[^.]+$/, '');
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

				// Check if file exists to avoid overwrite error if needed,
				// or just use create and catch error.
				try {
					await this.app.vault.create(fullPath, content);
					created++;
				} catch (e) {
					// Likely file already exists
					console.warn(`Could not create ${fullPath}: ${e}`);
				}
			}

			new Notice(`Unpacked ${created} files to ${outputDir}`);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			new Notice(`Failed to unpack: ${message}`);
		}
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

	async updateTopicLinks(folder: TFolder) {
		await updateTopicLinksForFolder(this.app, folder);
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

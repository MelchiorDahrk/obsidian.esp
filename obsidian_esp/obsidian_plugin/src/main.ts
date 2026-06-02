import { FileView, Menu, Notice, Plugin, TFolder, normalizePath } from 'obsidian';
import { initSync } from '../pkg/obsidian_esp.js';
import {
	compileFolderSelection,
	compileVaultFolder,
} from './features/compile-folder';
import {
	canGenerateQuestCanvasFromFolder,
	generateQuestCanvasDebugFromVaultFolder,
	generateQuestCanvasForFolder,
	generateQuestCanvasFromVaultFolder,
} from './features/generate-quest-canvas';
import { generatePropertyFilesForFolder } from './features/generate-properties';
import {
	DEFAULT_SETTINGS,
	ObsidianEspSettings,
	ObsidianEspSettingTab,
} from './settings';
import { DATABASE_VIEW_TYPE, DatabaseView } from './ui/database-view';
import { DatabaseManager } from './features/database-manager';

declare module 'obsidian' {
	interface MenuItem {
		setSubmenu(): Menu;
	}
}

/**
 * Main Obsidian plugin class for Obsidian.esp.
 */
export default class ObsidianEsp extends Plugin {
	settings: ObsidianEspSettings;
	wasmReady = false;
	private statusBarItem: HTMLElement;
	private dbManager: DatabaseManager;

	/**
	 * Initializes the plugin, registers views, adds commands, and sets up settings.
	 */
	async onload() {
		await this.loadSettings();
		await this.initWasm();

		// Initialize DatabaseManager to handle core logic
		this.dbManager = new DatabaseManager(
			this.app,
			this.manifest.dir || '',
			this.settings.outputFolder,
			() => this.renderStatusBar(), // Refresh UI when DB state changes
		);

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
				void this.dbManager.unpackDatabase();
			},
		});

		this.addCommand({
			id: 'compile-folder',
			name: 'Compile dialogue folder',
			callback: () => {
				void this.compileFolder();
			},
		});

		this.addCommand({
			id: 'generate-quest-canvas',
			name: 'Generate quest canvas',
			callback: () => {
				void this.generateQuestCanvas();
			},
		});

		this.addCommand({
			id: 'generate-quest-canvas-debug',
			name: 'Generate quest canvas with debug summary',
			callback: () => {
				void this.generateQuestCanvasDebug();
			},
		});

		// Vault Context Menu Integration
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFolder)) {
					return;
				}

				menu.addItem((item) => {
					item.setTitle('Obsidian.esp Commands').setIcon('folder');
					const submenu = item.setSubmenu();

					submenu.addItem((subItem) => {
						subItem
							.setTitle('Compile dialogue folder')
							.setIcon('folder')
							.onClick(() => {
								void this.compileSelectedFolder(file);
							});
					});

					if (canGenerateQuestCanvasFromFolder(file)) {
						submenu.addItem((subItem) => {
							subItem
								.setTitle('Generate quest canvas')
								.setIcon('layout-dashboard')
								.onClick(() => {
									void this.generateQuestCanvasForSelectedFolder(file);
								});
						});

						submenu.addItem((subItem) => {
							subItem
								.setTitle('Generate quest canvas with debug summary')
								.setIcon('bug')
								.onClick(() => {
									void this.generateQuestCanvasDebugForSelectedFolder(file);
								});
						});
					}

					submenu.addItem((subItem) => {
						subItem
							.setTitle('Generate property files')
							.setIcon('list-filter')
							.onClick(() => {
								void this.generatePropertyFiles(file);
							});
					});

					submenu.addItem((subItem) => {
						subItem
							.setTitle('Update topic links')
							.setIcon('link')
							.onClick(() => {
								void this.dbManager.updateTopicLinks(file);
							});
					});

					submenu.addItem((subItem) => {
						subItem
							.setTitle('Clean incidental dialogue edits')
							.setIcon('trash')
							.onClick(() => {
								void this.dbManager.cleanIncidentalEdits(file);
							});
					});
				});
			}),
		);

		this.registerEvent(
			this.app.workspace.on('file-open', async (file) => {
				const view = this.app.workspace.getActiveViewOfType(FileView);
				if (!view || !file) return;

				let isTopicBase = false;
				if (file.extension === 'base') {
					isTopicBase = true;
				} else if (file.extension === 'md') {
					// Check for topic base embed pattern
					const content = await this.app.vault.cachedRead(file);
					if (content.includes('base.base#')) {
						isTopicBase = true;
					}
				}

				if (isTopicBase) {
					view.containerEl.addClass('esp-topic-base-view');
				} else {
					view.containerEl.removeClass('esp-topic-base-view');
				}
			}),
		);

		this.addSettingTab(new ObsidianEspSettingTab(this.app, this));
	}

	/**
	 * Cleans up resources when the plugin is disabled.
	 */
	onunload() {
		void this.dbManager.unloadDatabase();
	}

	/**
	 * Updates the status bar button based on whether a database is currently loaded.
	 */
	private renderStatusBar() {
		this.statusBarItem.empty();
		const db = this.dbManager.database;

		if (db === null) {
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
			const { fileName, objectCount, isMerged } = db.info;
			const mergedTag = isMerged ? ', merged' : '';
			const btn = this.statusBarItem.createEl('button', {
				text: `${fileName} (${objectCount.toLocaleString()} records${mergedTag})`,
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

	/**
	 * Shows a context menu with database-related actions when the status bar button is clicked.
	 */
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
					void this.dbManager.unpackDatabase();
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
					void this.dbManager.unloadDatabase();
				});
		});

		menu.showAtMouseEvent(e);
	}

	/**
	 * Opens or reveals the Database Explorer view.
	 */
	private async openDatabaseView() {
		const db = this.dbManager.database;
		if (!db) return;

		// Reuse an existing database view leaf if one is already open.
		const existing = this.app.workspace.getLeavesOfType(DATABASE_VIEW_TYPE);
		const leaf = existing[0] ?? this.app.workspace.getLeaf('tab');

		await leaf.setViewState({ type: DATABASE_VIEW_TYPE, active: true });

		const view = leaf.view as DatabaseView;
		view.setDatabase(db);
		await view.onOpen();
		this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Opens a native file picker to select an ESP/ESM file.
	 */
	private promptForDatabase() {
		if (!this.wasmReady) {
			new Notice('WASM module is not ready yet.');
			return;
		}

		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.esp,.esm,.ESP,.ESM';
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (file) {
				void this.dbManager.loadDatabase(file).then(() => {
					this.dbManager.registerLazyLoader(this);
				});
			}
		});
		input.click();
	}

	/**
	 * Synchronously initializes the WASM module using the binary stored in the plugin folder.
	 */
	async initWasm() {
		try {
			const wasmPath = normalizePath(
				`${this.manifest.dir}/pkg/obsidian_esp_bg.wasm`,
			);
			const wasmBuffer = await this.app.vault.adapter.readBinary(wasmPath);
			initSync(wasmBuffer);
			this.wasmReady = true;
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			console.error(`[Obsidian ESP] Failed to initialize WASM: ${errorMsg}`, e);
			new Notice(`Obsidian ESP: Failed to initialize WASM. Check console for details. Error: ${errorMsg}`, 0);
		}
	}

	/**
	 * Prompts the user to select a folder from the vault and compiles it into an ESP file.
	 */
	async compileFolder() {
		if (!this.wasmReady) {
			new Notice('Wasm module is not ready yet.');
			return;
		}

		await compileVaultFolder(this.app);
	}

	/**
	 * Compiles the specified folder into an ESP file.
	 */
	async compileSelectedFolder(folder: TFolder) {
		if (!this.wasmReady) {
			new Notice('Wasm module is not ready yet.');
			return;
		}

		await compileFolderSelection(this.app, folder);
	}

	/**
	 * Prompts the user to select a journal folder and generates a quest canvas.
	 */
	async generateQuestCanvas() {
		await generateQuestCanvasFromVaultFolder(this.app);
	}

	/**
	 * Prompts the user to select a journal folder and generates a quest canvas with a phase graph summary.
	 */
	async generateQuestCanvasDebug() {
		await generateQuestCanvasDebugFromVaultFolder(this.app);
	}

	/**
	 * Generates a quest canvas for the selected journal folder.
	 */
	async generateQuestCanvasForSelectedFolder(folder: TFolder) {
		await generateQuestCanvasForFolder(this.app, folder);
	}

	/**
	 * Generates a quest canvas and phase graph summary for the selected journal folder.
	 */
	async generateQuestCanvasDebugForSelectedFolder(folder: TFolder) {
		await generateQuestCanvasForFolder(this.app, folder, { writePhaseGraphDebug: true });
	}

	/**
	 * Generates property definition files for the specified folder based on the loaded database.
	 */
	async generatePropertyFiles(folder: TFolder) {
		if (!this.wasmReady) {
			new Notice('Wasm module is not ready yet.');
			return;
		}

		await generatePropertyFilesForFolder(this.app, folder);
	}

	/**
	 * Loads plugin settings from the disk.
	 */
	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ObsidianEspSettings>,
		);
	}

	/**
	 * Saves plugin settings to the disk.
	 */
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

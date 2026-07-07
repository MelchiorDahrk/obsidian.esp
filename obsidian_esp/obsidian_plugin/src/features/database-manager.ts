/**
 * @file Session-level owner of the loaded game database.
 *
 * `DatabaseManager` is the single access point to the active
 * {@link GameDatabase} (`plugin.dbManager.database`) and implements the
 * database-centric user actions: load/unload, unpack to Markdown, topic-link
 * refresh, and incidental-edit cleanup. It keeps UI concerns out of the main
 * plugin class — callers get Notices and progress bars, `main.ts` only
 * re-renders the status bar via the `onUpdate` callback.
 */
import { App, Notice, TFile, TFolder } from 'obsidian';
import { GameDatabase } from '../database/game-database';
import { DatabaseLoader } from '../database/database-loader';
import { LazyLoader } from './lazy-loader';
import { PathManager } from './path-manager';
import { TopicLinker } from './topic-linker';
import { VaultWriter } from '../utils/vault-writer';
import { ProgressReporter } from '../utils/progress-reporter';
import { addMasterToHeaderContent } from './master-files';
import { ProgressBar } from '../ui/progress-bar';

/**
 * Handles core database operations like loading, unloading, and unpacking.
 * Decouples business logic from the main plugin class and UI.
 */
export class DatabaseManager {
	private db: GameDatabase | null = null;
	private lazyLoader: LazyLoader | null = null;
	private loader: DatabaseLoader;
	private pathManager: PathManager;
	private vaultWriter: VaultWriter;

	constructor(
		private app: App,
		private manifestDir: string,
		private outputFolder: string,
		private onUpdate: () => void,
	) {
		this.loader = new DatabaseLoader(app, manifestDir);
		this.pathManager = new PathManager(outputFolder);
		this.vaultWriter = new VaultWriter(app);
	}

	/** The active database, or `null` until the user loads a file. */
	get database(): GameDatabase | null {
		return this.db;
	}

	/**
	 * Loads a database file and initializes related services (lazy loader).
	 * Any previously loaded database is freed first. If the plugin's output
	 * folder already contains an unpacked project for this file, topic links
	 * are refreshed against the new database automatically.
	 */
	async loadDatabase(file: File): Promise<void> {
		await this.unloadDatabase();

		try {
			const { db, messages } = await this.loader.load(file);
			this.db = db;

			for (const msg of messages) {
				new Notice(msg);
			}

			if (this.db) {
				this.lazyLoader = await LazyLoader.create(
					this.db,
					this.outputFolder,
					this.app,
				);
				// plugin registration remains in main.ts for context
			}

			// Auto-update links if folder exists
			const folderPath = this.pathManager.getPluginDir(file.name);
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (folder instanceof TFolder) {
				await this.updateTopicLinks(folder, true);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to load database: ${message}`);
			throw error;
		} finally {
			this.onUpdate();
		}
	}

	/**
	 * Unpacks the current database into the vault as Markdown project files.
	 *
	 * Merged databases only export plugin-owned (modified) dialogue; a
	 * standalone database exports everything. The unpacked plugin itself is
	 * appended to the exported header's master list so the project can be
	 * recompiled against it, and topic links are generated afterwards.
	 */
	async unpackDatabase(): Promise<void> {
		if (!this.db) {
			new Notice('No database loaded.');
			return;
		}

			const progress = new ProgressBar(`Unpacking ${this.db.info.fileName}`);
		try {
			const rawFiles = this.db.info.isMerged
				? await this.db.unpackModified()
				: await this.db.unpack();
			
			const fileName = this.db.info.fileName;

			// Inject plugin into header
			const headerEntry = rawFiles.find(([path]) => path === 'header.md');
			if (headerEntry) {
				headerEntry[1] = addMasterToHeaderContent(headerEntry[1], fileName);
			}

			// Resolve paths and write
			const resolvedFiles = this.pathManager.resolveAbsolutePaths(fileName, rawFiles);
			const createdCount = await this.vaultWriter.writeFiles(resolvedFiles, progress);

			new Notice(`Unpacked ${createdCount} files.`);

			// Run topic linker
			const outputDir = this.pathManager.getPluginDir(fileName);
			const folder = this.app.vault.getAbstractFileByPath(outputDir);
			if (folder instanceof TFolder) {
				await this.updateTopicLinks(folder, false, progress);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to unpack: ${message}`);
		} finally {
			progress.update(100, 'Done');
			try {
				progress.hide();
			} catch {
				// best-effort: ignore hide failures
			}
			this.onUpdate();
		}
	}

	/**
	 * Rewrites `[[wiki-links]]` over topic-name mentions in a folder's
	 * dialogue files (see {@link TopicLinker}). Topic names come from the
	 * loaded database when available; otherwise the linker falls back to the
	 * topics present in the folder itself.
	 *
	 * @param silent Suppress the completion Notice (used during auto-refresh).
	 * @param reporter Optional progress sink when running inside a larger job.
	 */
	async updateTopicLinks(folder: TFolder, silent = false, reporter?: ProgressReporter): Promise<void> {
		const allTopicNames = this.db ? await this.db.getAllTopicNames() : undefined;
		const linker = new TopicLinker(this.app);
		
		await linker.updateTopicLinks(folder, allTopicNames, (p) => {
			if (reporter) {
				const pct = Math.round((p.current / p.total) * 100);
				reporter.update(pct, p.message);
			}
		});
		
		if (!silent) {
			new Notice(`Updated topic links in ${folder.name}`);
		}
	}

	/**
	 * Cleans incidental dialogue edits from a folder based on current database.
	 * 
	 * "Incidental" edits are vault files that are functionally identical to the
	 * master database. This includes records that were only "modified" because
	 * their link pointers (prev/next) were updated during a merge to accommodate
	 * new neighboring records. Since the engine/merger derives these links
	 * automatically at runtime, unedited master records are redundant.
	 *
	 * Identified files are moved to the system trash (recoverable), and any
	 * topic folders left empty are trashed too — except the project root.
	 */
	async cleanIncidentalEdits(folder: TFolder): Promise<void> {
		if (!this.db) {
			new Notice('No database loaded. Please load a database first to compare against.');
			return;
		}

		const progress = new ProgressBar(`Cleaning incidental edits in ${folder.name}`);
		try {
			const projectRoot = PathManager.findPluginRoot(folder);
			if (!projectRoot) {
				new Notice('Could not find a valid obsidian.esp project root (missing header.md).');
				return;
			}

			const files: [string, string][] = [];
			const pathToVaultPath = new Map<string, string>();

			const readVaultRecursive = async (parent: TFolder) => {
				for (const child of parent.children) {
					if (child instanceof TFolder) {
						await readVaultRecursive(child);
					} else if (child instanceof TFile && child.extension === 'md') {
						const content = await this.app.vault.read(child);
						const relativePath = child.path.substring(projectRoot.path.length + 1);
						files.push([relativePath, content]);
						pathToVaultPath.set(relativePath, child.path);
					}
				}
			};
			await readVaultRecursive(folder);

			if (files.length === 0) {
				new Notice('No markdown files found in the selected folder.');
				return;
			}

			progress.update(50, 'Analyzing dialogue edits...');
			const incidentalRelativePaths = await this.db.findIncidentalEdits(files);

			if (incidentalRelativePaths.length === 0) {
				new Notice('No incidental dialogue edits found.');
				return;
			}

			progress.update(80, `Removing ${incidentalRelativePaths.length} files...`);
			
			let removedCount = 0;
			for (const relPath of incidentalRelativePaths) {
				const vaultPath = pathToVaultPath.get(relPath);
				if (!vaultPath) continue;

				const f = this.app.vault.getAbstractFileByPath(vaultPath);
				if (f) {
					await this.app.vault.trash(f, true); // System trash
					removedCount++;
				}
			}

			// Clean up any descendant folders that became empty after file removal.
			// We preserve the project root itself, but topic folders selected directly
			// should still be removed if they are now empty.
			const cleanEmptyFolders = async (parent: TFolder): Promise<void> => {
				const childFolders = [...parent.children].filter(
					(child): child is TFolder => child instanceof TFolder,
				);
				for (const childFolder of childFolders) {
					await cleanEmptyFolders(childFolder);
				}

				const refreshed = this.app.vault.getAbstractFileByPath(parent.path);
				if (!(refreshed instanceof TFolder)) {
					return;
				}

				if (refreshed.path === projectRoot.path) {
					return;
				}

				if (refreshed.children.length === 0) {
					await this.app.vault.trash(refreshed, true);
				}
			};
			await cleanEmptyFolders(folder);

			new Notice(`Successfully removed ${removedCount} incidental dialogue edits.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to clean edits: ${message}`);
		} finally {
			progress.update(100, 'Done');
			try { progress.hide(); } catch {}
		}
	}

	/**
	 * Registers the lazy loader with the plugin context.
	 */
	registerLazyLoader(plugin: any): void {
		if (this.lazyLoader) {
			this.lazyLoader.register(plugin);
		}
	}

	/**
	 * Frees database resources.
	 */
	async unloadDatabase(): Promise<void> {
		this.lazyLoader = null;
		await this.db?.free();
		this.db = null;
		this.onUpdate();
	}
}

import { App, TFile, TFolder, normalizePath } from 'obsidian';
import type ObsidianEsp from '../main';
import type { GameDatabase } from '../database/game-database';
import { BASE_FILE_NAME, ensureBaseFileInFolder } from './topic-base';
import { PathManager } from './path-manager';
import { VaultWriter } from '../utils/vault-writer';

/**
 * Intercepts newly-created files that match a topic name in the merged database.
 * When Obsidian creates an empty file (e.g. from clicking an unresolved [[wiki-link]]),
 * we populate it with the topic's dialogue records on the fly.
 */
export class LazyLoader {
	private topicNames: Set<string>;
	private inflightTopics = new Set<string>();
	private vaultWriter: VaultWriter;
	private pathManager: PathManager;

	constructor(
		private db: GameDatabase,
		private outputFolder: string,
		private app: App,
	) {
		this.vaultWriter = new VaultWriter(app);
		this.pathManager = new PathManager(outputFolder);

		// Build a case-insensitive lookup set of all valid topic names in the database
		this.topicNames = new Set(
			db.getAllTopicNames().map((n) => n.toLowerCase()),
		);
	}

	/**
	 * Registers vault listeners to watch for new file creation.
	 */
	register(plugin: ObsidianEsp): void {
		plugin.registerEvent(
			plugin.app.vault.on('create', (file) => {
				if (file instanceof TFile) {
					void this.handleFileCreate(plugin, file);
				}
			}),
		);
	}

	/**
	 * Handles the creation of a new file by checking if it matches a dialogue topic.
	 */
	private async handleFileCreate(
		plugin: ObsidianEsp,
		file: TFile,
	): Promise<void> {
		// Only act on .md files whose basename matches a known topic in the database
		if (file.extension !== 'md') return;

		const topicKey = file.basename.toLowerCase();
		if (!this.topicNames.has(topicKey)) return;

		// Only act on empty files (standard behavior for clicked [[wiki-links]])
		const content = await plugin.app.vault.read(file);
		if (content.trim().length > 0) return;

		// Prevent concurrent generation/population of the same topic
		if (this.inflightTopics.has(topicKey)) return;
		this.inflightTopics.add(topicKey);

		try {
			// Step 1: Unpack specific topic records from WASM
			const files = this.db.unpackTopic(file.basename);
			if (files.length === 0) return;

			const fileName = this.db.info.fileName;
			const pluginDir = this.pathManager.getPluginDir(fileName);

			// Step 2: Ensure the plugin root exists and has the required Base View file
			await this.vaultWriter.ensureFolder(pluginDir);
			const rootFolderAbstract = plugin.app.vault.getAbstractFileByPath(pluginDir);
			if (rootFolderAbstract instanceof TFolder) {
				await ensureBaseFileInFolder(plugin.app, rootFolderAbstract);
			}

			// Step 3: Resolve relative paths to absolute vault paths
			const resolvedFiles = this.pathManager.resolveAbsolutePaths(fileName, files);

			// Step 4: Determine the target path for the "Index" file and rename if necessary
			// This ensures the clicked link points to the correct place in the hierarchy
			const firstResolved = resolvedFiles[0];
			if (!firstResolved) return;

			const topicFolderPath = firstResolved[0].substring(0, firstResolved[0].lastIndexOf('/'));
			const targetIndexPath = normalizePath(`${topicFolderPath}/${file.name}`);
			
			// Step 4a: Ensure target folder exists before renaming
			await this.vaultWriter.ensureFolder(topicFolderPath);

			let topicIndexFile = file;
			if (file.path !== targetIndexPath) {
				await plugin.app.fileManager.renameFile(file, targetIndexPath);
				const renamedFile = plugin.app.vault.getAbstractFileByPath(targetIndexPath);
				if (!(renamedFile instanceof TFile)) return;
				topicIndexFile = renamedFile;
			}

			// Step 5: Write the actual dialogue info files (the content)
			await this.vaultWriter.writeFiles(resolvedFiles);

			// Step 6: Populate the topic index file with the Base View embed
			const baseFilePath = normalizePath(`${pluginDir}/${BASE_FILE_NAME}`);
			const indexContent = `![[${baseFilePath}#Topic View]]\n`;
			await plugin.app.vault.modify(topicIndexFile, indexContent);

			// Step 7: Trigger a link update to connect the new topic to existing dialogue
			const rootFolder = plugin.app.vault.getAbstractFileByPath(pluginDir);
			if (rootFolder instanceof TFolder) {
				// We call directly because DatabaseManager handles the context
				await (plugin as any).dbManager.updateTopicLinks(rootFolder, true);
			}
		} finally {
			this.inflightTopics.delete(topicKey);
		}
	}
}

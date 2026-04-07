import { TFile, TFolder, normalizePath } from 'obsidian';
import type ObsidianEsp from '../main';
import type { GameDatabase } from '../database/game-database';
import { BASE_FILE_NAME, ensureBaseFileInFolder } from './topic-base';

/**
 * Intercepts newly-created files that match a topic name in the merged database.
 * When Obsidian creates an empty file from clicking an unresolved [[wiki-link]],
 * we populate it with the topic's info files on the fly.
 */
export class LazyLoader {
	private db: GameDatabase;
	private outputFolder: string;
	private topicNames: Set<string>;
	private inflightTopics = new Set<string>();

	constructor(db: GameDatabase, outputFolder: string) {
		this.db = db;
		this.outputFolder = outputFolder;

		// Build a case-insensitive lookup set
		this.topicNames = new Set(
			db.getAllTopicNames().map((n) => n.toLowerCase()),
		);
	}

	register(plugin: ObsidianEsp): void {
		plugin.registerEvent(
			plugin.app.vault.on('create', (file) => {
				if (file instanceof TFile) {
					void this.handleFileCreate(plugin, file);
				}
			}),
		);
	}

	private async handleFileCreate(
		plugin: ObsidianEsp,
		file: TFile,
	): Promise<void> {
		// Only act on .md files whose basename matches a known topic
		if (file.extension !== 'md') return;

		const topicKey = file.basename.toLowerCase();
		if (!this.topicNames.has(topicKey)) return;

		// Only act on empty files (created by clicking a dead wiki-link)
		const content = await plugin.app.vault.read(file);
		if (content.trim().length > 0) return;

		// Prevent concurrent generation of the same topic
		if (this.inflightTopics.has(topicKey)) return;
		this.inflightTopics.add(topicKey);

		try {
			const files = this.db.unpackTopic(file.basename);
			if (files.length === 0) return;

			// Determine the output base directory (same as unpack uses)
			const baseName = this.db.info.fileName.replace(/\.[^.]+$/, '');
			const outputDir = normalizePath(
				`${this.outputFolder}/${baseName}`,
			);

			const adapter = plugin.app.vault.adapter;

			// Ensure parent folders exist and write info files
			const folders = new Set<string>();
			for (const [relativePath] of files) {
				const fullPath = normalizePath(`${outputDir}/${relativePath}`);
				const parentDir = fullPath.substring(
					0,
					fullPath.lastIndexOf('/'),
				);
				let dir = parentDir;
				while (dir && !folders.has(dir)) {
					folders.add(dir);
					dir = dir.substring(0, dir.lastIndexOf('/'));
				}
			}

			const sortedFolders = [...folders].sort();
			for (const dir of sortedFolders) {
				await ensureFolder(plugin, dir);
			}

			const firstRelativePath = files[0]?.[0];
			if (!firstRelativePath) {
				return;
			}

			const topicFolderPath = normalizePath(
				`${outputDir}/${firstRelativePath.substring(0, firstRelativePath.lastIndexOf('/'))}`,
			);
			const topicFolder = plugin.app.vault.getAbstractFileByPath(topicFolderPath);
			if (!(topicFolder instanceof TFolder)) {
				return;
			}
			
			const rootFolderAbstract = plugin.app.vault.getAbstractFileByPath(outputDir);
			if (rootFolderAbstract instanceof TFolder) {
				await ensureBaseFileInFolder(plugin.app, rootFolderAbstract);
			}

			const targetIndexPath = normalizePath(`${topicFolder.path}/${file.name}`);
			let topicIndexFile = file;
			if (file.path !== targetIndexPath) {
				await plugin.app.fileManager.renameFile(file, targetIndexPath);
				const renamedFile =
					plugin.app.vault.getAbstractFileByPath(targetIndexPath);
				if (!(renamedFile instanceof TFile)) {
					return;
				}
				topicIndexFile = renamedFile;
			}

			for (const [relativePath, fileContent] of files) {
				const fullPath = normalizePath(`${outputDir}/${relativePath}`);
				await adapter.write(fullPath, fileContent);
			}

			// Replace the empty file with the topic index content
			const baseFilePath = normalizePath(`${outputDir}/${BASE_FILE_NAME}`);
			const indexContent = `![[${baseFilePath}#Topic View]]\n`;
			await plugin.app.vault.modify(topicIndexFile, indexContent);

			// Automate topic link update after lazy-load
			const rootFolder = plugin.app.vault.getAbstractFileByPath(outputDir);
			if (rootFolder instanceof TFolder) {
				await plugin.updateTopicLinks(rootFolder, true);
			}
		} finally {
			this.inflightTopics.delete(topicKey);
		}
	}
}

async function ensureFolder(
	plugin: ObsidianEsp,
	path: string,
): Promise<void> {
	const existing = plugin.app.vault.getAbstractFileByPath(path);
	if (existing) return;
	await plugin.app.vault.createFolder(path);
}

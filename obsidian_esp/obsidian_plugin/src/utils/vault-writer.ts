import { App, TFolder, normalizePath } from 'obsidian';
import { ProgressReporter, NullReporter } from './progress-reporter';

/**
 * Utility for performing batch write operations to the Obsidian vault.
 * Handles folder creation and batching to avoid performance bottlenecks.
 */
export class VaultWriter {
	constructor(private app: App) {}

	/**
	 * Writes a collection of files to the vault.
	 * Automatically ensures that all parent directories exist.
	 * 
	 * @param files Array of [path, content] pairs. Paths should be absolute vault paths.
	 * @param reporter Optional progress reporter.
	 * @param batchSize Number of files to write concurrently.
	 * @returns The number of files successfully written.
	 */
	async writeFiles(
		files: [string, string][],
		reporter: ProgressReporter = NullReporter,
		batchSize = 50,
	): Promise<number> {
		if (files.length === 0) return 0;

		// Step 1: Resolve all required parent folders
		const folders = new Set<string>();
		for (const [fullPath] of files) {
			const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
			let dir = parentDir;
			while (dir && !folders.has(dir)) {
				folders.add(dir);
				dir = dir.substring(0, dir.lastIndexOf('/'));
			}
		}

		// Step 2: Ensure all folders exist (sorted by depth)
		const sortedFolders = [...folders].sort();
		for (const dir of sortedFolders) {
			await this.ensureFolder(dir);
		}

		// Step 3: Write files in batches
		const adapter = this.app.vault.adapter;
		let created = 0;
		const total = files.length;

		for (let i = 0; i < total; i += batchSize) {
			const batch = files.slice(i, i + batchSize);
			const results = await Promise.allSettled(
				batch.map(([fullPath, content]) =>
					adapter.write(fullPath, content),
				),
			);

			for (const r of results) {
				if (r.status === 'fulfilled') created++;
			}

			const done = Math.min(i + batchSize, total);
			const pct = Math.round((done / total) * 100);
			reporter.update(pct, `Written ${done} / ${total} files`);
		}

		return created;
	}

	/**
	 * Ensures a folder exists, creating it recursively if necessary.
	 * @param path Absolute vault path to the folder.
	 */
	async ensureFolder(path: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return;
		if (existing) return; // File exists where folder should be - fail silently or error?

		await this.app.vault.createFolder(path);
	}
}

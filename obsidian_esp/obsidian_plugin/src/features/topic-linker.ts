/**
 * @file Topic linking: turns topic-name mentions into `[[wiki-links]]`.
 *
 * In Morrowind, saying a topic's name in dialogue is what unlocks it for the
 * player, so cross-references between responses matter. This service scans a
 * project's dialogue files and wraps every occurrence of a known topic name
 * in a wiki-link (making Obsidian's graph and backlinks useful), removes
 * links to topics that no longer exist, and maintains per-topic index files
 * that embed the shared `base.base` table view.
 *
 * The Rust side strips these links back out at compile time (see
 * `normalize_incidental_body_text` in `src/lib.rs`), so linking is purely an
 * authoring aid and never changes the compiled plugin.
 */
import { App, TFile, TFolder, Notice, normalizePath } from 'obsidian';
import { BASE_FILE_NAME, ensureBaseFileInFolder } from './topic-base';
import { getFrontmatter, splitFrontmatter, mergeFrontmatter } from '../utils/obsidian-utils';
import { PathManager } from './path-manager';

/** One topic discovered on disk: its dialogue files and where they live. */
interface TopicInfo {
	name: string;
	files: TFile[];
	/** Dialogue type (Topic, Journal, ...), used to pick the base view name. */
	type?: string;
	folder?: TFolder;
}

/** Recognized dialogue type names (also the project's folder names). */
const DIALOGUE_TYPES = ['Topic', 'Greeting', 'Persuasion', 'Journal', 'Voice'];

/** Progress snapshot emitted while the linker walks the project. */
export interface LinkerProgress {
	current: number;
	total: number;
	message: string;
}

/** Counts of what the linker changed. */
export interface LinkResult {
	/** Dialogue files whose body text was rewritten. */
	modifiedCount: number;
	/** Topic index files created or updated. */
	indexCount: number;
}

/**
 * Service for updating topic links and managing topic index files.
 */
export class TopicLinker {
	constructor(private app: App) {}

	/**
	 * Scans a folder for topic names and updates references to them with [[Links]].
	 * Also manages topic index files (topic.md files with Base View embeds).
	 *
	 * Two passes over each file body: first un-link references to topics that
	 * no longer exist, then wrap plain-text mentions of valid topics. Topic
	 * names are processed longest-first so overlapping names nest correctly
	 * (e.g. "Nerevarine prophecies" links before "Nerevarine").
	 *
	 * @param allTopicNames Full topic list from the loaded database; when
	 *   omitted, only topics that exist on disk are considered valid.
	 */
	async updateTopicLinks(
		folder: TFolder,
		allTopicNames?: string[],
		onProgress?: (progress: LinkerProgress) => void,
	): Promise<LinkResult> {
		const topics = await this.indexTopicsInFolder(folder);

		// When allTopicNames is provided, use the full database topic set for linking.
		// Otherwise, only link topics that have files on disk.
		const validTopicSet = allTopicNames
			? new Set(allTopicNames)
			: new Set(topics.keys());

		if (validTopicSet.size === 0) {
			return { modifiedCount: 0, indexCount: 0 };
		}

		const sortedTopicNames = Array.from(validTopicSet).sort(
			(a, b) => b.length - a.length,
		);

		const filesToProcess = await this.getFilesToProcess(folder);
		let modifiedCount = 0;
		const totalFiles = filesToProcess.length;

		for (let i = 0; i < totalFiles; i++) {
			const file = filesToProcess[i];
			if (!file) continue;
			
			if (onProgress) {
				onProgress({ 
					current: i + 1, 
					total: totalFiles, 
					message: `Processing: ${file.name}` 
				});
			}

			const content = await this.app.vault.read(file);
			const { frontmatter, body } = splitFrontmatter(content);

			// Step 3a: Pass 1 - Cleanup dead links
			// We remove wiki-links that point to topics that no longer exist in the database or vault.
			const cleanedBody = body.replace(/\[\[(.*?)\]\]/g, (match, topicName) => {
				if (validTopicSet.has(topicName)) {
					return match; // Keep valid link
				}
				return topicName; // Un-link dead link
			});

			// Step 3b: Pass 2 - Link new occurrences
			// We scan the text for case-insensitive matches of all known topic names and wrap them in wikilinks.
			let newBody = cleanedBody;
			let bodyModified = false;

			for (const topicName of sortedTopicNames) {
				const linkSyntax = `[[${topicName}]]`;
				const escapedTopic = topicName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				// Match occurrences that are NOT already part of a link or an @-mention
				const regex = new RegExp(`(?<!\\[\\[|@)\\b${escapedTopic}\\b(?!#\\]\\]|\\]\\])`, 'g');

				if (regex.test(newBody)) {
					newBody = newBody.replace(regex, linkSyntax);
					bodyModified = true;
				}
			}

			// Step 3c: Save changes if the body was modified
			if (bodyModified || cleanedBody !== body) {
				const newContent = mergeFrontmatter(frontmatter, newBody);
				await this.app.vault.modify(file, newContent);
				modifiedCount++;
			}
		}

		// Generate/Update Topic Index files (only for disk-present topics)
		let indexCount = 0;
		const rootFolder = PathManager.findPluginRoot(folder) || folder;
		await ensureBaseFileInFolder(this.app, rootFolder);

		for (const topic of topics.values()) {
			if (await this.createOrUpdateTopicIndex(topic, rootFolder)) {
				indexCount++;
			}
		}

		return { modifiedCount, indexCount };
	}

	/**
	 * Creates or updates a "Topic Index" file (e.g. 'TopicName.md') that embeds the Base View.
	 */
	private async createOrUpdateTopicIndex(topic: TopicInfo, rootFolder: TFolder): Promise<boolean> {
		if (topic.files.length === 0) return false;

		const topicFolder = topic.folder ?? topic.files[0]!.parent;
		if (!topicFolder) return false;

		const baseFilePath = normalizePath(`${rootFolder.path}/${BASE_FILE_NAME}`);
		const viewName = `${topic.type ?? 'Topic'} View`;
		const indexPath = normalizePath(`${topicFolder.path}/${topic.name}.md`);
		const indexContent = `![[${baseFilePath}#${viewName}]]\n`;

		const existing = this.app.vault.getAbstractFileByPath(indexPath);
		if (existing instanceof TFile) {
			const currentContent = await this.app.vault.read(existing);
			if (currentContent !== indexContent) {
				await this.app.vault.modify(existing, indexContent);
				return true;
			}
			return false;
		} else {
			await this.app.vault.create(indexPath, indexContent);
			return true;
		}
	}

	/**
	 * Scans a folder to find all markdown files that represent dialogue topics.
	 */
	private async indexTopicsInFolder(folder: TFolder): Promise<Map<string, TopicInfo>> {
		const topics = new Map<string, TopicInfo>();

		const processFolder = async (currentFolder: TFolder) => {
			for (const child of currentFolder.children) {
				if (child instanceof TFolder) {
					await processFolder(child);
				} else if (child instanceof TFile && child.extension === 'md') {
					const frontmatter = await getFrontmatter(this.app, child);

					let type = frontmatter?.Type;
					let topicName = frontmatter?.Topic;

					if (Array.isArray(type)) type = type[0];

					// If frontmatter is missing (e.g. newly created file), try to infer from path
					if (!type || !topicName) {
						const parts = child.path.split('/');
						for (const t of DIALOGUE_TYPES) {
							const idx = parts.indexOf(t);
							if (idx !== -1 && idx < parts.length - 1) {
								type = t;
								topicName = parts[idx + 1];
								break;
							}
						}
					}

					if (type && topicName && DIALOGUE_TYPES.includes(type)) {
						const parent = child.parent;
						if (!parent) continue;
						const key = normalizePath(parent.path);
						let existing = topics.get(key);
						if (!existing) {
							existing = { name: topicName, files: [], type, folder: parent };
							topics.set(key, existing);
						}
						existing.files.push(child);
					}
				}
			}
		};

		await processFolder(folder);
		return topics;
	}

	/**
	 * Retrieves a list of files that should be processed for link updates:
	 * Markdown files whose frontmatter carries both a valid `Type` and a
	 * `Topic`. When invoked on a project root, only the five dialogue
	 * category folders are scanned (skips canvases, notes, etc.).
	 */
	private async getFilesToProcess(folder: TFolder): Promise<TFile[]> {
		const files: TFile[] = [];

		const collect = async (currentFolder: TFolder) => {
			for (const child of currentFolder.children) {
				if (child instanceof TFolder) {
					await collect(child);
				} else if (child instanceof TFile && child.extension === 'md') {
					const frontmatter = await getFrontmatter(this.app, child);

					// Mandatory Frontmatter Check: Must contain Type property (Topic, Greeting, etc.)
					// AND Topic property
					let type = frontmatter?.Type;
					if (Array.isArray(type)) type = type[0];

					const hasValidType = DIALOGUE_TYPES.includes(type || '');
					const hasTopic = !!frontmatter?.Topic;

					if (hasValidType && hasTopic) {
						files.push(child);
					}
				}
			}
		};

		// Optimized scanning: If we are at the root, only look into dialogue category folders
		if (PathManager.isPluginRoot(folder)) {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					const childName = child.name.toLowerCase();
					if (DIALOGUE_TYPES.some((n) => n.toLowerCase() === childName)) {
						await collect(child);
					}
				}
			}
		} else {
			await collect(folder);
		}

		return files;
	}
}

/**
 * Backward compatibility wrapper for updateTopicLinksForFolder.
 * @deprecated Use TopicLinker class instead.
 */
export async function updateTopicLinksForFolder(
	app: App,
	folder: TFolder,
	allTopicNames?: string[],
	silent?: boolean,
	onProgress?: (current: number, total: number, message: string) => void,
) {
	const linker = new TopicLinker(app);
	const result = await linker.updateTopicLinks(folder, allTopicNames, (p) => {
		if (onProgress) onProgress(p.current, p.total, p.message);
	});

	if (!silent) {
		if (result.modifiedCount > 0) {
			new Notice(`Updated ${result.modifiedCount} files.`);
		} else if (allTopicNames === undefined) {
			// Only show if we didn't have any topics to begin with
			new Notice('No topics found in this project folder.');
		}
		
		if (result.indexCount > 0) {
			new Notice(`Generated/Updated ${result.indexCount} topic index files.`);
		}
	}
}

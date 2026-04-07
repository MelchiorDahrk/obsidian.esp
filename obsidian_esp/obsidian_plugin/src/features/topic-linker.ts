import { App, TFile, TFolder, Notice, normalizePath } from 'obsidian';
import { BASE_FILE_NAME, ensureBaseFileInFolder } from './topic-base';


interface TopicInfo {
	name: string;
	files: TFile[];
}

/**
 * The main entry point for updating topic links in a folder.
 * This function performs two passes over the files:
 * 1. Cleanup: Removes links that are no longer valid (dead links).
 * 2. Linking: Finds occurrences of topic names and wraps them in [[Links]].
 * It also handles topic index file generation (topic.md files with Base View embeds).
 * 
 * @param app The Obsidian app instance.
 * @param folder The folder to process.
 * @param allTopicNames Optional list of all valid topic names (e.g. from the game database).
 * @param silent If true, suppresses notifications.
 * @param onProgress Callback for progress updates.
 */
export async function updateTopicLinksForFolder(
	app: App,
	folder: TFolder,
	allTopicNames?: string[],
	silent?: boolean,
	onProgress?: (current: number, total: number, message: string) => void,
) {
	const topics = await indexTopicsInFolder(app, folder);

	// When allTopicNames is provided, use the full database topic set for linking.
	// Otherwise, only link topics that have files on disk.
	const validTopicSet = allTopicNames
		? new Set(allTopicNames)
		: new Set(topics.keys());

	if (validTopicSet.size === 0) {
		if (!silent) {
			new Notice('No topics found in this project folder.');
		}
		return;
	}

	const sortedTopicNames = Array.from(validTopicSet).sort(
		(a, b) => b.length - a.length,
	);

	const filesToProcess = await getFilesToProcess(app, folder);
	let modifiedCount = 0;
	const totalFiles = filesToProcess.length;

	for (let i = 0; i < totalFiles; i++) {
		const file = filesToProcess[i];
		if (!file) continue;
		if (onProgress) {
			onProgress(i + 1, totalFiles, `Processing: ${file.name}`);
		}
		const content = await app.vault.read(file);
		const { frontmatter, body } = splitFrontmatter(content);

		// Pass 1: Cleanup (Un-link dead links)
		let cleanedBody = body.replace(/\[\[(.*?)\]\]/g, (match, topicName) => {
			if (validTopicSet.has(topicName)) {
				return match; // Keep valid link
			}
			return topicName; // Un-link dead link
		});

		// Pass 2: Linking new occurrences
		let newBody = cleanedBody;
		let bodyModified = false;

		for (const topicName of sortedTopicNames) {
			const linkSyntax = `[[${topicName}]]`;
			const escapedTopic = topicName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const regex = new RegExp(`(?<!\\[\\[|@)\\b${escapedTopic}\\b(?!#\\]\\]|\\]\\])`, 'g');

			if (regex.test(newBody)) {
				newBody = newBody.replace(regex, linkSyntax);
				bodyModified = true;
			}
		}

		// Update if different from original body
		if (bodyModified || cleanedBody !== body) {
			const newContent = mergeFrontmatter(frontmatter, newBody);
			await app.vault.modify(file, newContent);
			modifiedCount++;
		}
	}

	if (!silent) {
		new Notice(`Updated ${modifiedCount} files.`);
	}

	// Generate/Update Topic Index files (only for disk-present topics)
	let indexCount = 0;
	const rootFolder = getPluginRoot(app, folder) || folder;
	await ensureBaseFileInFolder(app, rootFolder);

	for (const topic of topics.values()) {
		if (await createOrUpdateTopicIndex(app, topic, rootFolder)) {
			indexCount++;
		}
	}

	if (indexCount > 0 && !silent) {
		new Notice(`Generated/Updated ${indexCount} topic index files.`);
	}

}

/**
 * Navigates up the folder hierarchy to find the root of the plugin export.
 * Identified by the presence of a 'header.md' file.
 */
function getPluginRoot(app: App, folder: TFolder): TFolder | null {
	let current: TFolder | null = folder;
	while (current) {
		const headerPath = normalizePath(`${current.path}/header.md`);
		const headerFile = app.vault.getAbstractFileByPath(headerPath);
		if (headerFile instanceof TFile) return current;
		current = current.parent;
	}
	return null;
}

/**
 * Creates or updates a "Topic Index" file (e.g. 'TopicName.md') that embeds the Base View.
 * This allows users to see a consolidated view of all dialogue for a specific topic.
 */
async function createOrUpdateTopicIndex(app: App, topic: TopicInfo, rootFolder: TFolder): Promise<boolean> {
	if (topic.files.length === 0) return false;

	const firstFile = topic.files[0];
	if (!firstFile) return false;

	const topicFolder = firstFile.parent;
	if (!topicFolder) return false;

	const baseFilePath = normalizePath(`${rootFolder.path}/${BASE_FILE_NAME}`);
	const indexPath = normalizePath(`${topicFolder.path}/${topic.name}.md`);
	const indexContent = `![[${baseFilePath}#Topic View]]\n`;

	const existing = app.vault.getAbstractFileByPath(indexPath);
	if (existing instanceof TFile) {
		const currentContent = await app.vault.read(existing);
		if (currentContent !== indexContent) {
			await app.vault.modify(existing, indexContent);
			return true;
		}
		return false;
	} else {
		await app.vault.create(indexPath, indexContent);
		return true;
	}
}

/**
 * Scans a folder to find all markdown files that represent dialogue topics.
 * Returns a map of topic names to their associated files.
 */
async function indexTopicsInFolder(
	app: App,
	folder: TFolder,
): Promise<Map<string, TopicInfo>> {
	const topics = new Map<string, TopicInfo>();

	const processFolder = async (currentFolder: TFolder) => {
		for (const child of currentFolder.children) {
			if (child instanceof TFolder) {
				await processFolder(child);
			} else if (child instanceof TFile && child.extension === 'md') {
				const cache = app.metadataCache.getFileCache(child);
				let frontmatter = cache?.frontmatter;

				// Fallback: Read file if metadata cache is not ready
				if (!frontmatter) {
					const content = await app.vault.read(child);
					const { frontmatter: fmText } = splitFrontmatter(content);
					if (fmText) {
						frontmatter = parseBasicFrontmatter(fmText);
					}
				}

				let type = frontmatter?.Type;
				let topicName = frontmatter?.Topic;

				if (Array.isArray(type)) type = type[0];

				// If frontmatter is missing (e.g. newly created file), try to infer from path
				if (!type || !topicName) {
					const parts = child.path.split('/');
					const typeIndex = parts.indexOf('Topic');
					if (typeIndex !== -1 && typeIndex < parts.length - 1) {
						type = 'Topic';
						topicName = parts[typeIndex + 1];
					}
				}

				if (type === 'Topic' && topicName) {
					const existing: TopicInfo = topics.get(topicName) || {
						name: topicName,
						files: [],
					};
					existing.files.push(child);
					topics.set(topicName, existing);
				}
			}
		}
	};

	await processFolder(folder);
	return topics;
}

/**
 * Retrieves a list of files that should be processed for link updates.
 * If the folder is a plugin root, it restricts scanning to known dialogue subdirectories.
 */
async function getFilesToProcess(app: App, folder: TFolder): Promise<TFile[]> {
	const files: TFile[] = [];

	const collect = async (currentFolder: TFolder) => {
		for (const child of currentFolder.children) {
			if (child instanceof TFolder) {
				await collect(child);
			} else if (child instanceof TFile && child.extension === 'md') {
				const cache = app.metadataCache.getFileCache(child);
				let frontmatter = cache?.frontmatter;

				// Fallback: Read file if metadata cache is not ready
				if (!frontmatter) {
					const content = await app.vault.read(child);
					const { frontmatter: fmText } = splitFrontmatter(content);
					if (fmText) {
						frontmatter = parseBasicFrontmatter(fmText);
					}
				}

				// Mandatory Frontmatter Check: Must contain Type property (Topic, Greeting, etc.)
				// AND Topic property
				let type = frontmatter?.Type;
				if (Array.isArray(type)) type = type[0];

				const hasValidType = ['Topic', 'Greeting', 'Persuasion', 'Journal'].includes(type || '');
				const hasTopic = !!frontmatter?.Topic;

				if (hasValidType && hasTopic) {
					files.push(child);
				}
			}
		}
	};

	// Optimized scanning: If we are at the root, only look into dialogue category folders
	const headerPath = normalizePath(`${folder.path}/header.md`);
	const headerFile = app.vault.getAbstractFileByPath(headerPath);
	if (headerFile instanceof TFile) {
		const targetNames = ['Topic', 'Greeting', 'Persuasion', 'Journal'];
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				const childName = child.name.toLowerCase();
				if (targetNames.some((n) => n.toLowerCase() === childName)) {
					await collect(child);
				}
			}
		}
	} else {
		await collect(folder);
	}

	return files;
}

/**
 * Manually parses frontmatter key-value pairs from a string.
 * Used as a fallback when Obsidian's metadata cache is not yet available.
 */
function parseBasicFrontmatter(fmText: string): Record<string, any> {
	const result: Record<string, any> = {};
	const lines = fmText.replace(/^---\n/, '').replace(/\n---\n$/, '').split('\n');
	for (const line of lines) {
		const colonIndex = line.indexOf(':');
		if (colonIndex !== -1) {
			const key = line.substring(0, colonIndex).trim();
			const value = line.substring(colonIndex + 1).trim();
			result[key] = value;
		}
	}
	return result;
}

/**
 * Splits a markdown string into its frontmatter block and body.
 */
function splitFrontmatter(content: string): {
	frontmatter: string;
	body: string;
} {
	const match = content.match(/^---\n([\s\S]*?)\n---\n/);
	if (match) {
		return {
			frontmatter: match[0],
			body: content.slice(match[0].length),
		};
	}
	return { frontmatter: '', body: content };
}

/**
 * Merges frontmatter and body back into a single string.
 */
function mergeFrontmatter(frontmatter: string, body: string): string {
	return frontmatter + body;
}

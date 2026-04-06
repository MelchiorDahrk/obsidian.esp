import { App, TFile, TFolder, Notice, normalizePath } from 'obsidian';
import { BASE_FILE_NAME, ensureBaseFileInFolder } from './topic-base';


interface TopicInfo {
	name: string;
	files: TFile[];
}

export async function updateTopicLinksForFolder(
	app: App,
	folder: TFolder,
	allTopicNames?: string[],
) {
	const topics = await indexTopicsInFolder(app, folder);

	// When allTopicNames is provided, use the full database topic set for linking.
	// Otherwise, only link topics that have files on disk.
	const validTopicSet = allTopicNames
		? new Set(allTopicNames)
		: new Set(topics.keys());

	if (validTopicSet.size === 0) {
		new Notice('No topics found in this project folder.');
		return;
	}

	const sortedTopicNames = Array.from(validTopicSet).sort(
		(a, b) => b.length - a.length,
	);

	const filesToProcess = getFilesToProcess(app, folder);
	let modifiedCount = 0;

	for (const file of filesToProcess) {
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

	new Notice(`Updated ${modifiedCount} files.`);

	// Generate/Update Topic Index files (only for disk-present topics)
	let indexCount = 0;
	for (const topic of topics.values()) {
		if (await createOrUpdateTopicIndex(app, topic)) {
			indexCount++;
		}
	}

	if (indexCount > 0) {
		new Notice(`Generated/Updated ${indexCount} topic index files.`);
	}

}

async function createOrUpdateTopicIndex(app: App, topic: TopicInfo): Promise<boolean> {
	if (topic.files.length === 0) return false;

	const firstFile = topic.files[0];
	if (!firstFile) return false;

	const topicFolder = firstFile.parent;
	if (!topicFolder) return false;

	const parentFolder = topicFolder.parent;
	if (!parentFolder) return false;

	await ensureBaseFileInFolder(app, topicFolder);

	const baseFilePath = normalizePath(`${topicFolder.path}/${BASE_FILE_NAME}`);
	const indexPath = normalizePath(`${parentFolder.path}/${topic.name}.md`);
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

async function indexTopicsInFolder(
	app: App,
	folder: TFolder,
): Promise<Map<string, TopicInfo>> {
	const topics = new Map<string, TopicInfo>();

	const processFolder = (currentFolder: TFolder) => {
		for (const child of currentFolder.children) {
			if (child instanceof TFolder) {
				processFolder(child);
			} else if (child instanceof TFile && child.extension === 'md') {
				const cache = app.metadataCache.getFileCache(child);
				const frontmatter = cache?.frontmatter;

				let type = frontmatter?.Type;
				let topicName = frontmatter?.Topic;

				if (Array.isArray(type)) type = type[0];

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

	processFolder(folder);
	return topics;
}

function getFilesToProcess(app: App, folder: TFolder): TFile[] {
	const files: TFile[] = [];

	const collect = (currentFolder: TFolder) => {
		for (const child of currentFolder.children) {
			if (child instanceof TFolder) {
				collect(child);
			} else if (child instanceof TFile && child.extension === 'md') {
				const cache = app.metadataCache.getFileCache(child);
				const frontmatter = cache?.frontmatter;

				// Mandatory Frontmatter Check as per user request
				// Must contain Type property (Topic, Greeting, Persuasion, Journal)
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

	// If the user ran the command on a plugin export root (contains header.md),
	// restrict processing to the canonical subfolders where content lives:
	// Topic, Greeting, Persuasion, Journal (case-insensitive). Otherwise,
	// recurse the entire selected folder as before.
	const headerPath = normalizePath(`${folder.path}/header.md`);
	const headerFile = app.vault.getAbstractFileByPath(headerPath);
	if (headerFile instanceof TFile) {
		const targetNames = ['Topic', 'Greeting', 'Persuasion', 'Journal'];
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				const childName = child.name.toLowerCase();
				if (targetNames.some((n) => n.toLowerCase() === childName)) {
					collect(child);
				}
			}
		}
	} else {
		collect(folder);
	}

	return files;
}

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

function mergeFrontmatter(frontmatter: string, body: string): string {
	return frontmatter + body;
}

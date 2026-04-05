import { App, TFile, TFolder, Notice } from 'obsidian';

interface TopicInfo {
	name: string;
	files: TFile[];
}

export async function createTopicLinksForFolder(app: App, folder: TFolder) {
	const topics = await indexTopicsInFolder(app, folder);
	if (topics.size === 0) {
		new Notice('No topics found in this folder.');
		return;
	}

	const sortedTopicNames = Array.from(topics.keys()).sort(
		(a, b) => b.length - a.length,
	);

	const filesToProcess = getFilesToProcess(folder);
	let modifiedCount = 0;

	for (const file of filesToProcess) {
		const content = await app.vault.read(file);
		const { frontmatter, body } = splitFrontmatter(content);

		let newBody = body;
		let bodyModified = false;

		for (const topicName of sortedTopicNames) {
			const topicInfo = topics.get(topicName)!;
			const linkSyntax = `[[${topicName}]]`;

			const escapedTopic = topicName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			// Pattern: find topic name not preceded by [[ or @ and not followed by #]] or ]]
			// Also avoid matching inside [ ] (markdown links)
			const regex = new RegExp(`(?<!\\[\\[|@)\\b${escapedTopic}\\b(?!#\\]\\]|\\]\\])`, 'g');

			if (regex.test(newBody)) {
				newBody = newBody.replace(regex, linkSyntax);
				bodyModified = true;
			}
		}

		if (bodyModified) {
			const newContent = mergeFrontmatter(frontmatter, newBody);
			await app.vault.modify(file, newContent);
			modifiedCount++;
		}
	}

	new Notice(`Linked ${modifiedCount} files.`);
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

				// If Type is an array (common in this project), take first
				if (Array.isArray(type)) type = type[0];
				
				// Infer from path if missing
				if (!type || !topicName) {
					const parts = child.path.split('/');
					// Format: .../Type/Name/Filename.md
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

function getFilesToProcess(folder: TFolder): TFile[] {
	const files: TFile[] = [];

	const collect = (currentFolder: TFolder) => {
		for (const child of currentFolder.children) {
			if (child instanceof TFolder) {
				collect(child);
			} else if (child instanceof TFile && child.extension === 'md') {
				const parts = child.path.split('/');
				// Skip Voice
				if (parts.some((p) => p === 'Voice')) continue;

				// Check if it's one of the valid types
				const isValidType = parts.some((p) =>
					['Topic', 'Greeting', 'Persuasion', 'Journal'].includes(p),
				);
				if (isValidType) {
					files.push(child);
				}
			}
		}
	};

	collect(folder);
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

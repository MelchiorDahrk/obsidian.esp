import { App, TFile, TFolder, Notice } from 'obsidian';

interface TopicInfo {
	name: string;
	files: TFile[];
}

export async function updateTopicLinksForFolder(app: App, folder: TFolder) {
	const topics = await indexTopicsInFolder(app, folder);
	if (topics.size === 0) {
		new Notice('No topics found in this project folder.');
		return;
	}

	const sortedTopicNames = Array.from(topics.keys()).sort(
		(a, b) => b.length - a.length,
	);

	const filesToProcess = getFilesToProcess(app, folder);
	let modifiedCount = 0;

	for (const file of filesToProcess) {
		const content = await app.vault.read(file);
		const { frontmatter, body } = splitFrontmatter(content);

		// Pass 1: Cleanup (Un-link dead links)
		let cleanedBody = body.replace(/\[\[(.*?)\]\]/g, (match, topicName) => {
			if (topics.has(topicName)) {
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

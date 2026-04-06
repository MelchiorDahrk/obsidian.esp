import { App, TFile, TFolder, Notice, normalizePath } from 'obsidian';

const BASE_FILE_NAME = 'topic_views.base';
const BASE_FILE_CONTENT = `filters:
  and:
    - file.inFolder(this.file.folder)
    - not:
        - file.path == this.file.path
views:
  - type: table
    name: "Topic View"
    order:
      - file.name
    properties:
      file.name:
        displayName: "File"
      ID:
        displayName: "Speaker"
      Disposition:
        displayName: "Disp"
      Index:
        displayName: "Idx"
      Class:
        displayName: "Class"
      Faction:
        displayName: "Faction"
      Rank:
        displayName: "Rank"
      Cell:
        displayName: "Cell"
      Result:
        displayName: "Result"
`;


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

	// Generate/Update Topic Index files
	await ensureBaseFile(app);
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

async function ensureBaseFile(app: App) {
	const path = normalizePath(BASE_FILE_NAME);
	const existing = app.vault.getAbstractFileByPath(path);
	if (!existing) {
		await app.vault.create(path, BASE_FILE_CONTENT);
	}
}

async function createOrUpdateTopicIndex(app: App, topic: TopicInfo): Promise<boolean> {
	if (topic.files.length === 0) return false;

	const firstFile = topic.files[0];
	if (!firstFile) return false;

	const parentFolder = firstFile.parent;
	if (!parentFolder) return false;

	const indexPath = normalizePath(`${parentFolder.path}/${topic.name}.md`);
	const indexContent = `![[${BASE_FILE_NAME}#Topic View]]\n`;

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

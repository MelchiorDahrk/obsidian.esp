import { App, MarkdownPostProcessorContext, Menu, Plugin, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

// Cache for indexed topics mapping: ProjectRootPath -> (TopicName -> TFile[])
const projectIndex = new Map<string, Map<string, TFile[]>>();

export function registerMultilinkHandlers(plugin: Plugin) {
	const app = plugin.app;

	// 1. Initial Indexing for current file
	const activeFile = app.workspace.getActiveFile();
	if (activeFile) {
		void preIndexForFile(app, activeFile);
	}

	// 2. Pre-index when files are opened
	plugin.registerEvent(
		app.workspace.on('file-open', (file) => {
			if (file instanceof TFile) {
				void preIndexForFile(app, file);
			}
		})
	);

	// 3. Markdown Post-processor for Reading Mode styling
	plugin.registerMarkdownPostProcessor(async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
		const links = el.querySelectorAll('a.internal-link');
		if (links.length === 0) return;

		const sourceFile = app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!(sourceFile instanceof TFile)) return;

		const root = getProjectRoot(sourceFile);
		const topicMap = projectIndex.get(root.path);
		if (!topicMap) return;

		for (let i = 0; i < links.length; i++) {
			const linkEl = links[i] as HTMLAnchorElement;
			const topicName = (linkEl.getAttribute('data-link-text') || linkEl.textContent || '').trim();
			if (topicName && (topicMap.get(topicName)?.length ?? 0) > 1) {
				linkEl.addClass('esp-multilink');
			}
		}
	});

	// 4. SYNCHRONOUS Global Click Interception (Capture phase)
	plugin.registerDomEvent(document, 'click', (event: MouseEvent) => {
		const target = event.target as HTMLElement;
		const linkEl = target.closest('.internal-link, .cm-link, .cm-hmd-internal-link');
		if (!linkEl) return;

		// Skip if any modifier keys are pressed (let Obsidian handle those)
		if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
			return;
		}

		let topicName = linkEl.getAttribute('data-link-text') || linkEl.textContent || '';
		topicName = topicName.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]?.trim() ?? '';
		if (!topicName) return;

		const activeFile = app.workspace.getActiveFile();
		if (!activeFile) return;

		const root = getProjectRoot(activeFile);
		const topicMap = projectIndex.get(root.path);
		if (!topicMap) return;

		const files = topicMap.get(topicName);
		if (files && files.length > 1) {
			// !!! SYCHRONOUS BLOCK !!!
			event.preventDefault();
			event.stopImmediatePropagation();
			
			void showMultilinkMenu(app, topicName, event, files);
		}
	}, true);
}

// 5. CodeMirror 6 Extension for Live Preview styling
export const multilinkEditorExtension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = this.buildDecorations(update.view);
			}
		}

		buildDecorations(view: EditorView): DecorationSet {
			const builder = new RangeSetBuilder<Decoration>();
			const text = view.state.doc.toString();
			const linkPattern = /\[\[(.*?)\]\]/g;

			let match;
			while ((match = linkPattern.exec(text)) !== null) {
				const start = match.index;
				const end = start + match[0].length;
				builder.add(start, end, Decoration.mark({
					class: 'esp-multilink-potential' 
				}));
			}

			return builder.finish();
		}
	},
	{
		decorations: (v) => v.decorations,
	},
);

async function preIndexForFile(app: App, file: TFile) {
	const root = getProjectRoot(file);
	const topics = await indexTopicsInProject(app, root);
	projectIndex.set(root.path, topics);
}

function getProjectRoot(file: TFile): TFolder {
	let current = file.parent;
	while (current) {
		const isRoot = current.children.some(
			(child) => child instanceof TFile && child.name === 'header.md'
		);
		if (isRoot) return current;
		if (current.isRoot()) break;
		current = current.parent;
	}
	// Fallback to parent folder if no header.md found
	return file.parent || (file.vault.getRoot() as TFolder);
}

async function indexTopicsInProject(
	app: App,
	root: TFolder,
): Promise<Map<string, TFile[]>> {
	const topics = new Map<string, TFile[]>();

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
					const existing = topics.get(topicName) || [];
					existing.push(child);
					topics.set(topicName, existing);
				}
			}
		}
	};

	processFolder(root);
	return topics;
}

async function showMultilinkMenu(
	app: App,
	topicName: string,
	event: MouseEvent | PointerEvent,
	files: TFile[],
) {
	const menu = new Menu();
	const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));

	for (const file of sortedFiles) {
		const content = await app.vault.read(file);
		const snippet = getBodySnippet(content, 150);

		menu.addItem((item) => {
			item.setTitle(`${file.basename}\n"${snippet}..."`)
				.setIcon('file-text')
				.onClick(() => {
					void app.workspace.getLeaf().openFile(file);
				});
		});
	}

	menu.showAtMouseEvent(event);
}

function getBodySnippet(content: string, length: number): string {
	const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
	const body = match ? match[1] : content;
	if (!body) return '';
	return body.trim().replace(/\s+/g, ' ').slice(0, length);
}

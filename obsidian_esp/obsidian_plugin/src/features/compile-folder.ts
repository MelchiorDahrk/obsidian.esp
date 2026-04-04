import { App, Notice, TAbstractFile, TFile, TFolder, normalizePath } from 'obsidian';
import { compile_project } from '../../pkg/obsidian_esp.js';
import { confirmDefaultHeader } from '../ui/header-warning-modal';
import { selectVaultFolder } from '../ui/folder-suggest-modal';

const DIALOGUE_FOLDERS = ['Greeting', 'Journal', 'Persuasion', 'Topic', 'Voice'];

type ProjectFile = [string, string];

function collectMarkdownFiles(currentFolder: TFolder, files: TFile[]): void {
	for (const child of currentFolder.children) {
		if (child instanceof TFile && child.extension === 'md') {
			files.push(child);
			continue;
		}

		if (child instanceof TFolder) {
			collectMarkdownFiles(child, files);
		}
	}
}

function toRelativeProjectPath(rootFolder: TFolder, file: TAbstractFile): string {
	return file.path.slice(rootFolder.path.length + 1);
}

function fileExists(rootFolder: TFolder, name: string, app: App): boolean {
	const path = normalizePath(`${rootFolder.path}/${name}`);
	return app.vault.getAbstractFileByPath(path) instanceof TFile;
}

async function collectProjectFiles(
	app: App,
	rootFolder: TFolder,
): Promise<ProjectFile[]> {
	const files: TFile[] = [];
	const headerPath = normalizePath(`${rootFolder.path}/header.md`);
	const headerFile = app.vault.getAbstractFileByPath(headerPath);

	if (headerFile instanceof TFile) {
		files.push(headerFile);
	}

	for (const folderName of DIALOGUE_FOLDERS) {
		const dialogueFolderPath = normalizePath(`${rootFolder.path}/${folderName}`);
		const dialogueFolder = app.vault.getAbstractFileByPath(dialogueFolderPath);
		if (!(dialogueFolder instanceof TFolder)) {
			continue;
		}

		collectMarkdownFiles(dialogueFolder, files);
	}

	files.sort((left, right) => left.path.localeCompare(right.path));

	return await Promise.all(
		files.map(
			async (file): Promise<ProjectFile> => [
				toRelativeProjectPath(rootFolder, file),
				await app.vault.read(file),
			],
		),
	);
}

async function writePluginFile(
	app: App,
	outputPath: string,
	bytes: Uint8Array,
): Promise<void> {
	const existingFile = app.vault.getAbstractFileByPath(outputPath);
	const arrayBuffer = bytes.slice().buffer;

	if (existingFile instanceof TFile) {
		await app.vault.modifyBinary(existingFile, arrayBuffer);
		return;
	}

	await app.vault.createBinary(outputPath, arrayBuffer);
}

export async function compileVaultFolder(app: App): Promise<void> {
	try {
		const folder = await selectVaultFolder(app);
		if (!folder) {
			return;
		}

		const projectFiles = await collectProjectFiles(app, folder);
		const hasHeader = fileExists(folder, 'header.md', app);
		if (!hasHeader) {
			const shouldContinue = await confirmDefaultHeader(app, folder.name);
			if (!shouldContinue) {
				return;
			}
		}

		const hasDialogueMarkdown = projectFiles.some(
			([relativePath]) => relativePath.toLowerCase() !== 'header.md',
		);
		if (!hasDialogueMarkdown) {
			new Notice('No dialogue files were found.');
			return;
		}

		const bytes = compile_project(projectFiles, !hasHeader);
		const outputFileName = `${folder.name}_dialogue.esp`;
		const outputPath = normalizePath(`${folder.path}/${outputFileName}`);
		await writePluginFile(app, outputPath, bytes);
		new Notice(`Created ${outputFileName}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Failed to compile folder: ${message}`);
	}
}

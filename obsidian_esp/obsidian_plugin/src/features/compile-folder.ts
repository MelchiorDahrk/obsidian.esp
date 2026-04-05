import { App, Notice, TAbstractFile, TFile, TFolder, normalizePath } from 'obsidian';
import * as obsidianEsp from '../../pkg/obsidian_esp.js';
import {
	extractMasterNamesFromHeaderContent,
	loadValidationMasters,
} from './master-files';
import { confirmDefaultHeader } from '../ui/header-warning-modal';
import { selectVaultFolder } from '../ui/folder-suggest-modal';

const DIALOGUE_FOLDERS = ['Greeting', 'Journal', 'Persuasion', 'Topic', 'Voice'];

type ProjectFile = [string, string];

interface CompileProjectWithLogResult {
	bytes: Uint8Array;
	log: string;
}

const compileProjectWithLog = obsidianEsp.compile_project_with_log as (
	files: ProjectFile[],
	allowDefaultHeader: boolean,
	masters: import('./master-files').MasterFile[],
) => CompileProjectWithLogResult;

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
			async (file): Promise<ProjectFile> => {
				const content = await app.vault.read(file);
				const cleanContent = content.replace(
					/\[\[(?:[^|\]]*?\|)?([^|\]]*?)\]\]/g,
					'$1',
				);
				return [toRelativeProjectPath(rootFolder, file), cleanContent];
			},
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

async function writeLogFile(
	app: App,
	outputPath: string,
	content: string,
): Promise<void> {
	const existingFile = app.vault.getAbstractFileByPath(outputPath);

	if (existingFile instanceof TFile) {
		await app.vault.modify(existingFile, content);
		return;
	}

	await app.vault.create(outputPath, content);
}

function extractMasterNames(
	projectFiles: ProjectFile[],
	hasHeader: boolean,
): string[] {
	if (!hasHeader) {
		return ['Morrowind.esm'];
	}

	const headerFile = projectFiles.find(
		([relativePath]) => relativePath.toLowerCase() === 'header.md',
	);
	if (!headerFile) {
		return ['Morrowind.esm'];
	}

	return extractMasterNamesFromHeaderContent(headerFile[1]);
}

function combineLogMessages(
	outputFileName: string,
	loadMessages: string[],
	compileLog: string,
): string {
	let output = `obsidian_esp compile log for ${outputFileName}\n`;

	if (loadMessages.length > 0) {
		output += '\nMaster loading:\n';
		for (const message of loadMessages) {
			output += `- ${message}\n`;
		}
	}

	if (compileLog.trim().length > 0) {
		output += `\n${compileLog.trim()}\n`;
	}

	return output;
}

export async function compileFolderSelection(
	app: App,
	folder: TFolder,
): Promise<void> {
	try {
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

		const outputFileName = `${folder.name}_dialogue.esp`;
		const logFileName = `${folder.name}_dialogue.log`;
		const masterNames = extractMasterNames(projectFiles, hasHeader);
		const { masters, messages } = await loadValidationMasters(masterNames);
		const compileResult = compileProjectWithLog(
			projectFiles,
			!hasHeader,
			masters,
		);
		const { bytes, log } = compileResult;
		const outputPath = normalizePath(`${folder.path}/${outputFileName}`);
		const logPath = normalizePath(`${folder.path}/${logFileName}`);
		await writePluginFile(app, outputPath, bytes);
		await writeLogFile(
			app,
			logPath,
			combineLogMessages(outputFileName, messages, log),
		);
		new Notice(`Created ${outputFileName}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Failed to compile folder: ${message}`);
	}
}

export async function compileVaultFolder(app: App): Promise<void> {
	const folder = await selectVaultFolder(app);
	if (!folder) {
		return;
	}

	await compileFolderSelection(app, folder);
}

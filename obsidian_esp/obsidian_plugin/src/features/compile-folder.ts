import { readFile, readdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { App, Notice, TAbstractFile, TFile, TFolder, normalizePath } from 'obsidian';
import * as obsidianEsp from '../../pkg/obsidian_esp.js';
import { confirmDefaultHeader } from '../ui/header-warning-modal';
import { selectVaultFolder } from '../ui/folder-suggest-modal';

const DIALOGUE_FOLDERS = ['Greeting', 'Journal', 'Persuasion', 'Topic', 'Voice'];

type ProjectFile = [string, string];
type MasterFile = [string, Uint8Array];

interface CompileProjectWithLogResult {
	bytes: Uint8Array;
	log: string;
}

const compileProjectWithLog = obsidianEsp.compile_project_with_log as (
	files: ProjectFile[],
	allowDefaultHeader: boolean,
	masters: MasterFile[],
) => CompileProjectWithLogResult;

const nodeGlobals = globalThis as typeof globalThis & {
	process?: {
		env?: Record<string, string | undefined>;
	};
};

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

	const lines = headerFile[1].replace(/\r/g, '').split('\n');
	const masters: string[] = [];
	let inMasters = false;

	for (const line of lines) {
		if (line.trim() === '---') {
			continue;
		}

		if (inMasters) {
			const listMatch = line.match(/^\s*-\s*(.+?)\s*$/);
			if (listMatch) {
				const listValue = listMatch[1];
				if (listValue) {
					masters.push(stripQuotes(listValue.trim()));
				}
				continue;
			}

			if (/^[A-Za-z0-9 _-]+:/.test(line)) {
				inMasters = false;
			} else {
				continue;
			}
		}

		const mastersMatch = line.match(/^Masters:\s*(.*)$/i);
		if (!mastersMatch) {
			continue;
		}

		const inlineValue = (mastersMatch[1] ?? '').trim();
		if (inlineValue.length > 0) {
			masters.push(stripQuotes(inlineValue));
			inMasters = false;
		} else {
			inMasters = true;
		}
	}

	return masters.length > 0 ? masters : ['Morrowind.esm'];
}

function stripQuotes(value: string): string {
	return value.replace(/^"(.*)"$/, '$1').trim();
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await readFile(path);
		return true;
	} catch {
		return false;
	}
}

async function findOpenMwConfigPath(): Promise<string | null> {
	const home = homedir();
	const candidates = [
		nodeGlobals.process?.env?.OPENMW_CONFIG,
		join(home, 'Documents', 'My Games', 'OpenMW', 'openmw.cfg'),
		join(home, 'OneDrive', 'Documents', 'My Games', 'OpenMW', 'openmw.cfg'),
		join(home, '.config', 'openmw', 'openmw.cfg'),
		join(home, '.var', 'app', 'org.openmw.OpenMW', 'config', 'openmw', 'openmw.cfg'),
		join(home, 'Library', 'Preferences', 'openmw', 'openmw.cfg'),
	].filter((candidate): candidate is string => Boolean(candidate));

	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}

	return null;
}

async function loadOpenMwDataDirectories(): Promise<string[]> {
	const configPath = await findOpenMwConfigPath();
	if (!configPath) {
		return [];
	}

	const configText = await readFile(configPath, 'utf8');
	const directories: string[] = [];

	for (const rawLine of configText.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith('#')) {
			continue;
		}

		const match = line.match(/^(data|data-local)\s*=\s*(.+)$/i);
		if (!match) {
			continue;
		}

		const parsedPath = stripQuotes((match[2] ?? '').trim());
		if (parsedPath.length === 0 || parsedPath.startsWith('?')) {
			continue;
		}

		directories.push(parsedPath);
	}

	return directories;
}

async function findFileCaseInsensitive(
	directory: string,
	fileName: string,
): Promise<string | null> {
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		const match = entries.find(
			(entry) =>
				entry.isFile() &&
				entry.name.toLowerCase() === fileName.toLowerCase(),
		);
		return match ? join(directory, match.name) : null;
	} catch {
		return null;
	}
}

async function loadValidationMasters(
	masterNames: string[],
): Promise<{ masters: MasterFile[]; messages: string[] }> {
	const messages: string[] = [];
	const masters: MasterFile[] = [];
	const dataDirectories = await loadOpenMwDataDirectories();

	if (dataDirectories.length === 0) {
		messages.push(
			'OpenMW data directories could not be located, so reference validation was skipped.',
		);
		return { masters, messages };
	}

	for (const masterName of [...new Set(masterNames)]) {
		let masterPath: string | null = null;
		for (const directory of dataDirectories) {
			masterPath = await findFileCaseInsensitive(directory, masterName);
			if (masterPath) {
				break;
			}
		}

		if (!masterPath) {
			messages.push(
				`Master '${masterName}' could not be found in the configured OpenMW data directories.`,
			);
			continue;
		}

		try {
			const bytes = await readFile(masterPath);
			masters.push([masterName, new Uint8Array(bytes)]);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			messages.push(`Failed to read master '${masterName}': ${message}`);
		}
	}

	return { masters, messages };
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

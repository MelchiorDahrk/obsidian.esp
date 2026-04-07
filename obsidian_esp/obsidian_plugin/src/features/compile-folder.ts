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

/**
 * Recursively scans a folder for Markdown files, excluding those marked as lazy-loaded master references.
 */
function collectMarkdownFiles(app: App, currentFolder: TFolder, files: TFile[]): void {
	for (const child of currentFolder.children) {
		if (child instanceof TFile && child.extension === 'md') {
			const cache = app.metadataCache.getFileCache(child);
			// Skip files that were unpacked as read-only references from a master file
			if (cache?.frontmatter?.Source === 'master') {
				continue;
			}
			files.push(child);
			continue;
		}

		if (child instanceof TFolder) {
			collectMarkdownFiles(app, child, files);
		}
	}
}

/**
 * Converts an absolute vault path to a path relative to the project root.
 */
function toRelativeProjectPath(rootFolder: TFolder, file: TAbstractFile): string {
	return file.path.slice(rootFolder.path.length + 1);
}

/**
 * Checks if a file exists relative to a specific project folder.
 */
function fileExists(rootFolder: TFolder, name: string, app: App): boolean {
	const path = normalizePath(`${rootFolder.path}/${name}`);
	return app.vault.getAbstractFileByPath(path) instanceof TFile;
}

/**
 * Gathers all files required for compiling a plugin from a project folder.
 * This includes the header.md file and all dialogue markdown files within standard subdirectories.
 */
async function collectProjectFiles(
	app: App,
	rootFolder: TFolder,
): Promise<ProjectFile[]> {
	const files: TFile[] = [];

	// Step 1: Collect the optional header file (metadata about the plugin)
	const headerPath = normalizePath(`${rootFolder.path}/header.md`);
	const headerFile = app.vault.getAbstractFileByPath(headerPath);

	if (headerFile instanceof TFile) {
		files.push(headerFile);
	}

	// Step 2: Recursively collect dialogue files from specific supported subdirectories
	for (const folderName of DIALOGUE_FOLDERS) {
		const dialogueFolderPath = normalizePath(`${rootFolder.path}/${folderName}`);
		const dialogueFolder = app.vault.getAbstractFileByPath(dialogueFolderPath);
		if (!(dialogueFolder instanceof TFolder)) {
			continue;
		}

		collectMarkdownFiles(app, dialogueFolder, files);
	}

	// Step 3: Sort files by path to ensure deterministic compilation output
	files.sort((left, right) => left.path.localeCompare(right.path));

	// Step 4: Read file contents and strip Obsidian-internal wikilink syntax for the Rust compiler
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

/**
 * Writes the compiled binary plugin to the vault. Overwrites existing files.
 */
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

/**
 * Writes the compilation log to the vault.
 */
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

/**
 * Locates the master files specified in the project's header.md.
 * Defaults to Morrowind.esm if no header or master section is found.
 */
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

/**
 * Formats a user-readable compilation log combining loading messages and compiler output.
 */
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

/**
 * Compiles a specific folder in the vault into a Morrowind plugin.
 * Handles header confirmation, master file loading, and binary writing.
 * 
 * @param app The Obsidian app instance.
 * @param folder The folder to compile.
 */
export async function compileFolderSelection(
	app: App,
	folder: TFolder,
): Promise<void> {
	try {
		// Step 1: Gather and clean all project files (markdown -> plaintext)
		const projectFiles = await collectProjectFiles(app, folder);
		
		// Step 2: Validate the existence of a header.md file or confirm usage of a default one
		const hasHeader = fileExists(folder, 'header.md', app);
		if (!hasHeader) {
			const shouldContinue = await confirmDefaultHeader(app, folder.name);
			if (!shouldContinue) {
				return;
			}
		}

		// Step 3: Ensure there is actually dialogue to compile
		const hasDialogueMarkdown = projectFiles.some(
			([relativePath]) => relativePath.toLowerCase() !== 'header.md',
		);
		if (!hasDialogueMarkdown) {
			new Notice('No dialogue files were found.');
			return;
		}

		// Step 4: Resolve master files (e.g. Morrowind.esm) required for cross-record validation
		const outputFileName = `${folder.name}_dialogue.esp`;
		const logFileName = `${folder.name}_dialogue.log`;
		const masterNames = extractMasterNames(projectFiles, hasHeader);
		const { masters, messages } = await loadValidationMasters(masterNames);
		
		// Step 5: Invoke the Rust compiler via WASM
		const compileResult = compileProjectWithLog(
			projectFiles,
			!hasHeader,
			masters,
		);
		const { bytes, log } = compileResult;
		
		// Step 6: Write results (plugin and log) back to the vault
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

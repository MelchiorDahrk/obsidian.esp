import { readFile, readdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { App, TFile, TFolder, normalizePath } from 'obsidian';

export type MasterFile = [string, Uint8Array];

const nodeGlobals = globalThis as typeof globalThis & {
	process?: {
		env?: Record<string, string | undefined>;
	};
};

export function extractMasterNamesFromHeaderContent(
	headerContent: string,
): string[] {
	const lines = headerContent.replace(/\r/g, '').split('\n');
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

export async function readHeaderFile(
	app: App,
	folder: TFolder,
): Promise<TFile | null> {
	const headerPath = normalizePath(`${folder.path}/header.md`);
	const headerFile = app.vault.getAbstractFileByPath(headerPath);
	return headerFile instanceof TFile ? headerFile : null;
}

export async function readHeaderMasterNames(
	app: App,
	folder: TFolder,
): Promise<string[] | null> {
	const headerFile = await readHeaderFile(app, folder);
	if (!(headerFile instanceof TFile)) {
		return null;
	}

	const headerContent = await app.vault.read(headerFile);
	return extractMasterNamesFromHeaderContent(headerContent);
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
		join(
			home,
			'.var',
			'app',
			'org.openmw.OpenMW',
			'config',
			'openmw',
			'openmw.cfg',
		),
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

export async function loadValidationMasters(
	masterNames: string[],
): Promise<{ masters: MasterFile[]; messages: string[] }> {
	const messages: string[] = [];
	const masters: MasterFile[] = [];
	const dataDirectories = await loadOpenMwDataDirectories();

	if (dataDirectories.length === 0) {
		messages.push(
			'OpenMW data directories could not be located, so master loading was skipped.',
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
			const message =
				error instanceof Error ? error.message : String(error);
			messages.push(`Failed to read master '${masterName}': ${message}`);
		}
	}

	return { masters, messages };
}

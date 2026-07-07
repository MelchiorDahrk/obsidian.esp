/**
 * @file Master-file discovery and header manipulation.
 *
 * Masters (Morrowind.esm, Tribunal.esm, ...) live outside the vault, so this
 * module bridges to the filesystem: it finds the user's `openmw.cfg`, reads
 * the configured data directories, and loads master binaries from them
 * (case-insensitively — Linux installs often have mixed-case filenames).
 * It also owns the helpers for reading and editing the `Masters:` list in a
 * project's `header.md`.
 *
 * Uses Node `fs/promises` directly, which is available because Obsidian
 * runs on Electron; this code path cannot work on Obsidian Mobile.
 */
import { readFile, readdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { parseYaml, App, TFile, TFolder, normalizePath } from 'obsidian';
import { splitFrontmatter } from '../utils/obsidian-utils';

/** A master file as `[fileName, rawBytes]`, ready to hand to the WASM layer. */
export type MasterFile = [string, Uint8Array];

const nodeGlobals = globalThis as typeof globalThis & {
	process?: {
		env?: Record<string, string | undefined>;
	};
};

/**
 * Reads the `Masters:` list from `header.md` content. Falls back to
 * `['Morrowind.esm']` when the frontmatter is missing or unparseable, so
 * compilation always has at least the base game to validate against.
 */
export function extractMasterNamesFromHeaderContent(
	headerContent: string,
): string[] {
	const { frontmatter } = splitFrontmatter(headerContent);
	if (!frontmatter) {
		return ['Morrowind.esm'];
	}

	try {
		// Remove the --- markers before parsing
		const yamlText = frontmatter.replace(/^---\n/, '').replace(/\n---\n$/, '').trim();
		const data = parseYaml(yamlText);
		const masters = data?.Masters;

		if (Array.isArray(masters)) {
			return masters.map((m) => String(m).trim());
		} else if (masters) {
			return [String(masters).trim()];
		}
	} catch (e) {
		console.warn('Failed to parse Masters from header:', e);
	}

	return ['Morrowind.esm'];
}

/** Returns the `header.md` file directly inside `folder`, if it exists. */
export async function readHeaderFile(
	app: App,
	folder: TFolder,
): Promise<TFile | null> {
	const headerPath = normalizePath(`${folder.path}/header.md`);
	const headerFile = app.vault.getAbstractFileByPath(headerPath);
	return headerFile instanceof TFile ? headerFile : null;
}

/**
 * Reads the master names from a project folder's `header.md`, or `null`
 * when the folder has no header file.
 */
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

/** Removes surrounding double quotes from an openmw.cfg path value. */
function stripQuotes(value: string): string {
	return value.replace(/^"(.*)"$/, '$1').trim();
}

/** Whether a file exists and is readable (probed by attempting a read). */
async function pathExists(path: string): Promise<boolean> {
	try {
		await readFile(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Searches common system paths to locate the OpenMW configuration file.
 * Returns null if the file cannot be found.
 */
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

/**
 * Parses openmw.cfg to extract all configured 'data' and 'data-local' directories.
 */
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

/**
 * Performs a case-insensitive search for a file within a directory.
 */
async function findFileCaseInsensitive(
	directory: string,
	fileName: string,
): Promise<string | null> {
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		const match = entries.find(
			(entry) =>
				(entry.isFile() || entry.isSymbolicLink()) &&
				entry.name.toLowerCase() === fileName.toLowerCase(),
		);
		return match ? join(directory, match.name) : null;
	} catch {
		return null;
	}
}

/**
 * Locates and reads the binary content of the specified master files.
 * It searches iteratively through all directories configured in OpenMW.
 */
export async function loadValidationMasters(
	masterNames: string[],
	onProgress?: (current: number, total: number, name: string) => void,
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

	const uniqueMasterNames = [...new Set(masterNames)];
	const totalMasters = uniqueMasterNames.length;
	let completed = 0;

	const results = await Promise.all(
		uniqueMasterNames.map(async (masterName) => {
			let masterPath: string | null = null;
			for (const directory of dataDirectories) {
				masterPath = await findFileCaseInsensitive(directory, masterName);
				if (masterPath) break;
			}

			if (!masterPath) {
				messages.push(
					`Master '${masterName}' could not be found in the configured OpenMW data directories.`,
				);
				return null;
			}

			try {
				const bytes = await readFile(masterPath);
				const result: MasterFile = [masterName, new Uint8Array(bytes)];
				completed++;
				if (onProgress) {
					onProgress(completed, totalMasters, masterName);
				}
				return result;
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				messages.push(`Failed to read master '${masterName}': ${message}`);
				return null;
			}
		}),
	);

	for (const r of results) {
		if (r) masters.push(r);
	}

	return { masters, messages };
}

/**
 * Returns header content with `masterName` appended to the `Masters:` list
 * (no-op if already present, compared case-insensitively).
 *
 * Handles every header shape the exporter or a user can produce: an existing
 * block list (appends at the end, before trailing blank lines), an inline
 * `Masters: value` (converted to a block list), or no `Masters:` section at
 * all (inserted before the closing `---`). Used when unpacking a database so
 * the unpacked project lists its source plugin as a master.
 */
export function addMasterToHeaderContent(
	headerContent: string,
	masterName: string,
): string {
	const existingMasters = extractMasterNamesFromHeaderContent(headerContent);
	if (
		existingMasters.some((m) => m.toLowerCase() === masterName.toLowerCase())
	) {
		return headerContent;
	}

	const lines = headerContent.split(/\r?\n/);
	const mastersIndex = lines.findIndex((line) =>
		/^Masters:\s*/i.test(line),
	);

	if (mastersIndex !== -1) {
		// Found Masters: line. Check if it has an inline value.
		const match = (lines[mastersIndex] ?? '').match(/^Masters:\s*(.*)$/i);
		const inlineValue = (match?.[1] ?? '').trim();

		if (inlineValue.length > 0) {
			// Convert inline to list
			lines[mastersIndex] = 'Masters:';
			lines.splice(mastersIndex + 1, 0, `  - ${inlineValue}`);
			lines.splice(mastersIndex + 2, 0, `  - ${masterName}`);
		} else {
			// Find end of the list
			let insertIndex = mastersIndex + 1;
			while (
				insertIndex < lines.length &&
				(lines[insertIndex] ?? '').trim() !== '---' &&
				(/^\s*-/.test(lines[insertIndex] ?? '') ||
					(lines[insertIndex] ?? '').trim() === '')
			) {
				insertIndex++;
			}
			// Backtrack empty lines
			while (
				insertIndex > mastersIndex + 1 &&
				(lines[insertIndex - 1] ?? '').trim() === ''
			) {
				insertIndex--;
			}
			lines.splice(insertIndex, 0, `  - ${masterName}`);
		}
	} else {
		// No Masters: section found. Insert before the closing ---
		const closingIndex = lines.lastIndexOf('---');
		if (closingIndex !== -1) {
			lines.splice(closingIndex, 0, 'Masters:', `  - ${masterName}`);
		} else {
			// Fallback: just append
			lines.push('Masters:', `  - ${masterName}`);
		}
	}

	return lines.join('\n');
}

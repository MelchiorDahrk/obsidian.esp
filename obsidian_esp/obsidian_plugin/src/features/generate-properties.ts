/**
 * @file The "Generate property files" feature.
 *
 * Writes one `{master}_properties.md` note per selected master into the
 * project's `Properties/` folder. Each note is pure frontmatter listing every
 * valid value for the dialogue frontmatter fields (Faction, Race, Class, ID,
 * Cell, plus static enumerations like Sex and Rank). Obsidian's property
 * editor aggregates values across the vault, so these notes power
 * autocomplete dropdowns when editing dialogue frontmatter.
 */
import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import * as obsidianEsp from '../../pkg/obsidian_esp.js';
import {
	loadValidationMasters,
	readHeaderMasterNames,
} from './master-files';
import {
	PropertyExtractionOptions,
	selectPropertyGenerationOptions,
} from '../ui/property-generation-modal';

/** Value sets returned by the WASM `extract_property_values` call. */
interface MasterPropertyValues {
	factions: string[];
	races: string[];
	classes: string[];
	/** NPC and creature IDs. */
	ids: string[];
	cells: string[];
}

const extractPropertyValues = obsidianEsp.extract_property_values as (
	array: Uint8Array,
	options: PropertyExtractionOptions,
) => MasterPropertyValues;

/** Sentinel offered in the Faction dropdowns for "no faction required". */
const NO_FACTION = '_NO FACTION_';

/** The six filter-slot keys; each gets the same filter-type value list. */
const FUNCTION_KEYS = [
	'Function0',
	'Function1',
	'Function2',
	'Function3',
	'Function4',
	'Function5',
];

/** Frontmatter fields whose value sets are fixed by the engine. */
const STATIC_PROPERTIES: Array<[string, string[]]> = [
	['Type', ['Greeting', 'Journal', 'Persuasion', 'Topic', 'Voice']],
	['Sex', ['Female', 'Male']],
	[
		'Rank',
		[
			'Rank 0',
			'Rank 1',
			'Rank 2',
			'Rank 3',
			'Rank 4',
			'Rank 5',
			'Rank 6',
			'Rank 7',
			'Rank 8',
			'Rank 9',
		],
	],
	[
		'PC Rank',
		[
			'Rank 0',
			'Rank 1',
			'Rank 2',
			'Rank 3',
			'Rank 4',
			'Rank 5',
			'Rank 6',
			'Rank 7',
			'Rank 8',
			'Rank 9',
		],
	],
	['File Type', ['ESM', 'ESP']],
];

/** Valid `FunctionN` filter types (mirrors the Rust parser's spellings). */
const STATIC_FUNCTION_VALUES = [
	'Function',
	'Global',
	'Local',
	'Journal',
	'Item',
	'Dead',
	'Not ID',
	'Not Faction',
	'Not Class',
	'Not Race',
	'Not Cell',
	'Not Local',
];

/** Replaces filesystem-reserved and control characters with underscores. */
function sanitizeFileName(input: string): string {
	const sanitized = [...input]
		.map((character) => {
			const isReserved = '<>:"/\\|?*'.includes(character);
			const isControlCharacter = character.charCodeAt(0) < 32;
			return isReserved || isControlCharacter ? '_' : character;
		})
		.join('')
		.replace(/[. ]+$/g, '')
		.trim();

	return sanitized.length > 0 ? sanitized : 'master';
}

/**
 * Dedupes case-insensitively (keeping the first spelling seen), drops blank
 * entries, and sorts case-insensitively.
 */
function uniqueValues(values: string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];

	for (const value of values) {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			continue;
		}

		const normalized = trimmed.toLowerCase();
		if (seen.has(normalized)) {
			continue;
		}

		seen.add(normalized);
		unique.push(trimmed);
	}

	return unique.sort((left, right) =>
		left.localeCompare(right, undefined, { sensitivity: 'base' }),
	);
}

/** Quotes a value for YAML (JSON string syntax is valid YAML). */
function renderYamlString(value: string): string {
	return JSON.stringify(value);
}

/**
 * Renders a property note's full content: a frontmatter-only document with
 * one list per property, combining the static value sets with the values
 * extracted from the master.
 */
function renderPropertyFile(
	values: MasterPropertyValues,
	options: PropertyExtractionOptions,
): string {
	const properties: Array<[string, string[]]> = [...STATIC_PROPERTIES];

	for (const functionKey of FUNCTION_KEYS) {
		properties.push([functionKey, STATIC_FUNCTION_VALUES]);
	}

	const factionValues = uniqueValues([NO_FACTION, ...values.factions]);
	properties.push(['Faction', factionValues]);
	properties.push(['PC Faction', factionValues]);

	if (options.include_races) {
		const raceValues = uniqueValues(values.races);
		if (raceValues.length > 0) {
			properties.push(['Race', raceValues]);
		}
	}

	if (options.include_classes) {
		const classValues = uniqueValues(values.classes);
		if (classValues.length > 0) {
			properties.push(['Class', classValues]);
		}
	}

	if (options.include_ids) {
		const idValues = uniqueValues(values.ids);
		if (idValues.length > 0) {
			properties.push(['ID', idValues]);
		}
	}

	if (options.include_cells) {
		const cellValues = uniqueValues(values.cells);
		if (cellValues.length > 0) {
			properties.push(['Cell', cellValues]);
		}
	}

	let output = '---\n';
	for (const [key, propertyValues] of properties) {
		output += `${key}:\n`;
		for (const propertyValue of propertyValues) {
			output += `  - ${renderYamlString(propertyValue)}\n`;
		}
	}
	output += '---\n';

	return output;
}

/** Creates the folder if missing; throws if the path is occupied by a file. */
async function ensureFolder(app: App, path: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) {
		return;
	}

	if (existing) {
		throw new Error(`'${path}' already exists and is not a folder.`);
	}

	await app.vault.createFolder(path);
}

/** Creates or overwrites a Markdown file at the given vault path. */
async function writeMarkdownFile(
	app: App,
	path: string,
	content: string,
): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(path);

	if (existing instanceof TFile) {
		await app.vault.process(existing, () => content);
		return;
	}

	if (existing) {
		throw new Error(`'${path}' already exists and is not a markdown file.`);
	}

	await app.vault.create(path, content);
}

/** Builds the summary Notice text with correct pluralization. */
function buildCompletionNotice(
	writtenCount: number,
	skippedCount: number,
): string {
	let message = `Generated ${writtenCount} property file`;
	if (writtenCount !== 1) {
		message += 's';
	}
	message += '.';

	if (skippedCount > 0) {
		message += ` Skipped ${skippedCount} master`;
		if (skippedCount !== 1) {
			message += 's';
		}
		message += ' that could not be loaded.';
	}

	return message;
}

/**
 * Feature entry point: reads the project's master list from `header.md`,
 * asks the user which masters/value categories to include, extracts values
 * via WASM, and writes the property notes into `{folder}/Properties/`.
 */
export async function generatePropertyFilesForFolder(
	app: App,
	folder: TFolder,
): Promise<void> {
	try {
		const masterNames = await readHeaderMasterNames(app, folder);
		if (!masterNames) {
			new Notice(
				`No header.md file was found directly inside "${folder.name}".`,
			);
			return;
		}

		const selection = await selectPropertyGenerationOptions(app, masterNames);
		if (!selection) {
			return;
		}

		const { masters, messages } = await loadValidationMasters(
			selection.selectedMasters,
		);
		if (masters.length === 0) {
			const detail =
				messages[0] ?? 'The selected master files could not be loaded.';
			new Notice(detail, 10000);
			return;
		}

		const propertiesFolderPath = normalizePath(`${folder.path}/Properties`);
		await ensureFolder(app, propertiesFolderPath);

		for (const [masterName, bytes] of masters) {
			const propertyValues = extractPropertyValues(
				bytes,
				selection.options,
			);
			const fileName = `${sanitizeFileName(masterName)}_properties.md`;
			const filePath = normalizePath(`${propertiesFolderPath}/${fileName}`);
			const content = renderPropertyFile(
				propertyValues,
				selection.options,
			);
			await writeMarkdownFile(app, filePath, content);
		}

		new Notice(
			buildCompletionNotice(
				masters.length,
				selection.selectedMasters.length - masters.length,
			),
		);

		if (messages.length > masters.length) {
			const firstProblem = messages.find((message) =>
				message.includes('could not'),
			);
			if (firstProblem) {
				new Notice(firstProblem, 10000);
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Failed to generate property files: ${message}`, 10000);
	}
}

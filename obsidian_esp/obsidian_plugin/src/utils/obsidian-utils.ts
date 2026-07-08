/**
 * @file Frontmatter access helpers shared across features.
 *
 * The central concern here is *opaque string preservation*: dialogue IDs
 * (`DiagID`/`PrevID`) are numeric strings up to 20 digits, which exceeds
 * `Number.MAX_SAFE_INTEGER`. Obsidian's metadata cache parses unquoted YAML
 * numbers as JS numbers, silently corrupting the low digits. Whenever the
 * cache hands back a number for one of those keys, we re-read the raw
 * frontmatter text and restore the exact string.
 */
import { App, TFile } from 'obsidian';

/**
 * Frontmatter keys whose values must be treated as opaque strings, never
 * numbers, because they can exceed JS float precision.
 */
const OPAQUE_STRING_FRONTMATTER_KEYS = ['DiagID', 'PrevID'] as const;

/**
 * Pulls a single key's raw (unparsed) text value out of a frontmatter block,
 * bypassing YAML number coercion entirely.
 */
function extractRawFrontmatterValue(
	frontmatter: string,
	keyToFind: string,
): string | undefined {
	const lines = frontmatter
		.replace(/^---\r?\n/, '')
		.replace(/\r?\n---\r?\n?$/, '')
		.split(/\r?\n/);

	for (const line of lines) {
		const colonIndex = line.indexOf(':');
		if (colonIndex === -1) {
			continue;
		}

		const key = line.substring(0, colonIndex).trim();
		if (key !== keyToFind) {
			continue;
		}

		return line.substring(colonIndex + 1).trim();
	}

	return undefined;
}

/**
 * Detects whether the metadata cache coerced any opaque-string key into a
 * number (the precision-corruption case described in the file header).
 */
function frontmatterHasCoercedOpaqueValue(frontmatter: Record<string, any>): boolean {
	return OPAQUE_STRING_FRONTMATTER_KEYS.some(
		(key) => typeof frontmatter[key] === 'number',
	);
}

/**
 * Returns a copy of the cached frontmatter with every number-coerced opaque
 * key replaced by its exact raw string from the file text.
 */
function preserveOpaqueStringValues(
	frontmatter: Record<string, any>,
	rawFrontmatter: string,
): Record<string, any> {
	const updated = Object.assign({}, frontmatter);

	for (const key of OPAQUE_STRING_FRONTMATTER_KEYS) {
		if (typeof updated[key] !== 'number') {
			continue;
		}

		const rawValue = extractRawFrontmatterValue(rawFrontmatter, key);
		if (rawValue !== undefined) {
			updated[key] = rawValue;
		}
	}

	return updated;
}

/**
 * Retrieves the frontmatter for a file, using the metadata cache if available,
 * otherwise falling back to reading and parsing the file directly.
 */
export async function getFrontmatter(app: App, file: TFile): Promise<Record<string, any> | undefined> {
	const cache = app.metadataCache.getFileCache(file);
	if (cache?.frontmatter) {
		if (!frontmatterHasCoercedOpaqueValue(cache.frontmatter)) {
			return cache.frontmatter;
		}

		const content = await app.vault.read(file);
		const { frontmatter } = splitFrontmatter(content);
		return preserveOpaqueStringValues(cache.frontmatter, frontmatter);
	}

	const content = await app.vault.read(file);
	const { frontmatter } = splitFrontmatter(content);
	if (!frontmatter) return undefined;

	return parseBasicFrontmatter(frontmatter);
}

/**
 * Manually parses frontmatter key-value pairs from a string.
 * Used as a fallback when Obsidian's metadata cache is not yet available.
 */
export function parseBasicFrontmatter(fmText: string): Record<string, any> {
	const result: Record<string, any> = {};
	const lines = fmText.replace(/^---\r?\n/, '').replace(/\r?\n---\r?\n?$/, '').split(/\r?\n/);
	for (const line of lines) {
		const colonIndex = line.indexOf(':');
		if (colonIndex !== -1) {
			const key = line.substring(0, colonIndex).trim();
			const value = line.substring(colonIndex + 1).trim();
			result[key] = value;
		}
	}
	return result;
}

/**
 * Splits a markdown string into its frontmatter block and body.
 */
export function splitFrontmatter(content: string): {
	frontmatter: string;
	body: string;
} {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (match) {
		return {
			frontmatter: match[0],
			body: content.slice(match[0].length),
		};
	}
	return { frontmatter: '', body: content };
}

/**
 * Merges frontmatter and body back into a single string.
 */
export function mergeFrontmatter(frontmatter: string, body: string): string {
	return frontmatter + body;
}

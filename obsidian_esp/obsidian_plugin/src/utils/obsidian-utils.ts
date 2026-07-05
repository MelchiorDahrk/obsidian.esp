import { App, TFile } from 'obsidian';

const OPAQUE_STRING_FRONTMATTER_KEYS = ['DiagID', 'PrevID'] as const;

function extractRawFrontmatterValue(
	frontmatter: string,
	keyToFind: string,
): string | undefined {
	const lines = frontmatter
		.replace(/^---\n/, '')
		.replace(/\n---\n$/, '')
		.split('\n');

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

function frontmatterHasCoercedOpaqueValue(frontmatter: Record<string, any>): boolean {
	return OPAQUE_STRING_FRONTMATTER_KEYS.some(
		(key) => typeof frontmatter[key] === 'number',
	);
}

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
	const lines = fmText.replace(/^---\n/, '').replace(/\n---\n$/, '').split('\n');
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
	const match = content.match(/^---\n([\s\S]*?)\n---\n/);
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

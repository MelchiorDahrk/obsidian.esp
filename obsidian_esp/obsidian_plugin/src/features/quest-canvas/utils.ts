/**
 * @file Pure helper functions shared across the quest-canvas package:
 * wikilink/topic normalization, text measurement for canvas node sizing,
 * frontmatter value access, and stable ID hashing. Everything here is
 * side-effect-free and independent of Obsidian APIs, which keeps it usable
 * from the headless canvas harness.
 */
import {
	APPROX_TEXT_CHAR_WIDTH,
	type Condition,
	DIALOGUE_TYPES,
	type DialogueType,
	FILE_NODE_MIN_HEIGHT,
	FILE_NODE_PADDING_Y,
	type FrontmatterValue,
	TEXT_NODE_HORIZONTAL_PADDING,
} from './model';

/** Returns the distinct topic names wiki-linked from a dialogue body, in order. */
export function extractBodyTopicLinks(bodyText: string): string[] {
	const topics: string[] = [];
	const seen = new Set<string>();
	const linkPattern = /\[\[([^\]]+)\]\]/g;
	let match = linkPattern.exec(bodyText);
	while (match) {
		const topic = normalizeWikilinkTopic(match[1] ?? '');
		const topicKey = normalizeTopicKey(topic);
		if (topic.length > 0 && !seen.has(topicKey)) {
			topics.push(topic);
			seen.add(topicKey);
		}
		match = linkPattern.exec(bodyText);
	}
	return topics;
}

/**
 * Reduces a raw wikilink target (`path/To/Topic.md#heading|alias`) to the
 * bare topic name: alias and heading stripped, path and `.md` removed.
 */
export function normalizeWikilinkTopic(rawLink: string): string {
	const linkTarget = (rawLink.split('|')[0] ?? rawLink)
		.split('#')[0]
		?.trim() ?? '';
	const pathParts = linkTarget.split('/');
	const fileName = pathParts[pathParts.length - 1] ?? linkTarget;
	return fileName.replace(/\.md$/i, '').trim();
}

/** `Math.max` that returns `null` instead of `-Infinity` for empty input. */
export function maxNumber(values: number[]): number | null {
	return values.length > 0 ? Math.max(...values) : null;
}

/** Estimates the pixel height a dialogue body needs at the given card width. */
export function measureCanvasBodyHeight(bodyText: string, width: number): number {
	const visibleText = normalizeCanvasBodyText(bodyText);
	if (visibleText.length === 0) {
		return FILE_NODE_MIN_HEIGHT;
	}

	return Math.max(FILE_NODE_MIN_HEIGHT, measureTextHeight(visibleText, width) + FILE_NODE_PADDING_Y);
}

/** Builds a wikilink target (basename without `.md`, plus optional subpath). */
export function toWikilinkTarget(filePath: string, subpath?: string | null): string {
	const fileName = filePath.split('/').pop() ?? filePath;
	const linkPath = fileName.replace(/\.md$/i, '');
	return `${linkPath}${subpath ?? ''}`;
}

/** Increments a per-phase counter map (used for edge in/out degree tallies). */
export function incrementPhaseCount(target: Map<number, number>, phaseValue: number): void {
	target.set(phaseValue, (target.get(phaseValue) ?? 0) + 1);
}

/** First sentence of the first non-empty line (block IDs stripped). */
export function firstSentence(text: string): string {
	const line = firstNonEmptyLine(text);
	if (!line) {
		return '';
	}

	const sentenceMatch = stripBlockId(line).match(/^(.+?[.!?])(?:\s|$)/);
	return sentenceMatch?.[1] ?? stripBlockId(line);
}

/** First line with visible content, trimmed, or `null` if all blank. */
export function firstNonEmptyLine(text: string): string | null {
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	return null;
}

/** Removes a trailing Obsidian `^block-id` from a line. */
export function stripBlockId(text: string): string {
	return text.replace(/\s+\^[A-Za-z0-9_-]+$/, '').trim();
}

/** The trailing `^block-id` of a line (without the caret), or `null`. */
export function trailingBlockId(text: string): string | null {
	const match = text.match(/\s+\^([A-Za-z0-9_-]+)\s*$/);
	return match?.[1] ?? null;
}

/**
 * Canonical key for comparing quest names across folders/files: lowercase
 * with all non-alphanumerics collapsed to single spaces. Two journal topics
 * with the same key are treated as parts of one quest.
 */
export function normalizeQuestNameKey(text: string | null): string | null {
	if (!text) {
		return null;
	}

	const normalized = stripWikilinkSyntax(stripBlockId(text))
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
	return normalized.length > 0 ? normalized : null;
}

/** Canonical key for comparing topic names (lowercase, collapsed spaces). */
export function normalizeTopicKey(text: string): string {
	return stripWikilinkSyntax(stripQuotes(text))
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

/** Replaces `[[target|alias]]` syntax with its visible text. */
export function stripWikilinkSyntax(text: string): string {
	return text.replace(/\[\[(?:[^|\]]*?\|)?([^|\]]*?)\]\]/g, '$1').trim();
}

/** Order-independent identity key for a condition set (for family grouping). */
export function normalizeConditionKey(conditions: Condition[]): string {
	return conditions.map((condition) => condition.displayText).sort().join('|');
}

/** Replaces filesystem-reserved and control characters with underscores. */
export function sanitizeFileName(input: string): string {
	const sanitized = [...input]
		.map((character) => {
			const reserved = '<>:"/\\|?*'.includes(character);
			const control = character.charCodeAt(0) < 32;
			return reserved || control ? '_' : character;
		})
		.join('')
		.replace(/[. ]+$/g, '')
		.trim();
	return sanitized.length > 0 ? sanitized : 'quest';
}

/** Removes leading/trailing double quotes. */
export function stripQuotes(text: string): string {
	return text.replace(/^"|"$/g, '');
}

/** Frontmatter value as a string (first element when it's a list). */
export function getStringValue(frontmatter: Record<string, FrontmatterValue>, key: string): string | undefined {
	const value = frontmatter[key];
	if (typeof value === 'string') {
		return value;
	}
	if (Array.isArray(value)) {
		return value[0];
	}
	return undefined;
}

/** Frontmatter value interpreted as a boolean (`"true"`, case-insensitive). */
export function getBooleanValue(frontmatter: Record<string, FrontmatterValue>, key: string): boolean {
	return getStringValue(frontmatter, key)?.toLowerCase() === 'true';
}

/** Type guard for the canvas-relevant dialogue types. */
export function isDialogueType(value: string): value is DialogueType {
	return DIALOGUE_TYPES.includes(value as DialogueType);
}

/** Dedupes case-insensitively, keeping first spelling and input order. */
export function uniqueValues(values: string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const value of values) {
		const normalized = value.trim().toLowerCase();
		if (normalized.length === 0 || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		unique.push(value.trim());
	}
	return unique;
}

/** Distinct values in ascending order. */
export function uniqueNumbers(values: number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

/** Ascending comparator that sorts `null` after every number. */
export function compareNullableNumbers(left: number | null, right: number | null): number {
	if (left === null && right === null) {
		return 0;
	}
	if (left === null) {
		return 1;
	}
	if (right === null) {
		return -1;
	}
	return left - right;
}

/**
 * Estimates the pixel height of a text node: ~24px per (wrapped) line plus
 * chrome, floored at 50px. Pass `width` to account for soft wrapping.
 */
export function measureTextHeight(text: string, width?: number): number {
	const lineCount = width ? estimateWrappedLineCount(text, width) : Math.max(1, text.split('\n').length);
	return Math.max(50, 26 + lineCount * 24);
}

/**
 * Approximates how many display lines the text occupies at the given node
 * width, using the average character width from model.ts (the canvas is not
 * rendered at layout time, so this is heuristic by necessity).
 */
export function estimateWrappedLineCount(text: string, width: number): number {
	const availableWidth = Math.max(80, width - TEXT_NODE_HORIZONTAL_PADDING);
	const maxCharsPerLine = Math.max(10, Math.floor(availableWidth / APPROX_TEXT_CHAR_WIDTH));
	let lineCount = 0;

	for (const rawLine of text.split('\n')) {
		const normalizedLine = rawLine.trim().replace(/\s+/g, ' ');
		if (normalizedLine.length === 0) {
			lineCount += 1;
			continue;
		}

		lineCount += Math.max(1, Math.ceil(normalizedLine.length / maxCharsPerLine));
	}

	return Math.max(1, lineCount);
}

/**
 * Body text as the canvas displays it: trailing whitespace removed per line,
 * the block ID stripped from the last visible line, and outer blank lines
 * trimmed. Used both for height measurement and content comparison.
 */
export function normalizeCanvasBodyText(text: string): string {
	let lastNonEmptyLine = -1;
	const lines = text.split('\n');
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if ((lines[index] ?? '').trim().length > 0) {
			lastNonEmptyLine = index;
			break;
		}
	}

	return text
		.split('\n')
		.map((line, index) => {
			return index === lastNonEmptyLine ? stripBlockId(line).trimEnd() : line.trimEnd();
		})
		.join('\n')
		.trim();
}

/** Deterministic node ID from a semantic seed (same input -> same ID). */
export function createNodeId(seed: string): string {
	return stableHash(seed);
}

/** Deterministic edge ID, namespaced apart from node IDs. */
export function createEdgeId(seed: string): string {
	return stableHash(`edge:${seed}`);
}

/**
 * 64-bit stable hash rendered as 16 hex chars (two interleaved 32-bit
 * FNV-style hashes). Deterministic IDs are what make refresh-mode merging
 * possible: regenerating a canvas yields the same IDs for the same content.
 */
export function stableHash(value: string): string {
	let left = 0x811c9dc5;
	let right = 0x01000193;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		left ^= code;
		left = Math.imul(left, 0x01000193);
		right ^= code;
		right = Math.imul(right, 0x27d4eb2d);
	}
	const leftHex = (left >>> 0).toString(16).padStart(8, '0');
	const rightHex = (right >>> 0).toString(16).padStart(8, '0');
	return `${leftHex}${rightHex}`;
}

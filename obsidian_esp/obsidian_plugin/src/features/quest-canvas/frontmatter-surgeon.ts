import { type GateLine, gateLineToFrontmatter, SPEAKER_FIELDS } from './cards';
import { type FrontmatterValue, QUEST_NAME_FIELD } from './model';
import { stripQuotes } from './utils';

export const KNOWN_FRONTMATTER_KEYS = new Set([
	'Source',
	'Type',
	'Topic',
	'DiagID',
	'PrevID',
	'Index',
	QUEST_NAME_FIELD,
	'Finished',
	'Restart',
	'canvas',
	'Disposition',
	'ID',
	'Race',
	'Sex',
	'Class',
	'Faction',
	'Rank',
	'Cell',
	'PC Faction',
	'PC Rank',
	'Result',
]);

export function parseStructuredFrontmatter(frontmatter: string): Record<string, FrontmatterValue> {
	if (frontmatter.length === 0) {
		return {};
	}

	const rawLines = frontmatter
		.replace(/^---\n/, '')
		.replace(/\n---\n?$/, '')
		.split('\n');
	const parsed: Record<string, FrontmatterValue> = {};

	for (let index = 0; index < rawLines.length; index += 1) {
		const line = rawLines[index] ?? '';
		if (!/^\S.*?:/.test(line)) {
			continue;
		}

		const separator = line.indexOf(':');
		const key = line.slice(0, separator).trim();
		const rawValue = line.slice(separator + 1).trim();

		if (rawValue === '|' || rawValue === '|-') {
			const multiline: string[] = [];
			let nextIndex = index + 1;
			while (nextIndex < rawLines.length && /^\s+/.test(rawLines[nextIndex] ?? '')) {
				multiline.push((rawLines[nextIndex] ?? '').replace(/^\s{2}/, ''));
				nextIndex += 1;
			}
			parsed[key] = multiline.join('\n').trimEnd();
			index = nextIndex - 1;
			continue;
		}

		if (rawValue.length === 0) {
			const arrayValues: string[] = [];
			let nextIndex = index + 1;
			while (nextIndex < rawLines.length && /^\s*-\s+/.test(rawLines[nextIndex] ?? '')) {
				arrayValues.push(stripQuotes((rawLines[nextIndex] ?? '').replace(/^\s*-\s+/, '').trim()));
				nextIndex += 1;
			}

			parsed[key] = arrayValues.length > 0 ? arrayValues : '';
			index = nextIndex - 1;
			continue;
		}

		parsed[key] = stripQuotes(rawValue);
	}

	return parsed;
}

// ---------------------------------------------------------------------------
// Frontmatter surgeon — format-preserving note writes.
//
// The Rust exporter/compiler round-trips these files, so writes must never
// re-serialize the YAML: empty keys (`Race:`), `Result: |` block scalars,
// key order, and unknown keys all stay byte-identical. Every operation below
// is line surgery on the raw text; `app.fileManager.processFrontMatter` is
// deliberately not used anywhere in this package.
// ---------------------------------------------------------------------------

interface FrontmatterSections {
	/** Lines between the two `---` delimiters (exclusive). */
	lines: string[];
	/** Everything after the closing `---`, verbatim (including its newline). */
	body: string;
	hadFrontmatter: boolean;
}

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---(?=\n|$)/;

function splitSections(content: string): FrontmatterSections {
	const match = content.match(FRONTMATTER_PATTERN);
	if (!match) {
		return { lines: [], body: content, hadFrontmatter: false };
	}

	return {
		lines: (match[1] ?? '').split('\n'),
		body: content.slice(match[0].length),
		hadFrontmatter: true,
	};
}

function joinSections(sections: FrontmatterSections): string {
	return `---\n${sections.lines.join('\n')}\n---${sections.body}`;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keyLineIndex(lines: string[], key: string): number {
	const pattern = new RegExp(`^${escapeRegExp(key)}:`);
	return lines.findIndex((line) => pattern.test(line));
}

/** Index just past a key line's continuation lines (block scalar / list items). */
function continuationEnd(lines: string[], keyIndex: number): number {
	let end = keyIndex + 1;
	while (end < lines.length && /^\s/.test(lines[end] ?? '') && (lines[end] ?? '').trim().length > 0) {
		end += 1;
	}
	return end;
}

/**
 * Sets a scalar key, preserving its position. An empty value keeps the
 * exporter's `Key:` form. Missing keys are appended before the closing
 * delimiter.
 */
export function setFrontmatterKey(content: string, key: string, value: string): string {
	const sections = splitSections(content);
	const rendered = value.length > 0 ? `${key}: ${value}` : `${key}:`;
	if (!sections.hadFrontmatter) {
		return `---\n${rendered}\n---\n${content}`;
	}

	const index = keyLineIndex(sections.lines, key);
	if (index === -1) {
		sections.lines.push(rendered);
	} else {
		sections.lines.splice(index, continuationEnd(sections.lines, index) - index, rendered);
	}
	return joinSections(sections);
}

export function removeFrontmatterKey(content: string, key: string): string {
	const sections = splitSections(content);
	if (!sections.hadFrontmatter) {
		return content;
	}

	const index = keyLineIndex(sections.lines, key);
	if (index === -1) {
		return content;
	}

	sections.lines.splice(index, continuationEnd(sections.lines, index) - index);
	return joinSections(sections);
}

/**
 * Rewrites the `Result:` value while preserving the note's scalar style:
 * an existing `Result: |` block stays a block (with its indentation), an
 * inline `Result: Goodbye` stays inline while it fits on one line.
 */
export function setResultLines(content: string, resultLines: string[]): string {
	const sections = splitSections(content);
	if (!sections.hadFrontmatter) {
		return setFrontmatterKey(content, 'Result', resultLines.join('\n'));
	}

	const index = keyLineIndex(sections.lines, 'Result');
	const end = index === -1 ? -1 : continuationEnd(sections.lines, index);
	const existingKeyLine = index === -1 ? '' : sections.lines[index] ?? '';
	const wasBlock = /^Result:\s*\|/.test(existingKeyLine);
	const existingIndent = index !== -1 && end > index + 1
		? (sections.lines[index + 1] ?? '').match(/^\s*/)?.[0] ?? '  '
		: '  ';

	const rendered: string[] = [];
	if (resultLines.length === 0) {
		rendered.push('Result:');
	} else if (resultLines.length === 1 && !wasBlock) {
		rendered.push(`Result: ${resultLines[0]}`);
	} else {
		rendered.push('Result: |');
		for (const line of resultLines) {
			rendered.push(`${existingIndent}${line}`);
		}
	}

	if (index === -1) {
		// Exporter order puts Result just before the filter slots.
		const firstFilterIndex = sections.lines.findIndex((line) => /^Function\d:/.test(line));
		const insertAt = firstFilterIndex === -1 ? sections.lines.length : firstFilterIndex;
		sections.lines.splice(insertAt, 0, ...rendered);
	} else {
		sections.lines.splice(index, end - index, ...rendered);
	}
	return joinSections(sections);
}

/**
 * Writes one `Function<n>`/`Variable<n>` filter slot pair, replacing the
 * existing lines in place or appending a new adjacent pair after the last
 * existing slot.
 */
export function setFilterSlot(
	content: string,
	slot: number,
	functionValue: string,
	variableValue: string,
): string {
	const sections = splitSections(content);
	if (!sections.hadFrontmatter) {
		return content;
	}

	const functionLine = `Function${slot}: ${functionValue}`;
	const variableLine = `Variable${slot}: ${variableValue}`;
	const functionIndex = keyLineIndex(sections.lines, `Function${slot}`);
	const variableIndex = keyLineIndex(sections.lines, `Variable${slot}`);

	if (functionIndex !== -1) {
		sections.lines[functionIndex] = functionLine;
	}
	if (variableIndex !== -1) {
		sections.lines[variableIndex] = variableLine;
	}
	if (functionIndex !== -1 && variableIndex !== -1) {
		return joinSections(sections);
	}
	if (functionIndex !== -1 && variableIndex === -1) {
		sections.lines.splice(functionIndex + 1, 0, variableLine);
		return joinSections(sections);
	}
	if (functionIndex === -1 && variableIndex !== -1) {
		sections.lines.splice(variableIndex, 0, functionLine);
		return joinSections(sections);
	}

	// Neither line exists: insert the pair after the last filter slot line,
	// falling back to just after the Result block, then to the end.
	let insertAt = -1;
	for (let lineIndex = 0; lineIndex < sections.lines.length; lineIndex += 1) {
		if (/^(Function|Variable)\d:/.test(sections.lines[lineIndex] ?? '')) {
			insertAt = lineIndex + 1;
		}
	}
	if (insertAt === -1) {
		const resultIndex = keyLineIndex(sections.lines, 'Result');
		insertAt = resultIndex === -1 ? sections.lines.length : continuationEnd(sections.lines, resultIndex);
	}
	sections.lines.splice(insertAt, 0, functionLine, variableLine);
	return joinSections(sections);
}

export function clearFilterSlot(content: string, slot: number): string {
	let next = removeFrontmatterKey(content, `Function${slot}`);
	next = removeFrontmatterKey(next, `Variable${slot}`);
	return next;
}

/** Highest filter slot index the compiler accepts (spec §6: slots 0–5). */
export const MAX_FILTER_SLOT = 5;

/**
 * Applies a full set of parsed gate lines to a note: speaker keys are set
 * (or blanked back to the exporter's empty `Key:` form when the card no
 * longer lists them), and filter slots are re-allocated compactly in card
 * order. Slots beyond the new filter count are cleared.
 */
export function applyGateLines(content: string, gateLines: GateLine[]): string {
	let next = content;
	const current = parseStructuredFrontmatter(next.match(FRONTMATTER_PATTERN)?.[0] ?? '');

	const speakerValues = new Map<string, string>();
	for (const line of gateLines) {
		if (line.kind === 'speaker') {
			speakerValues.set(line.field, line.value);
		}
	}
	for (const field of SPEAKER_FIELDS) {
		const desired = speakerValues.get(field);
		if (desired !== undefined) {
			next = setFrontmatterKey(next, field, desired);
			continue;
		}

		const existing = current[field];
		if (typeof existing === 'string' && existing.length > 0) {
			// Keep the key line, exporter-style, but blank its value.
			next = setFrontmatterKey(next, field, '');
		}
	}

	const filterSlots: Array<{ functionValue: string; variableValue: string }> = [];
	for (const line of gateLines) {
		if (line.kind === 'speaker') {
			continue;
		}
		const slot = gateLineToFrontmatter(line);
		if ('functionValue' in slot) {
			filterSlots.push(slot);
		}
	}
	for (let slot = 0; slot < filterSlots.length; slot += 1) {
		const filterSlot = filterSlots[slot];
		if (!filterSlot) {
			continue;
		}
		next = setFilterSlot(next, slot, filterSlot.functionValue, filterSlot.variableValue);
	}
	for (let slot = filterSlots.length; slot <= Math.max(MAX_FILTER_SLOT, 9); slot += 1) {
		next = clearFilterSlot(next, slot);
	}

	return next;
}

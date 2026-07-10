/**
 * @file Card text grammar: parsing and rendering of gate/result card content.
 *
 * Two layers live here. The *analysis* layer (top half) parses note
 * frontmatter filters into {@link Condition}s and `Result:` scripts into
 * {@link ResultAction}s for discovery and family grouping. The *bidirectional
 * grammar* layer (bottom half, see the section comment) parses and renders
 * the text shown on gate/result cards so that user edits on the canvas can
 * be written back into note frontmatter losslessly.
 */
import {
	type Condition,
	type FrontmatterValue,
	type MilestoneLink,
	NUMERIC_OPERATOR_PATTERN,
	type NumericOperator,
	type ResultAction,
} from './model';
import { getStringValue, resultTextLines, stripQuotes, stripWikilinkSyntax, toWikilinkTarget } from './utils';

/** Splits a `Label = value` speaker-condition display string, if it is one. */
export function parseSpeakerConditionDisplayText(displayText: string): { label: string; value: string } | null {
	const separator = displayText.indexOf(' = ');
	if (separator === -1) {
		return null;
	}

	return {
		label: displayText.slice(0, separator),
		value: displayText.slice(separator + 3),
	};
}

/**
 * Parses a dialogue note's frontmatter into display-ready {@link Condition}s:
 * the fixed speaker fields plus each `FunctionN`/`VariableN` filter slot,
 * classified as journal/choice/item/variable/other. Returned in canonical
 * display order ({@link orderConditions}).
 */
export function parseConditions(frontmatter: Record<string, FrontmatterValue>, questIds: string[]): Condition[] {
	const conditions: Condition[] = [];
	const speakerFields: Array<[string, string]> = [
		['Disposition', 'Disposition'],
		['Sex', 'Sex'],
		['Race', 'Race'],
		['Class', 'Class'],
		['Faction', 'Faction'],
		['Rank', 'Rank'],
		['PC Faction', 'PC Faction'],
		['PC Rank', 'PC Rank'],
		['Cell', 'Cell'],
		['ID', 'ID'],
	];

	for (const [field, label] of speakerFields) {
		const value = getStringValue(frontmatter, field);
		if (!value) {
			continue;
		}

		conditions.push({
			kind: 'speaker',
			displayText: `${label} = ${value}`,
		});
	}

	for (let index = 0; index <= 9; index += 1) {
		const rawFunction = getStringValue(frontmatter, `Function${index}`);
		const rawVariable = getStringValue(frontmatter, `Variable${index}`);
		if (!rawVariable) {
			continue;
		}

		const parsedJournal = parseJournalCondition(rawFunction ?? '', rawVariable, questIds);
		if (parsedJournal) {
			conditions.push(parsedJournal);
			continue;
		}

		const parsedChoice = parseChoiceCondition(rawFunction ?? '', rawVariable);
		if (parsedChoice) {
			conditions.push(parsedChoice);
			continue;
		}

		if ((rawFunction ?? '').trim() === 'Item') {
			const itemCondition = parseNumericVariableCondition(rawVariable);
			conditions.push({
				kind: 'item',
				displayText: `Item ${rawVariable}`,
				questId: itemCondition?.id,
				operator: itemCondition?.operator,
				value: itemCondition?.value,
			});
			continue;
		}

		const prefix = rawFunction && rawFunction !== 'Function' ? `${rawFunction} ` : '';
		const numericCondition = parseNumericVariableCondition(rawVariable);
		if (numericCondition) {
			conditions.push({
				kind: 'variable',
				displayText: `${prefix}${rawVariable}`,
				questId: `${rawFunction?.trim() || 'Function'}:${numericCondition.id}`,
				operator: numericCondition.operator,
				value: numericCondition.value,
			});
			continue;
		}

		conditions.push({
			kind: 'other',
			displayText: `${prefix}${rawVariable}`,
		});
	}

	return orderConditions(conditions);
}

/**
 * Recognizes a journal filter slot: either an explicit `Journal` function or
 * a variable that mentions one of the quest's IDs. Extracts quest ID,
 * operator, and stage value when the variable is a comparison expression.
 */
export function parseJournalCondition(rawFunction: string, rawVariable: string, questIds: string[]): Condition | null {
	const isJournalFunction = rawFunction.trim() === 'Journal';
	const matchingQuestId = questIds.find((questId) => rawVariable.includes(questId));
	if (!isJournalFunction && !matchingQuestId) {
		return null;
	}

	const journalMatch = rawVariable.match(new RegExp(`([^\\s]+)\\s*${NUMERIC_OPERATOR_PATTERN}\\s*(-?\\d+)`));
	if (!journalMatch) {
		return {
			kind: 'journal',
			displayText: `Journal ${rawVariable}`,
			questId: matchingQuestId,
		};
	}

	const journalQuestId = journalMatch[1] ?? matchingQuestId;
	const journalOperator = normalizeNumericOperator(journalMatch[2]);
	const journalValue = journalMatch[3] ?? '0';

	return {
		kind: 'journal',
		displayText: `Journal ${rawVariable}`,
		questId: journalQuestId,
		operator: journalOperator,
		value: Number.parseInt(journalValue, 10),
	};
}

/** Recognizes a `Function` + `Choice = n` filter slot. */
export function parseChoiceCondition(rawFunction: string, rawVariable: string): Condition | null {
	if (rawFunction.trim() !== 'Function' || !/^Choice\s*=\s*-?\d+/i.test(rawVariable)) {
		return null;
	}

	const choiceMatch = rawVariable.match(/Choice\s*=\s*(-?\d+)/i);
	if (!choiceMatch) {
		return null;
	}

	const choiceValue = choiceMatch[1] ?? '0';

	return {
		kind: 'choice',
		displayText: rawVariable,
		choiceValue: Number.parseInt(choiceValue, 10),
	};
}

/** Parses an `<id> <op> <int>` variable expression into its parts. */
export function parseNumericVariableCondition(rawVariable: string): { id: string; operator: NumericOperator; value: number } | null {
	const variableMatch = rawVariable.match(new RegExp(`([^\\s]+)\\s*${NUMERIC_OPERATOR_PATTERN}\\s*(-?\\d+)`));
	if (!variableMatch) {
		return null;
	}

	const id = variableMatch[1];
	const operator = normalizeNumericOperator(variableMatch[2]);
	const value = variableMatch[3];
	if (id === undefined || operator === undefined || value === undefined) {
		return null;
	}

	return {
		id,
		operator,
		value: Number.parseInt(value, 10),
	};
}

/** Narrows a matched operator string; anything unrecognized becomes `=`. */
export function normalizeNumericOperator(operator: string | undefined): NumericOperator {
	if (operator === '<=' || operator === '>=' || operator === '<' || operator === '>' || operator === '==' || operator === '!=') {
		return operator;
	}
	return '=';
}

/**
 * Parses a `Result:` script into {@link ResultAction}s, one per line:
 * Semicolon-prefixed lines are comments. `Journal`, `Choice` (may emit
 * several actions from one line), `AddTopic`, `Goodbye`, and
 * `ModDisposition` are recognized; every other line is kept as a generic
 * script action so nothing is lost on display.
 */
export function parseResultActions(resultText: string, questIds: string[]): ResultAction[] {
	if (resultText.trim().length === 0) {
		return [];
	}

	const actions: ResultAction[] = [];
	const lines = resultTextLines(resultText);
	for (const line of lines) {
		if (line.startsWith(';')) {
			actions.push({ kind: 'comment', displayText: line });
			continue;
		}

		const journalMatch = line.match(/^Journal\s+"?([^"\s]+)"?\s+(-?\d+)/i);
		if (journalMatch) {
			const journalQuestId = journalMatch[1] ?? '';
			const journalIndex = journalMatch[2] ?? '0';
			actions.push({
				kind: 'journal-set',
				displayText: `Journal [[${journalQuestId} ${journalIndex}]]`,
				targetQuestId: journalQuestId,
				targetJournalIndex: Number.parseInt(journalIndex, 10),
			});
			continue;
		}

		if (/^Choice\s+/i.test(line)) {
			for (const choice of parseChoiceResults(line)) {
				actions.push(choice);
			}
			continue;
		}

		const addTopicTarget = parseAddTopicTarget(line);
		if (addTopicTarget) {
			actions.push({
				kind: 'add-topic',
				displayText: `AddTopic "[[${addTopicTarget}]]"`,
				targetTopic: addTopicTarget,
			});
			continue;
		}

		if (/^Goodbye$/i.test(line)) {
			actions.push({ kind: 'goodbye', displayText: 'Goodbye' });
			continue;
		}

		if (/^ModDisposition\s+-?\d+/i.test(line)) {
			actions.push({ kind: 'disposition', displayText: line });
			continue;
		}

		actions.push({ kind: 'script', displayText: line });
	}

	return actions;
}

/** The topic added by an `AddTopic` line (quotes/wikilinks stripped), if any. */
export function parseAddTopicTarget(line: string): string | null {
	const match = line.match(/^AddTopic\s+(.+)$/i);
	if (!match) {
		return null;
	}

	const target = stripQuotes(match[1] ?? '').trim();
	return target.length > 0 ? stripWikilinkSyntax(target) : null;
}

/** Expands one `Choice "a" 1 "b" 2 …` line into one action per option. */
export function parseChoiceResults(line: string): ResultAction[] {
	const actions: ResultAction[] = [];
	const choicePattern = /"([^"]+)"\s+(-?\d+)/g;
	let match = choicePattern.exec(line);
	while (match) {
		const choiceLabel = match[1] ?? '';
		const choiceValue = match[2] ?? '0';
		actions.push({
			kind: 'choice-set',
			displayText: `"${choiceLabel}" - Choice ${choiceValue}`,
			choiceValue: Number.parseInt(choiceValue, 10),
			choiceText: choiceLabel,
		});
		match = choicePattern.exec(line);
	}
	return actions;
}

/** Joins condition display texts into gate-card body text. */
export function renderConditionBlock(conditions: Condition[]): string {
	return conditions.map((condition) => condition.displayText).join('\n');
}

/**
 * Canonical display order: speaker fields in Construction Set order first,
 * then everything else alphabetically. Deterministic ordering keeps card
 * text (and therefore node IDs and sync hashes) stable across runs.
 */
export function orderConditions(conditions: Condition[]): Condition[] {
	const order = [
		'Disposition',
		'Sex',
		'Race',
		'Class',
		'Faction',
		'Rank',
		'PC Faction',
		'PC Rank',
		'Cell',
		'ID',
	];
	return [...conditions].sort((left, right) => {
		const leftLabel = left.displayText.split(' = ')[0] ?? left.displayText;
		const rightLabel = right.displayText.split(' = ')[0] ?? right.displayText;
		const leftIndex = order.indexOf(leftLabel);
		const rightIndex = order.indexOf(rightLabel);
		if (leftIndex !== rightIndex) {
			return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex)
				- (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
		}
		return left.displayText.localeCompare(right.displayText);
	});
}

/** The lowest choice value among the conditions, or `null` if unchoiced. */
export function firstChoiceValue(conditions: Condition[]): number | null {
	const choiceValues = conditions
		.filter((condition) => condition.kind === 'choice' && condition.choiceValue !== undefined)
		.map((condition) => condition.choiceValue as number);
	if (choiceValues.length === 0) {
		return null;
	}
	return Math.min(...choiceValues);
}

/** Whether any rendered result line is a journal wikilink line. */
export function containsJournalLine(lines: string[]): boolean {
	return lines.some((line) => line.startsWith('Journal [['));
}

/**
 * Renders a result action for a result card. Journal-set actions that
 * resolve to a known milestone render as a wikilink to the milestone's note
 * (aliased `Journal [[note|Quest 20]]`); everything else renders verbatim.
 */
export function renderResultAction(action: ResultAction, allMilestones: MilestoneLink[]): string {
	if (action.kind !== 'journal-set' || action.targetJournalIndex === undefined) {
		return action.displayText;
	}

	const targetMilestone = resolveJournalResultMilestone(action, allMilestones);
	if (!targetMilestone) {
		return action.displayText;
	}

	const labelQuestId = action.targetQuestId ?? targetMilestone.questId;
	const label = `${labelQuestId} ${action.targetJournalIndex}`;
	return `Journal [[${toWikilinkTarget(targetMilestone.file.path)}|${label}]]`;
}

// ---------------------------------------------------------------------------
// Bidirectional card grammar.
//
// Gate cards display one condition per line using exactly the frontmatter
// filter grammar from md_dialogue_spec.md §6, so edited card text can be
// parsed back into note frontmatter:
//
//   <SpeakerField> = <value>          Class = Wise Woman
//   Choice = <n>                      Choice = 2
//   <FilterKind> <id> <op> <value>    Journal my_quest >= 10
//   <variable expression>             PCLevel > 5   (Function-kind filter)
//
// Result cards display one MW script line per line; Journal lines may carry a
// wikilink render but always parse back (and write) as raw script lines.
// ---------------------------------------------------------------------------

/** The speaker-identifying frontmatter keys, in Construction Set order. */
export const SPEAKER_FIELDS = [
	'Disposition',
	'Sex',
	'Race',
	'Class',
	'Faction',
	'Rank',
	'PC Faction',
	'PC Rank',
	'Cell',
	'ID',
] as const;

export type SpeakerField = (typeof SPEAKER_FIELDS)[number];

/** Valid `FunctionN` frontmatter values (unspaced spellings). */
export const FILTER_KINDS = [
	'Function',
	'Global',
	'Local',
	'Journal',
	'Item',
	'Dead',
	'NotId',
	'NotFaction',
	'NotClass',
	'NotRace',
	'NotCell',
	'NotLocal',
] as const;

export type FilterKind = (typeof FILTER_KINDS)[number];

/** One parsed line of a gate card, ready to round-trip into frontmatter. */
export type GateLine =
	| { kind: 'speaker'; field: SpeakerField; value: string }
	| { kind: 'choice'; choiceValue: number }
	| { kind: 'filter'; filterKind: FilterKind; variable: string };

/** All-or-nothing parse of a gate card: any bad line rejects the whole edit. */
export type GateCardParseResult =
	| { ok: true; lines: GateLine[] }
	| { ok: false; error: string };

const SPEAKER_LINE_PATTERN = new RegExp(
	`^(${SPEAKER_FIELDS.map((field) => field.replace(' ', '\\s+')).join('|')})\\s*=\\s*(.+)$`,
);
const CHOICE_LINE_PATTERN = /^Choice\s*=\s*(-?\d+)$/i;
const FILTER_LINE_PATTERN = new RegExp(
	`^(${FILTER_KINDS.filter((kind) => kind !== 'Function').join('|')})\\s+(\\S.*)$`,
);

/**
 * Parses one gate-card line per the grammar in the section comment above:
 * speaker assignment, `Choice = n`, `<FilterKind> <expr>`, or (fallback) a
 * bare variable expression treated as a Function filter. A bare filter-kind
 * word with no expression is an error rather than a silent Function filter.
 */
export function parseGateLine(line: string): GateLine | { error: string } {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return { error: 'Empty condition line.' };
	}

	const speakerMatch = trimmed.match(SPEAKER_LINE_PATTERN);
	if (speakerMatch) {
		const field = SPEAKER_FIELDS.find(
			(candidate) => candidate.replace(/\s+/g, ' ') === (speakerMatch[1] ?? '').replace(/\s+/g, ' '),
		);
		const value = (speakerMatch[2] ?? '').trim();
		if (field && value.length > 0) {
			return { kind: 'speaker', field, value };
		}
	}

	const choiceMatch = trimmed.match(CHOICE_LINE_PATTERN);
	if (choiceMatch) {
		return { kind: 'choice', choiceValue: Number.parseInt(choiceMatch[1] ?? '0', 10) };
	}

	const filterMatch = trimmed.match(FILTER_LINE_PATTERN);
	if (filterMatch) {
		const filterKind = FILTER_KINDS.find((candidate) => candidate === filterMatch[1]);
		const variable = (filterMatch[2] ?? '').trim();
		if (filterKind && variable.length > 0) {
			return { kind: 'filter', filterKind, variable };
		}
	}

	if (FILTER_KINDS.some((kind) => kind.toLowerCase() === trimmed.toLowerCase())) {
		return { error: `Filter "${trimmed}" is missing its condition (expected "${trimmed} <id> <op> <value>").` };
	}

	// Anything else is a Function-kind filter whose variable is the whole line
	// (e.g. "PCLevel > 5" compiles as Function0: Function / Variable0: PCLevel > 5).
	return { kind: 'filter', filterKind: 'Function', variable: trimmed };
}

/** Parses a whole gate card body, skipping blank lines; fails on first error. */
export function parseGateCardText(text: string): GateCardParseResult {
	const lines: GateLine[] = [];
	for (const rawLine of text.split('\n')) {
		if (rawLine.trim().length === 0) {
			continue;
		}

		const parsed = parseGateLine(rawLine);
		if ('error' in parsed) {
			return { ok: false, error: parsed.error };
		}
		lines.push(parsed);
	}
	return { ok: true, lines };
}

/** Inverse of {@link parseGateLine}: canonical display text for a gate line. */
export function renderGateLine(line: GateLine): string {
	switch (line.kind) {
		case 'speaker':
			return `${line.field} = ${line.value}`;
		case 'choice':
			return `Choice = ${line.choiceValue}`;
		case 'filter':
			return line.filterKind === 'Function'
				? normalizeVariableExpression(line.variable)
				: `${line.filterKind} ${normalizeVariableExpression(line.variable)}`;
	}
}

/**
 * Canonicalizes the spacing of a `<id> <op> <value>` variable expression.
 * Ids may contain spaces (e.g. `kashtes ilabael > 0`), so the id is matched
 * lazily up to the operator. Non-matching expressions pass through trimmed.
 */
export function normalizeVariableExpression(variable: string): string {
	const match = variable.trim().match(
		new RegExp(`^(.*?)\\s*${NUMERIC_OPERATOR_PATTERN}\\s*(-?\\d+(?:\\.\\d+)?)$`),
	);
	if (!match) {
		return variable.trim();
	}

	const id = (match[1] ?? '').trim();
	if (id.length === 0) {
		return variable.trim();
	}
	return `${id} ${match[2]} ${match[3]}`;
}

/**
 * Maps a gate line onto the frontmatter it round-trips with: either a
 * top-level speaker key or a `Function<n>`/`Variable<n>` slot pair.
 */
export function gateLineToFrontmatter(
	line: GateLine,
): { speakerField: SpeakerField; value: string } | { functionValue: FilterKind; variableValue: string } {
	switch (line.kind) {
		case 'speaker':
			return { speakerField: line.field, value: line.value };
		case 'choice':
			return { functionValue: 'Function', variableValue: `Choice = ${line.choiceValue}` };
		case 'filter':
			return { functionValue: line.filterKind, variableValue: normalizeVariableExpression(line.variable) };
	}
}

/** Inverse of {@link gateLineToFrontmatter} for filter slots. */
export function filterSlotToGateLine(functionValue: string, variableValue: string): GateLine {
	const trimmedFunction = functionValue.trim();
	const trimmedVariable = variableValue.trim();
	if (trimmedFunction === 'Function') {
		const choiceMatch = trimmedVariable.match(CHOICE_LINE_PATTERN);
		if (choiceMatch) {
			return { kind: 'choice', choiceValue: Number.parseInt(choiceMatch[1] ?? '0', 10) };
		}
		return { kind: 'filter', filterKind: 'Function', variable: trimmedVariable };
	}

	const filterKind = FILTER_KINDS.find((candidate) => candidate === trimmedFunction);
	if (filterKind) {
		return { kind: 'filter', filterKind, variable: trimmedVariable };
	}

	// Unknown filter kinds are preserved as a Function-style raw expression so
	// nothing is silently dropped; the writer never re-emits them from here.
	return { kind: 'filter', filterKind: 'Function', variable: `${trimmedFunction} ${trimmedVariable}`.trim() };
}

/** One parsed line of a result card, ready to round-trip into `Result:`. */
export type ResultLine =
	| { kind: 'journal'; questId: string; index: number }
	| { kind: 'add-topic'; topic: string }
	| { kind: 'choice'; text: string; choiceValue: number }
	| { kind: 'comment'; text: string }
	| { kind: 'script'; text: string };

const JOURNAL_WIKILINK_LINE_PATTERN = /^Journal\s+\[\[(?:[^\]|]*\|)?([^\]|]+?)\s+(-?\d+)\]\]$/i;
const JOURNAL_RAW_LINE_PATTERN = /^Journal\s+"?([^"\s]+)"?\s+(-?\d+)$/i;
const CHOICE_RESULT_LINE_PATTERN = /^Choice\s+"([^"]+)"\s+(-?\d+)$/i;

/**
 * Parses one result-card line. Journal lines are accepted in both the
 * wikilink render (`Journal [[Note|Quest 20]]`) and the raw script form
 * (`Journal Quest 20` / `Journal "Quest" 20`). Unrecognized lines are
 * preserved verbatim as script lines.
 */
export function parseResultCardLine(line: string): ResultLine {
	const trimmed = line.trim();
	if (trimmed.startsWith(';')) {
		return { kind: 'comment', text: trimmed };
	}

	const wikilinkMatch = trimmed.match(JOURNAL_WIKILINK_LINE_PATTERN);
	if (wikilinkMatch) {
		return {
			kind: 'journal',
			questId: wikilinkMatch[1] ?? '',
			index: Number.parseInt(wikilinkMatch[2] ?? '0', 10),
		};
	}

	const rawJournalMatch = trimmed.match(JOURNAL_RAW_LINE_PATTERN);
	if (rawJournalMatch) {
		return {
			kind: 'journal',
			questId: rawJournalMatch[1] ?? '',
			index: Number.parseInt(rawJournalMatch[2] ?? '0', 10),
		};
	}

	const choiceMatch = trimmed.match(CHOICE_RESULT_LINE_PATTERN);
	if (choiceMatch) {
		return {
			kind: 'choice',
			text: choiceMatch[1] ?? '',
			choiceValue: Number.parseInt(choiceMatch[2] ?? '0', 10),
		};
	}

	const addTopicTarget = parseAddTopicTarget(trimmed);
	if (addTopicTarget) {
		return { kind: 'add-topic', topic: addTopicTarget };
	}

	return { kind: 'script', text: trimmed };
}

/** Parses a whole result card body (blank lines skipped; never fails). */
export function parseResultCardText(text: string): ResultLine[] {
	return resultTextLines(text).map((line) => parseResultCardLine(line));
}

/**
 * Renders a result line in the raw MW script form written into `Result:`
 * blocks. Quest ids are quoted to match exporter output (ids may contain
 * characters MW script would otherwise misparse).
 */
export function renderResultNoteLine(line: ResultLine): string {
	switch (line.kind) {
		case 'journal':
			return `Journal "${line.questId}" ${line.index}`;
		case 'add-topic':
			return `AddTopic "${line.topic}"`;
		case 'choice':
			return `Choice "${line.text}" ${line.choiceValue}`;
		case 'comment':
			return line.text;
		case 'script':
			return line.text;
	}
}

/**
 * Finds the milestone a journal-set action points at. Without a quest ID on
 * the action, an index-only match is accepted only when unambiguous.
 */
export function resolveJournalResultMilestone<T extends MilestoneLink>(
	action: ResultAction,
	allMilestones: T[],
): T | null {
	if (action.kind !== 'journal-set' || action.targetJournalIndex === undefined) {
		return null;
	}

	if (action.targetQuestId) {
		return allMilestones.find(
			(milestone) => milestone.questId === action.targetQuestId && milestone.index === action.targetJournalIndex,
		) ?? null;
	}

	const matches = allMilestones.filter((milestone) => milestone.index === action.targetJournalIndex);
	if (matches.length === 1) {
		return matches[0] ?? null;
	}

	return null;
}

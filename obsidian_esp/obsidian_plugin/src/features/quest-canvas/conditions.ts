/**
 * @file Condition compatibility logic.
 *
 * Pure predicates that decide whether two dialogue conditions can be
 * satisfied simultaneously — used when grouping records into families and
 * when deciding which records a transition can legally flow to. Kept free of
 * Obsidian imports so it can be unit-tested and used by the harness.
 */

/**
 * Whether a speaker condition value on a candidate record is compatible with
 * the same-labelled value on a source record. Values match by
 * case-insensitive equality, except `Disposition` which is a minimum
 * threshold: two numeric disposition requirements can both be satisfied by
 * the same speaker even when their thresholds differ.
 */
export function speakerConditionValuesAreCompatible(
	label: string,
	sourceValue: string,
	candidateValue: string,
): boolean {
	if (label === 'Disposition') {
		const sourceDisposition = parseIntegerValue(sourceValue);
		const candidateDisposition = parseIntegerValue(candidateValue);
		if (sourceDisposition !== null && candidateDisposition !== null) {
			return true;
		}
	}

	return sourceValue.toLowerCase() === candidateValue.toLowerCase();
}

export type NumericOperator = '<=' | '>=' | '<' | '>' | '=' | '==' | '!=';

/** An `operator value` comparison (e.g. `>= 30`); both parts optional. */
export interface NumericConditionRangeInput {
	operator?: NumericOperator;
	value?: number;
}

/** A numeric comparison expressed as an interval with exclusions. */
interface NumericConditionRange {
	min: number;
	minInclusive: boolean;
	max: number;
	maxInclusive: boolean;
	/** Values carved out of the interval (from `!=`). */
	excludedValues: number[];
}

/**
 * Whether two numeric conditions can hold at once, by converting each to an
 * interval and testing that the intersection is non-empty. Conditions with
 * no value are treated as unconstrained (always compatible).
 */
export function numericConditionRangesAreCompatible(
	left: NumericConditionRangeInput,
	right: NumericConditionRangeInput,
): boolean {
	if (left.value === undefined || right.value === undefined) {
		return true;
	}

	const leftRange = numericConditionRange(left);
	const rightRange = numericConditionRange(right);
	const min = Math.max(leftRange.min, rightRange.min);
	const max = Math.min(leftRange.max, rightRange.max);
	const minInclusive = numericRangeUsesInclusiveMin(leftRange, min)
		&& numericRangeUsesInclusiveMin(rightRange, min);
	const maxInclusive = numericRangeUsesInclusiveMax(leftRange, max)
		&& numericRangeUsesInclusiveMax(rightRange, max);

	if (min > max) {
		return false;
	}
	if (min === max) {
		if (!minInclusive || !maxInclusive) {
			return false;
		}
		return !leftRange.excludedValues.includes(min) && !rightRange.excludedValues.includes(min);
	}

	return true;
}

/** Minimal condition shape needed to check for a quest's journal filter. */
export interface QuestJournalFilterInput {
	kind: string;
	questId?: string;
}

/** Whether any condition is a journal filter on one of the given quest IDs. */
export function hasSelectedQuestJournalFilter(
	conditions: QuestJournalFilterInput[],
	questIds: string[],
): boolean {
	return conditions.some((condition) => condition.kind === 'journal'
		&& condition.questId !== undefined
		&& questIds.includes(condition.questId));
}

/** Converts an operator+value comparison into its interval representation. */
function numericConditionRange(condition: NumericConditionRangeInput): NumericConditionRange {
	const value = condition.value ?? 0;
	switch (condition.operator) {
		case '<=':
			return {
				min: Number.NEGATIVE_INFINITY,
				minInclusive: false,
				max: value,
				maxInclusive: true,
				excludedValues: [],
			};
		case '>=':
			return {
				min: value,
				minInclusive: true,
				max: Number.POSITIVE_INFINITY,
				maxInclusive: false,
				excludedValues: [],
			};
		case '<':
			return {
				min: Number.NEGATIVE_INFINITY,
				minInclusive: false,
				max: value,
				maxInclusive: false,
				excludedValues: [],
			};
		case '>':
			return {
				min: value,
				minInclusive: false,
				max: Number.POSITIVE_INFINITY,
				maxInclusive: false,
				excludedValues: [],
			};
		case '!=':
			return {
				min: Number.NEGATIVE_INFINITY,
				minInclusive: false,
				max: Number.POSITIVE_INFINITY,
				maxInclusive: false,
				excludedValues: [value],
			};
		case '==':
		case '=':
		default:
			return {
				min: value,
				minInclusive: true,
				max: value,
				maxInclusive: true,
				excludedValues: [],
			};
	}
}

/**
 * Whether `range` includes the candidate intersection minimum `min` — true
 * when the range's own bound is looser than `min` or inclusive at it.
 */
function numericRangeUsesInclusiveMin(range: NumericConditionRange, min: number): boolean {
	if (range.min === Number.NEGATIVE_INFINITY || range.min < min) {
		return true;
	}
	return range.minInclusive;
}

/** Counterpart of {@link numericRangeUsesInclusiveMin} for the maximum. */
function numericRangeUsesInclusiveMax(range: NumericConditionRange, max: number): boolean {
	if (range.max === Number.POSITIVE_INFINITY || range.max > max) {
		return true;
	}
	return range.maxInclusive;
}

/** Strict integer parse; returns `null` for anything but an integer string. */
function parseIntegerValue(value: string): number | null {
	const trimmedValue = value.trim();
	if (!/^-?\d+$/.test(trimmedValue)) {
		return null;
	}

	return Number.parseInt(trimmedValue, 10);
}

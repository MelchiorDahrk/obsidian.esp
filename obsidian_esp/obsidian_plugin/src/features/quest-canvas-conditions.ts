export function speakerConditionValuesAreCompatible(
	label: string,
	sourceValue: string,
	candidateValue: string,
): boolean {
	if (label === 'Disposition') {
		const sourceDisposition = parseIntegerValue(sourceValue);
		const candidateDisposition = parseIntegerValue(candidateValue);
		if (sourceDisposition !== null && candidateDisposition !== null) {
			return sourceDisposition >= candidateDisposition;
		}
	}

	return sourceValue.toLowerCase() === candidateValue.toLowerCase();
}

export type NumericOperator = '<=' | '>=' | '<' | '>' | '=' | '==' | '!=';

export interface NumericConditionRangeInput {
	operator?: NumericOperator;
	value?: number;
}

interface NumericConditionRange {
	min: number;
	minInclusive: boolean;
	max: number;
	maxInclusive: boolean;
	excludedValues: number[];
}

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

export interface QuestJournalFilterInput {
	kind: string;
	questId?: string;
}

export function hasSelectedQuestJournalFilter(
	conditions: QuestJournalFilterInput[],
	questIds: string[],
): boolean {
	return conditions.some((condition) => condition.kind === 'journal'
		&& condition.questId !== undefined
		&& questIds.includes(condition.questId));
}

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

function numericRangeUsesInclusiveMin(range: NumericConditionRange, min: number): boolean {
	if (range.min === Number.NEGATIVE_INFINITY || range.min < min) {
		return true;
	}
	return range.minInclusive;
}

function numericRangeUsesInclusiveMax(range: NumericConditionRange, max: number): boolean {
	if (range.max === Number.POSITIVE_INFINITY || range.max > max) {
		return true;
	}
	return range.maxInclusive;
}

function parseIntegerValue(value: string): number | null {
	const trimmedValue = value.trim();
	if (!/^-?\d+$/.test(trimmedValue)) {
		return null;
	}

	return Number.parseInt(trimmedValue, 10);
}

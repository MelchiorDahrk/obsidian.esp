import {
	type Condition,
	type FrontmatterValue,
	type JournalMilestone,
	NUMERIC_OPERATOR_PATTERN,
	type NumericOperator,
	type ResultAction,
} from './model';
import { getStringValue, stripQuotes, stripWikilinkSyntax, toWikilinkTarget } from './utils';

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
				displayText: `Item - ${rawVariable}`,
				questId: itemCondition?.id,
				operator: itemCondition?.operator,
				value: itemCondition?.value,
			});
			continue;
		}

		const prefix = rawFunction && rawFunction !== 'Function' ? `${rawFunction} - ` : '';
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
			displayText: `Journal - ${rawVariable}`,
			questId: matchingQuestId,
		};
	}

	const journalQuestId = journalMatch[1] ?? matchingQuestId;
	const journalOperator = normalizeNumericOperator(journalMatch[2]);
	const journalValue = journalMatch[3] ?? '0';

	return {
		kind: 'journal',
		displayText: `Journal - ${rawVariable}`,
		questId: journalQuestId,
		operator: journalOperator,
		value: Number.parseInt(journalValue, 10),
	};
}

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

export function normalizeNumericOperator(operator: string | undefined): NumericOperator {
	if (operator === '<=' || operator === '>=' || operator === '<' || operator === '>' || operator === '==' || operator === '!=') {
		return operator;
	}
	return '=';
}

export function parseResultActions(resultText: string, questIds: string[]): ResultAction[] {
	if (resultText.trim().length === 0) {
		return [];
	}

	const actions: ResultAction[] = [];
	const lines = resultText.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
	for (const line of lines) {
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

export function parseAddTopicTarget(line: string): string | null {
	const match = line.match(/^AddTopic\s+(.+)$/i);
	if (!match) {
		return null;
	}

	const target = stripQuotes(match[1] ?? '').trim();
	return target.length > 0 ? stripWikilinkSyntax(target) : null;
}

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
		});
		match = choicePattern.exec(line);
	}
	return actions;
}

export function renderConditionBlock(conditions: Condition[]): string {
	return conditions.map((condition) => condition.displayText).join('\n');
}

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

export function firstChoiceValue(conditions: Condition[]): number | null {
	const choiceValues = conditions
		.filter((condition) => condition.kind === 'choice' && condition.choiceValue !== undefined)
		.map((condition) => condition.choiceValue as number);
	if (choiceValues.length === 0) {
		return null;
	}
	return Math.min(...choiceValues);
}

export function containsJournalLine(lines: string[]): boolean {
	return lines.some((line) => line.startsWith('Journal [['));
}

export function renderResultAction(action: ResultAction, allMilestones: JournalMilestone[]): string {
	if (action.kind !== 'journal-set' || action.targetJournalIndex === undefined) {
		return action.displayText;
	}

	const targetMilestone = resolveJournalResultMilestone(action, allMilestones);
	if (!targetMilestone) {
		return action.displayText;
	}

	const labelQuestId = action.targetQuestId ?? targetMilestone.questId;
	const label = `${labelQuestId} ${action.targetJournalIndex}`;
	return `Journal [[${toWikilinkTarget(targetMilestone.file.path, targetMilestone.canvasSubpath)}|${label}]]`;
}

export function resolveJournalResultMilestone(
	action: ResultAction,
	allMilestones: JournalMilestone[],
): JournalMilestone | null {
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

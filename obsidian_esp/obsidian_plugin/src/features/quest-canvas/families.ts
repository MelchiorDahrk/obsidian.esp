import { selectFirstQuestTreeAddTopicTargets } from './add-topic';
import { parseSpeakerConditionDisplayText } from './cards';
import {
	hasSelectedQuestJournalFilter,
	numericConditionRangesAreCompatible,
	speakerConditionValuesAreCompatible,
} from './conditions';
import { findCanvasNode } from './emit';
import {
	type BranchFamily,
	type CanvasLayoutContext,
	type ChoiceGroup,
	type ChoiceTransitionAnchor,
	type Condition,
	type DialogueRecord,
	type JournalMilestone,
	type PhaseGraph,
	type PhaseTopicSegment,
	PRE_JOURNAL_PHASE,
	type ResultAction,
} from './model';
import {
	compareNullableNumbers,
	createNodeId,
	maxNumber,
	normalizeConditionKey,
	normalizeTopicKey,
	uniqueNumbers,
} from './utils';

export function recordCanRunAtPhase(record: DialogueRecord, phaseValue: number, questIds: string[]): boolean {
	const selectedQuestJournalConditions = record.conditions.filter(
		(condition) => condition.kind === 'journal'
			&& condition.questId !== undefined
			&& questIds.includes(condition.questId),
	);
	if (selectedQuestJournalConditions.length === 0) {
		return false;
	}

	return selectedQuestJournalConditions.every((condition) => journalConditionMatches(phaseValue, condition));
}

export function recordHasChoiceCondition(record: DialogueRecord): boolean {
	return record.conditions.some((condition) => condition.kind === 'choice');
}

export function groupFamiliesByTopic(families: BranchFamily[]): Map<string, BranchFamily[]> {
	const grouped = new Map<string, BranchFamily[]>();
	for (const family of families) {
		const topicFamilies = grouped.get(family.topic) ?? [];
		topicFamilies.push(family);
		grouped.set(family.topic, topicFamilies);
	}
	return grouped;
}

export function groupFamiliesByPrimaryChoice(families: BranchFamily[]): ChoiceGroup[] {
	const grouped = new Map<string, ChoiceGroup>();
	for (const family of families) {
		const choiceValues = family.records
			.map((record) => record.primaryChoiceValue)
			.filter((value): value is number => value !== null);
		const choiceValue = choiceValues.length > 0 ? Math.min(...choiceValues) : null;
		const key = choiceValue === null ? 'root' : String(choiceValue);
		const existing = grouped.get(key);
		if (existing) {
			existing.families.push(family);
			continue;
		}
		grouped.set(key, { choiceValue, families: [family] });
	}

	return [...grouped.values()].sort(compareChoiceGroups);
}

export function buildPhaseGraph(phaseIndices: number[], families: BranchFamily[]): PhaseGraph {
	const phaseSet = new Set(phaseIndices);
	for (const family of families) {
		phaseSet.add(family.phaseAnchor);
	}

	const orderedPhaseValues = uniqueNumbers([...phaseSet]);
	const familiesByPhase = new Map<number, BranchFamily[]>();
	const segmentsByPhase = new Map<number, PhaseTopicSegment[]>();
	const incomingTransitions = new Map<number, Set<number>>();
	const outgoingTransitions = new Map<number, Set<number>>();
	const mainTargets = new Map<number, number | null>();

	for (const phaseValue of orderedPhaseValues) {
		familiesByPhase.set(phaseValue, []);
		segmentsByPhase.set(phaseValue, []);
		incomingTransitions.set(phaseValue, new Set<number>());
		outgoingTransitions.set(phaseValue, new Set<number>());
	}

	for (const family of families) {
		const phaseFamilies = familiesByPhase.get(family.phaseAnchor) ?? [];
		phaseFamilies.push(family);
		familiesByPhase.set(family.phaseAnchor, phaseFamilies);

		if (
			family.progressionTarget !== null
			&& family.progressionTarget > family.phaseAnchor
			&& phaseSet.has(family.progressionTarget)
		) {
			outgoingTransitions.get(family.phaseAnchor)?.add(family.progressionTarget);
			incomingTransitions.get(family.progressionTarget)?.add(family.phaseAnchor);
		}
	}

	for (const [phaseValue, phaseFamilies] of familiesByPhase) {
		const sortedFamilies = [...phaseFamilies].sort(compareBranchFamilies);
		familiesByPhase.set(phaseValue, sortedFamilies);
		segmentsByPhase.set(
			phaseValue,
			[...groupFamiliesByTopic(sortedFamilies).entries()].map(([topic, topicFamilies]) => ({
				topic,
				families: topicFamilies,
			})),
		);
		mainTargets.set(
			phaseValue,
			sortedFamilies
				.map((family) => family.progressionTarget)
				.find((target): target is number => target !== null && target > phaseValue)
				?? null,
		);
	}

	return {
		orderedPhases: topologicallyOrderPhases(orderedPhaseValues, outgoingTransitions, incomingTransitions),
		familiesByPhase,
		segmentsByPhase,
		incomingTransitions,
		outgoingTransitions,
		mainTargets,
	};
}

export function topologicallyOrderPhases(
	phaseValues: number[],
	outgoingTransitions: Map<number, Set<number>>,
	incomingTransitions: Map<number, Set<number>>,
): number[] {
	const remainingIncoming = new Map<number, number>();
	const available = [...phaseValues].sort((left, right) => left - right);
	const ordered: number[] = [];

	for (const phaseValue of phaseValues) {
		remainingIncoming.set(phaseValue, incomingTransitions.get(phaseValue)?.size ?? 0);
	}

	const ready: number[] = available.filter((phaseValue) => (remainingIncoming.get(phaseValue) ?? 0) === 0);
	const queued = new Set<number>(ready);

	while (ready.length > 0) {
		ready.sort((left, right) => left - right);
		const phaseValue = ready.shift();
		if (phaseValue === undefined) {
			break;
		}

		ordered.push(phaseValue);
		queued.delete(phaseValue);
		for (const target of [...(outgoingTransitions.get(phaseValue) ?? [])].sort((left, right) => left - right)) {
			const nextIncoming = Math.max(0, (remainingIncoming.get(target) ?? 0) - 1);
			remainingIncoming.set(target, nextIncoming);
			if (nextIncoming === 0 && !queued.has(target) && !ordered.includes(target)) {
				ready.push(target);
				queued.add(target);
			}
		}
	}

	for (const phaseValue of available) {
		if (!ordered.includes(phaseValue)) {
			ordered.push(phaseValue);
		}
	}

	return ordered;
}

export function mapChoiceGroupsByChoice(choiceGroups: ChoiceGroup[]): Map<string, ChoiceGroup> {
	const groupsByChoice = new Map<string, ChoiceGroup>();
	for (const group of choiceGroups) {
		groupsByChoice.set(choiceGroupKey(group.choiceValue), group);
	}
	return groupsByChoice;
}

export function collectEmittedChoices(families: BranchFamily[]): Set<number> {
	const emittedChoices = new Set<number>();
	for (const family of families) {
		for (const action of family.results) {
			if (action.kind === 'choice-set' && action.choiceValue !== undefined) {
				emittedChoices.add(action.choiceValue);
			}
		}
	}
	return emittedChoices;
}

export function resolveRootChoiceGroups(choiceGroups: ChoiceGroup[]): ChoiceGroup[] {
	const emittedChoices = collectEmittedChoices(choiceGroups.flatMap((group) => group.families));
	return choiceGroups.filter(
		(group) => group.choiceValue === null || !emittedChoices.has(group.choiceValue),
	);
}

export function orderChoiceGroupsForLanes(choiceGroups: ChoiceGroup[], phaseValue: number): ChoiceGroup[] {
	return [...choiceGroups].sort((left, right) => {
		const leftPriority = Math.min(...left.families.map((family) => family.priority), Number.MAX_SAFE_INTEGER);
		const rightPriority = Math.min(...right.families.map((family) => family.priority), Number.MAX_SAFE_INTEGER);
		if (leftPriority !== rightPriority) {
			return leftPriority - rightPriority;
		}

		const leftTarget = left.families
			.map((family) => family.progressionTarget)
			.find((target): target is number => target !== null && target > phaseValue)
			?? null;
		const rightTarget = right.families
			.map((family) => family.progressionTarget)
			.find((target): target is number => target !== null && target > phaseValue)
			?? null;
		return compareNullableNumbers(leftTarget, rightTarget)
			|| compareChoiceGroups(left, right);
	});
}

export function compareChoiceGroups(left: ChoiceGroup, right: ChoiceGroup): number {
	return compareNullableNumbers(left.choiceValue, right.choiceValue);
}

export function choiceActionIdentity(action: ResultAction): string {
	return `${action.choiceValue ?? ''}:${action.displayText}`;
}

export function choiceGroupKey(choiceValue: number | null): string {
	return choiceValue === null ? 'root' : String(choiceValue);
}

export function hasJournalRangeCondition(record: DialogueRecord): boolean {
	const journalConditionsByQuest = groupJournalConditionsByQuest(record.conditions.filter(
		(condition) => condition.kind === 'journal'
			&& condition.questId !== undefined
			&& condition.value !== undefined,
	));

	for (const conditions of journalConditionsByQuest.values()) {
		const hasLowerBound = conditions.some((condition) => condition.operator === '>=' || condition.operator === '>');
		const hasUpperBound = conditions.some((condition) => condition.operator === '<=' || condition.operator === '<');
		if (hasLowerBound && hasUpperBound) {
			return true;
		}
	}

	return false;
}

export function recordCanIntroduceBodyTopic(record: DialogueRecord): boolean {
	return !record.conditions.some((condition) => condition.kind === 'choice')
		&& record.conditions.some((condition) => condition.kind === 'journal'
			&& condition.value === 0
			&& (condition.operator === '=' || condition.operator === '=='));
}

export function phaseHasExplicitJournalProgression(
	records: DialogueRecord[],
	sourcePhase: number,
	targetPhase: number,
	questIds: string[],
): boolean {
	return records.some((record) => recordHasExactJournalCondition(record, sourcePhase, questIds)
		&& record.resultActions.some((action) => action.kind === 'journal-set'
			&& action.targetQuestId !== undefined
			&& questIds.includes(action.targetQuestId)
			&& action.targetJournalIndex === targetPhase));
}

export function resolveAddTopicTransitionTargets(
	sourceRecord: DialogueRecord,
	targetTopic: string,
	orderedRecordsByTopic: Map<string, DialogueRecord[]>,
	questIds?: string[],
	context?: CanvasLayoutContext,
): DialogueRecord[] {
	const targetRecords = orderedRecordsByTopic.get(normalizeTopicKey(targetTopic)) ?? [];
	const candidates = targetRecords.filter((candidate) => (
		conditionsCanFollowAddTopic(sourceRecord, candidate)
		&& (context !== undefined || questIds === undefined || recordHasSelectedQuestJournalFilter(candidate, questIds))
	));
	if (candidates.length <= 1) {
		return candidates;
	}

	if (context) {
		const firstQuestTreeTargets = firstQuestTreeAddTopicTargets(context, sourceRecord, candidates);
		if (firstQuestTreeTargets.length > 0) {
			return firstQuestTreeTargets;
		}
	}

	const scoredCandidates = candidates.map((candidate) => ({
		candidate,
		score: scoreAddTopicTransitionTarget(sourceRecord, candidate),
	}));
	const bestScore = Math.max(...scoredCandidates.map((item) => item.score));
	const bestCandidates = scoredCandidates
		.filter((item) => item.score === bestScore)
		.map((item) => item.candidate);

	return bestScore > 0 ? bestCandidates : [candidates[0] as DialogueRecord];
}

export function firstQuestTreeAddTopicTargets(
	context: CanvasLayoutContext,
	sourceRecord: DialogueRecord,
	candidates: DialogueRecord[],
): DialogueRecord[] {
	const positionedCandidates = candidates
		.map((candidate) => {
			const nodeId = context.recordEntryNodeIds.get(candidate.id);
			const node = nodeId ? findCanvasNode(context, nodeId) : undefined;
			return node ? {
				target: candidate,
				nodeId,
				x: node.x,
				y: node.y,
				score: scoreAddTopicTransitionTarget(sourceRecord, candidate),
			} : null;
		})
		.filter((item): item is { target: DialogueRecord; nodeId: string; x: number; y: number; score: number } => item !== null);

	return selectFirstQuestTreeAddTopicTargets(positionedCandidates);
}

export function recordHasSelectedQuestJournalFilter(record: DialogueRecord, questIds: string[]): boolean {
	return hasSelectedQuestJournalFilter(record.conditions, questIds);
}

export function recordHasExactJournalCondition(record: DialogueRecord, phaseValue: number, questIds: string[]): boolean {
	return exactJournalConditionQuestIds(record, phaseValue, questIds).length > 0;
}

export function recordsShareExactJournalQuest(
	sourceRecord: DialogueRecord,
	sourcePhase: number,
	targetRecord: DialogueRecord,
	targetPhase: number,
	questIds: string[],
): boolean {
	const sourceQuestIds = new Set(exactJournalConditionQuestIds(sourceRecord, sourcePhase, questIds));
	return exactJournalConditionQuestIds(targetRecord, targetPhase, questIds).some((questId) => sourceQuestIds.has(questId));
}

export function exactJournalConditionQuestIds(record: DialogueRecord, phaseValue: number, questIds: string[]): string[] {
	return record.conditions
		.filter((condition) => condition.kind === 'journal'
			&& condition.questId !== undefined
			&& questIds.includes(condition.questId)
			&& condition.value === phaseValue
			&& (condition.operator === '=' || condition.operator === '=='))
		.map((condition) => condition.questId as string);
}

export function conditionsCanFollowJournalPhase(
	sourceRecord: DialogueRecord,
	candidate: DialogueRecord,
	targetPhase: number,
): boolean {
	if (!speakerConditionsAreCompatible(sourceRecord.speakerConditions, candidate.speakerConditions)) {
		return false;
	}

	if (!numericConditionsAreCompatible(sourceRecord.conditions, candidate.conditions, ['item', 'variable'])) {
		return false;
	}

	if (!journalConditionsAreCompatible(sourceRecord.conditions, candidate.conditions)) {
		return false;
	}

	for (const condition of candidate.conditions) {
		if (
			condition.kind === 'journal'
			&& condition.questId !== undefined
			&& condition.value !== undefined
			&& !journalConditionMatches(targetPhase, condition)
		) {
			return false;
		}
	}

	return true;
}

export function journalConditionsAreCompatible(sourceConditions: Condition[], candidateConditions: Condition[]): boolean {
	return numericConditionsAreCompatible(sourceConditions, candidateConditions, ['journal']);
}

export function assignDialogueInfoOrder(records: DialogueRecord[]): DialogueRecord[] {
	for (const topicRecords of groupRecordsByTopic(records).values()) {
		const orderedRecords = orderTopicRecordsByInfoSequence(topicRecords);
		for (let index = 0; index < orderedRecords.length; index += 1) {
			const record = orderedRecords[index];
			if (!record) {
				continue;
			}

			record.infoOrder = index;
		}
	}

	return records;
}

export function resolveChoiceDerivedPhaseAnchors(records: DialogueRecord[]): DialogueRecord[] {
	const orderedRecordsByTopic = new Map<string, DialogueRecord[]>();
	for (const [topic, topicRecords] of groupRecordsByTopic(records)) {
		orderedRecordsByTopic.set(topic, orderTopicRecordsByInfoSequence(topicRecords));
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (const record of records) {
			for (const choiceValue of record.choiceTargets) {
				const targetRecords = resolveChoiceTransitionTargets(
					{
						topic: record.topic,
						choiceValue,
						nodeId: '',
						sourceRecords: [record],
					},
					orderedRecordsByTopic,
				);
				for (const targetRecord of targetRecords) {
					if (targetRecord.phaseAnchor >= record.phaseAnchor) {
						continue;
					}

					record.phaseAnchor = targetRecord.phaseAnchor;
					changed = true;
				}
			}
		}
	}

	return records;
}

export function stripUnrelatedAddTopicChoices(records: DialogueRecord[]): DialogueRecord[] {
	return records.map((record) => {
		if (
			record.directlyRelevant
			|| !record.resultActions.some((action) => action.kind === 'add-topic')
			|| !record.resultActions.some((action) => action.kind === 'choice-set')
		) {
			return record;
		}

		return {
			...record,
			suppressChoiceTransitions: true,
		};
	});
}

export function resolveChoiceTransitionTargets(
	anchor: ChoiceTransitionAnchor,
	orderedRecordsByTopic: Map<string, DialogueRecord[]>,
): DialogueRecord[] {
	const topicRecords = orderedRecordsByTopic.get(anchor.topic) ?? [];
	const targetRecords: Array<{ record: DialogueRecord; score: number }> = [];
	for (const candidate of topicRecords) {
		if (!candidate.choiceValues.includes(anchor.choiceValue)) {
			continue;
		}

		if (
			anchor.sourceRecords.some((sourceRecord) => (
				candidate.id !== sourceRecord.id
				&& conditionsCanFollowChoice(sourceRecord, candidate, anchor.choiceValue)
			))
		) {
			const score = Math.max(
				...anchor.sourceRecords.map((sourceRecord) => scoreChoiceTransitionTarget(sourceRecord, candidate)),
			);
			targetRecords.push({ record: candidate, score });
		}
	}

	if (targetRecords.length <= 1) {
		return targetRecords.map((target) => target.record);
	}

	const bestScore = Math.max(...targetRecords.map((target) => target.score));
	if (bestScore <= 0) {
		return targetRecords.map((target) => target.record);
	}

	return targetRecords
		.filter((target) => target.score === bestScore)
		.map((target) => target.record);
}

export function orderTopicRecordsByInfoSequence(records: DialogueRecord[]): DialogueRecord[] {
	const recordsByDiagId = new Map<string, DialogueRecord>();
	const nextRecordsByPrevId = new Map<string, DialogueRecord[]>();
	for (const record of records) {
		if (record.diagId.length > 0) {
			recordsByDiagId.set(record.diagId, record);
		}
		if (record.prevId.length > 0) {
			const nextRecords = nextRecordsByPrevId.get(record.prevId) ?? [];
			nextRecords.push(record);
			nextRecordsByPrevId.set(record.prevId, nextRecords);
		}
	}

	const orderedRecords: DialogueRecord[] = [];
	const visitedRecordIds = new Set<string>();
	const visitRecord = (record: DialogueRecord): void => {
		if (visitedRecordIds.has(record.id)) {
			return;
		}

		orderedRecords.push(record);
		visitedRecordIds.add(record.id);
		for (const nextRecord of [...(nextRecordsByPrevId.get(record.diagId) ?? [])].sort(compareDialogueRecords)) {
			visitRecord(nextRecord);
		}
	};

	for (const record of [...records].sort(compareDialogueRecords)) {
		if (record.prevId.length > 0 && recordsByDiagId.has(record.prevId)) {
			continue;
		}
		visitRecord(record);
	}

	for (const record of [...records].sort(compareDialogueRecords)) {
		visitRecord(record);
	}

	return orderedRecords;
}

export function conditionsCanFollowChoice(sourceRecord: DialogueRecord, candidate: DialogueRecord, choiceValue: number): boolean {
	const candidateChoiceConditions = candidate.conditions.filter((condition) => condition.kind === 'choice');
	if (
		candidateChoiceConditions.length > 0
		&& candidateChoiceConditions.some((condition) => condition.choiceValue !== choiceValue)
	) {
		return false;
	}

	if (!speakerConditionsAreCompatible(sourceRecord.speakerConditions, candidate.speakerConditions)) {
		return false;
	}

	if (!numericConditionsAreCompatible(sourceRecord.conditions, candidate.conditions, ['item', 'variable'])) {
		return false;
	}

	const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
	for (const condition of candidate.conditions) {
		if (
			condition.kind !== 'journal'
			|| condition.questId === undefined
			|| condition.value === undefined
		) {
			continue;
		}

		const knownValue = knownJournalValues.get(condition.questId);
		if (knownValue !== undefined && !journalConditionMatches(knownValue, condition)) {
			return false;
		}
	}

	const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
	for (const condition of candidate.conditions) {
		if (
			condition.kind !== 'item'
			|| condition.questId === undefined
			|| condition.value === undefined
		) {
			continue;
		}

		const knownValue = knownItemValues.get(condition.questId);
		if (knownValue !== undefined && !numericConditionMatches(knownValue, condition)) {
			return false;
		}
	}

	return true;
}

export function conditionsCanFollowAddTopic(sourceRecord: DialogueRecord, candidate: DialogueRecord): boolean {
	if (candidate.type !== 'Topic' || candidate.conditions.some((condition) => condition.kind === 'choice')) {
		return false;
	}

	if (!speakerConditionsAreCompatible(sourceRecord.speakerConditions, candidate.speakerConditions)) {
		return false;
	}

	if (!numericConditionsAreCompatible(sourceRecord.conditions, candidate.conditions, ['item', 'variable'])) {
		return false;
	}

	if (!journalConditionsAreCompatible(sourceRecord.conditions, candidate.conditions)) {
		return false;
	}

	const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
	for (const condition of candidate.conditions) {
		if (
			condition.kind !== 'journal'
			|| condition.questId === undefined
			|| condition.value === undefined
		) {
			continue;
		}

		const knownValue = knownJournalValues.get(condition.questId);
		if (knownValue !== undefined && !journalConditionMatches(knownValue, condition)) {
			return false;
		}
	}

	const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
	for (const condition of candidate.conditions) {
		if (
			condition.kind !== 'item'
			|| condition.questId === undefined
			|| condition.value === undefined
		) {
			continue;
		}

		const knownValue = knownItemValues.get(condition.questId);
		if (knownValue !== undefined && !numericConditionMatches(knownValue, condition)) {
			return false;
		}
	}

	return true;
}

export function scoreAddTopicTransitionTarget(sourceRecord: DialogueRecord, candidate: DialogueRecord): number {
	const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
	const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
	let score = countMatchingSpeakerConditions(sourceRecord.speakerConditions, candidate.speakerConditions);

	for (const condition of candidate.conditions) {
		if (
			condition.kind === 'journal'
			&& condition.questId !== undefined
			&& condition.value !== undefined
		) {
			const knownValue = knownJournalValues.get(condition.questId);
			if (knownValue !== undefined && journalConditionMatches(knownValue, condition)) {
				score += 1;
			}
		}

		if (
			condition.kind === 'item'
			&& condition.questId !== undefined
			&& condition.value !== undefined
		) {
			const knownValue = knownItemValues.get(condition.questId);
			if (knownValue !== undefined && numericConditionMatches(knownValue, condition)) {
				score += 1;
			}
		}
	}

	return score;
}

export function scoreChoiceTransitionTarget(sourceRecord: DialogueRecord, candidate: DialogueRecord): number {
	const knownJournalValues = collectKnownJournalValuesAfterResult(sourceRecord);
	const knownItemValues = collectKnownItemValues(sourceRecord.conditions);
	let score = countMatchingSpeakerConditions(sourceRecord.speakerConditions, candidate.speakerConditions);

	for (const condition of candidate.conditions) {
		if (
			condition.kind === 'journal'
			&& condition.questId !== undefined
			&& condition.value !== undefined
		) {
			const knownValue = knownJournalValues.get(condition.questId);
			if (knownValue !== undefined && journalConditionMatches(knownValue, condition)) {
				score += 1;
			}
		}

		if (
			condition.kind === 'item'
			&& condition.questId !== undefined
			&& condition.value !== undefined
		) {
			const knownValue = knownItemValues.get(condition.questId);
			if (knownValue !== undefined && numericConditionMatches(knownValue, condition)) {
				score += 1;
			}
		}
	}

	return score;
}

export function speakerConditionsAreCompatible(sourceConditions: Condition[], candidateConditions: Condition[]): boolean {
	const sourceValuesByLabel = new Map<string, string>();
	for (const condition of sourceConditions) {
		const parsed = parseSpeakerConditionDisplayText(condition.displayText);
		if (!parsed) {
			continue;
		}
		sourceValuesByLabel.set(parsed.label, parsed.value.toLowerCase());
	}

	for (const condition of candidateConditions) {
		const parsed = parseSpeakerConditionDisplayText(condition.displayText);
		if (!parsed) {
			continue;
		}

		const sourceValue = sourceValuesByLabel.get(parsed.label);
		if (
			sourceValue !== undefined
			&& !speakerConditionValuesAreCompatible(parsed.label, sourceValue, parsed.value)
		) {
			return false;
		}
	}

	return true;
}

export function countMatchingSpeakerConditions(sourceConditions: Condition[], candidateConditions: Condition[]): number {
	const sourceValuesByLabel = new Map<string, string>();
	for (const condition of sourceConditions) {
		const parsed = parseSpeakerConditionDisplayText(condition.displayText);
		if (!parsed) {
			continue;
		}
		sourceValuesByLabel.set(parsed.label, parsed.value.toLowerCase());
	}

	let count = 0;
	for (const condition of candidateConditions) {
		const parsed = parseSpeakerConditionDisplayText(condition.displayText);
		if (!parsed) {
			continue;
		}

		const sourceValue = sourceValuesByLabel.get(parsed.label);
		if (
			sourceValue !== undefined
			&& speakerConditionValuesAreCompatible(parsed.label, sourceValue, parsed.value)
		) {
			count += 1;
		}
	}

	return count;
}

export function numericConditionsAreCompatible(
	sourceConditions: Condition[],
	candidateConditions: Condition[],
	kinds: Array<Condition['kind']>,
): boolean {
	for (const sourceCondition of sourceConditions) {
		if (!isStructuredNumericCondition(sourceCondition, kinds)) {
			continue;
		}

		for (const candidateCondition of candidateConditions) {
			if (!isStructuredNumericCondition(candidateCondition, kinds)) {
				continue;
			}
			if (sourceCondition.kind !== candidateCondition.kind || sourceCondition.questId !== candidateCondition.questId) {
				continue;
			}
			if (!numericConditionRangesOverlap(sourceCondition, candidateCondition)) {
				return false;
			}
		}
	}

	return true;
}

export function isStructuredNumericCondition(condition: Condition, kinds: Array<Condition['kind']>): boolean {
	return kinds.includes(condition.kind)
		&& condition.questId !== undefined
		&& condition.value !== undefined
		&& condition.operator !== undefined;
}

export function numericConditionRangesOverlap(left: Condition, right: Condition): boolean {
	return numericConditionRangesAreCompatible(left, right);
}

export function collectKnownJournalValuesAfterResult(record: DialogueRecord): Map<string, number> {
	const knownValues = new Map<string, number>();
	for (const condition of record.conditions) {
		if (
			condition.kind === 'journal'
			&& condition.questId !== undefined
			&& condition.value !== undefined
			&& condition.operator === '='
		) {
			knownValues.set(condition.questId, condition.value);
		}
	}

	for (const action of record.resultActions) {
		if (
			action.kind === 'journal-set'
			&& action.targetQuestId !== undefined
			&& action.targetJournalIndex !== undefined
		) {
			knownValues.set(action.targetQuestId, action.targetJournalIndex);
		}
	}

	return knownValues;
}

export function collectKnownItemValues(conditions: Condition[]): Map<string, number> {
	const knownValues = new Map<string, number>();
	for (const condition of conditions) {
		if (
			condition.kind !== 'item'
			|| condition.questId === undefined
			|| condition.value === undefined
			|| condition.operator !== '='
		) {
			continue;
		}

		knownValues.set(condition.questId, condition.value);
	}

	return knownValues;
}

export function journalConditionMatches(value: number, condition: Condition): boolean {
	if (condition.value === undefined) {
		return true;
	}

	return numericConditionMatches(value, condition);
}

export function numericConditionMatches(value: number, condition: Condition): boolean {
	if (condition.value === undefined) {
		return true;
	}

	switch (condition.operator) {
		case '<=':
			return value <= condition.value;
		case '>=':
			return value >= condition.value;
		case '<':
			return value < condition.value;
		case '>':
			return value > condition.value;
		case '!=':
			return value !== condition.value;
		case '==':
			return value === condition.value;
		case '=':
		default:
			return value === condition.value;
	}
}

export function groupBranchFamilies(records: DialogueRecord[], questIds: string[]): BranchFamily[] {
	const familyMap = new Map<string, BranchFamily>();
	for (const record of records) {
		const nonSpeakerKey = normalizeConditionKey(record.nonSpeakerConditions);
		const resultKey = record.resultActions.map((action) => action.displayText).join('|');
		const bodyKey = record.bodyText.trim();
		const familyKey = [record.type, record.topic, record.phaseAnchor, nonSpeakerKey, resultKey, bodyKey].join('::');
		const existing = familyMap.get(familyKey);
		if (existing) {
			existing.records.push(record);
			continue;
		}

		const progressionTarget = firstJournalResult(record.resultActions, questIds);
		familyMap.set(familyKey, {
			id: createNodeId(`family:${familyKey}`),
			type: record.type,
			topic: record.topic,
			phaseAnchor: record.phaseAnchor,
			records: [record],
			sharedConditions: record.nonSpeakerConditions,
			results: record.resultActions,
			bodyText: record.bodyText,
			priority: computeFamilyPriority(record.phaseAnchor, progressionTarget, record.resultActions),
			progressionTarget,
		});
	}

	return [...familyMap.values()];
}

export function compareBranchFamilies(left: BranchFamily, right: BranchFamily): number {
	if (left.type === right.type && left.topic === right.topic) {
		return compareFamilyChoiceBreadth(left, right)
			|| compareFamilyInfoOrder(left, right)
			|| left.priority - right.priority
			|| compareNullableNumbers(left.progressionTarget, right.progressionTarget)
			|| left.records[0]?.file.path.localeCompare(right.records[0]?.file.path ?? '')
			|| 0;
	}

	return left.priority - right.priority
		|| compareNullableNumbers(left.progressionTarget, right.progressionTarget)
		|| left.topic.localeCompare(right.topic)
		|| left.records[0]?.file.path.localeCompare(right.records[0]?.file.path ?? '')
		|| 0;
}

export function compareFamilyChoiceBreadth(left: BranchFamily, right: BranchFamily): number {
	const leftChoices = familyChoiceValues(left);
	const rightChoices = familyChoiceValues(right);
	if (leftChoices.length === 0 && rightChoices.length === 0) {
		return 0;
	}

	return leftChoices.length - rightChoices.length
		|| compareNullableNumbers(maxNumber(leftChoices), maxNumber(rightChoices));
}

export function familyChoiceValues(family: BranchFamily): number[] {
	return uniqueNumbers(
		family.results
			.filter((action) => action.kind === 'choice-set' && action.choiceValue !== undefined)
			.map((action) => action.choiceValue as number),
	);
}

export function compareDialogueRecords(left: DialogueRecord, right: DialogueRecord): number {
	return compareInfoOrder(left, right)
		|| normalizeConditionKey(left.speakerConditions).localeCompare(normalizeConditionKey(right.speakerConditions))
		|| left.file.path.localeCompare(right.file.path);
}

export function compareFamilyInfoOrder(left: BranchFamily, right: BranchFamily): number {
	return minFamilyInfoOrder(left) - minFamilyInfoOrder(right);
}

export function minFamilyInfoOrder(family: BranchFamily): number {
	return Math.min(...family.records.map((record) => record.infoOrder), Number.MAX_SAFE_INTEGER);
}

export function compareInfoOrder(left: DialogueRecord, right: DialogueRecord): number {
	if (left.topic !== right.topic || left.type !== right.type) {
		return 0;
	}

	return left.infoOrder - right.infoOrder;
}

export function determinePhaseAnchor(
	conditions: Condition[],
	resultActions: ResultAction[],
	phaseIndices: number[],
	questIds: string[],
): number {
	const conditionAnchor = determineJournalConditionPhaseAnchor(conditions, phaseIndices, questIds);
	const journalResult = firstJournalResultAction(resultActions, questIds);
	if (journalResult?.targetJournalIndex !== undefined) {
		const resultAnchor = previousPhaseBefore(journalResult.targetJournalIndex, phaseIndices);
		if (
			!conditions.some((condition) => condition.kind === 'choice')
			|| journalResultCanRunBeforeTarget(conditions, journalResult)
		) {
			return resultAnchor;
		}
	}

	if (conditionAnchor !== null && conditions.some((condition) => condition.kind === 'choice')) {
		return conditionAnchor;
	}

	if (conditionAnchor !== null) {
		return conditionAnchor;
	}

	return phaseIndices[0] ?? 0;
}

export function journalResultCanRunBeforeTarget(conditions: Condition[], resultAction: ResultAction): boolean {
	if (
		resultAction.targetQuestId === undefined
		|| resultAction.targetJournalIndex === undefined
	) {
		return true;
	}

	const targetQuestConditions = conditions.filter(
		(condition) => condition.kind === 'journal'
			&& condition.questId === resultAction.targetQuestId
			&& condition.value !== undefined,
	);
	if (targetQuestConditions.length === 0) {
		return true;
	}

	return targetQuestConditions.every(
		(condition) => journalConditionAllowsValueBeforeTarget(condition, resultAction.targetJournalIndex as number),
	);
}

export function journalConditionAllowsValueBeforeTarget(condition: Condition, targetJournalIndex: number): boolean {
	if (condition.value === undefined) {
		return true;
	}

	switch (condition.operator) {
		case '=':
		case '==':
			return condition.value < targetJournalIndex;
		case '>':
		case '>=':
			return condition.value < targetJournalIndex;
		case '<':
		case '<=':
			return targetJournalIndex > PRE_JOURNAL_PHASE;
		case '!=':
		default:
			return condition.value !== PRE_JOURNAL_PHASE || targetJournalIndex > PRE_JOURNAL_PHASE + 1;
	}
}

export function determineJournalConditionPhaseAnchor(
	conditions: Condition[],
	phaseIndices: number[],
	questIds: string[],
): number | null {
	const journalConditions = conditions.filter(
		(condition) => condition.kind === 'journal'
			&& condition.value !== undefined
			&& condition.questId !== undefined
			&& questIds.includes(condition.questId),
	);
	if (journalConditions.length === 0) {
		return conditions.some((condition) => condition.kind === 'journal') ? phaseIndices[0] ?? 0 : null;
	}

	const matchingPhases = phaseIndices.filter(
		(phaseValue) => journalConditions.every((condition) => journalConditionMatches(phaseValue, condition)),
	);
	if (matchingPhases.length > 0) {
		return matchingPhases[0] ?? phaseIndices[0] ?? 0;
	}

	return nearestPhaseForJournalCondition(journalConditions[0], phaseIndices);
}

export function linkedJournalConditionPhases(
	conditions: Condition[],
	milestones: JournalMilestone[],
	questIds: string[],
): number[] {
	const journalConditions = conditions.filter(
		(condition) => condition.kind === 'journal'
			&& condition.value !== undefined
			&& condition.questId !== undefined
			&& questIds.includes(condition.questId),
	);
	if (journalConditions.length === 0) {
		return [];
	}

	const conditionsByQuest = groupJournalConditionsByQuest(journalConditions);
	const matchingMilestones = milestones
		.filter((milestone) => milestone.index > 0)
		.filter((milestone) => {
			const questConditions = conditionsByQuest.get(milestone.questId);
			return questConditions !== undefined
				&& questConditions.every((condition) => journalConditionMatches(milestone.index, condition));
		})
		.sort(compareJournalMilestones);
	const firstMatching = matchingMilestones[0];
	if (!firstMatching) {
		return [];
	}
	if (!firstMatching.finished) {
		return [firstMatching.index];
	}

	return uniqueNumbers(matchingMilestones
		.filter((milestone) => milestone.finished)
		.map((milestone) => milestone.index));
}

export function groupJournalConditionsByQuest(conditions: Condition[]): Map<string, Condition[]> {
	const conditionsByQuest = new Map<string, Condition[]>();
	for (const condition of conditions) {
		if (condition.questId === undefined) {
			continue;
		}

		const questConditions = conditionsByQuest.get(condition.questId) ?? [];
		questConditions.push(condition);
		conditionsByQuest.set(condition.questId, questConditions);
	}
	return conditionsByQuest;
}

export function compareJournalMilestones(left: JournalMilestone, right: JournalMilestone): number {
	const byIndex = left.index - right.index;
	if (byIndex !== 0) {
		return byIndex;
	}

	return left.file.path.localeCompare(right.file.path);
}

export function nearestPhaseForJournalCondition(condition: Condition | undefined, phaseIndices: number[]): number | null {
	if (!condition || condition.value === undefined) {
		return phaseIndices[0] ?? 0;
	}

	switch (condition.operator) {
		case '>':
			return firstPhaseAbove(condition.value, phaseIndices) ?? nearestPhaseAtOrBelow(condition.value, phaseIndices);
		case '>=':
		case '=':
		case '==':
			return firstPhaseAtOrAbove(condition.value, phaseIndices) ?? nearestPhaseAtOrBelow(condition.value, phaseIndices);
		case '<':
			return lastPhaseBelow(condition.value, phaseIndices) ?? phaseIndices[0] ?? condition.value;
		case '<=':
			return nearestPhaseAtOrBelow(condition.value, phaseIndices);
		case '!=':
		default:
			return nearestPhaseAtOrBelow(condition.value, phaseIndices);
	}
}

export function nearestPhaseAtOrBelow(value: number, phaseIndices: number[]): number {
	const eligible = phaseIndices.filter((phaseValue) => phaseValue <= value);
	if (eligible.length > 0) {
		return eligible[eligible.length - 1] ?? phaseIndices[0] ?? value;
	}
	return phaseIndices[0] ?? value;
}

export function firstPhaseAtOrAbove(value: number, phaseIndices: number[]): number | null {
	return phaseIndices.find((phaseValue) => phaseValue >= value) ?? null;
}

export function firstPhaseAbove(value: number, phaseIndices: number[]): number | null {
	return phaseIndices.find((phaseValue) => phaseValue > value) ?? null;
}

export function lastPhaseBelow(value: number, phaseIndices: number[]): number | null {
	const lower = phaseIndices.filter((phaseValue) => phaseValue < value);
	return lower[lower.length - 1] ?? null;
}

export function previousPhaseBefore(value: number, phaseIndices: number[]): number {
	const lower = phaseIndices.filter((phaseValue) => phaseValue < value);
	if (lower.length > 0) {
		return lower[lower.length - 1] ?? phaseIndices[0] ?? value;
	}
	return Math.min(PRE_JOURNAL_PHASE, value);
}

export function computeFamilyPriority(phaseAnchor: number, progressionTarget: number | null, resultActions: ResultAction[]): number {
	if (progressionTarget !== null && progressionTarget > phaseAnchor) {
		return 0;
	}
	if (resultActions.some((action) => action.kind === 'choice-set')) {
		return 1;
	}
	if (progressionTarget !== null && progressionTarget <= phaseAnchor) {
		return 3;
	}
	return 2;
}

export function firstJournalResult(resultActions: ResultAction[], questIds: string[]): number | null {
	return firstJournalResultAction(resultActions, questIds)?.targetJournalIndex ?? null;
}

export function firstJournalResultAction(resultActions: ResultAction[], questIds: string[]): ResultAction | null {
	let earliestTarget: number | null = null;
	let earliestAction: ResultAction | null = null;
	for (const action of resultActions) {
		if (
			action.kind === 'journal-set'
			&& action.targetJournalIndex !== undefined
			&& action.targetQuestId !== undefined
			&& questIds.includes(action.targetQuestId)
		) {
			if (earliestTarget === null || action.targetJournalIndex < earliestTarget) {
				earliestTarget = action.targetJournalIndex;
				earliestAction = action;
			}
		}
	}
	return earliestAction;
}

export function groupRecordsByTopic(records: DialogueRecord[]): Map<string, DialogueRecord[]> {
	const grouped = new Map<string, DialogueRecord[]>();
	for (const record of records) {
		const topicRecords = grouped.get(record.topic) ?? [];
		topicRecords.push(record);
		grouped.set(record.topic, topicRecords);
	}
	return grouped;
}

export function groupRecordsByNormalizedTopic(records: DialogueRecord[]): Map<string, DialogueRecord[]> {
	const grouped = new Map<string, DialogueRecord[]>();
	for (const record of records) {
		const topicKey = normalizeTopicKey(record.topic);
		const topicRecords = grouped.get(topicKey) ?? [];
		topicRecords.push(record);
		grouped.set(topicKey, topicRecords);
	}

	for (const [topicKey, topicRecords] of grouped) {
		grouped.set(topicKey, orderTopicRecordsByInfoSequence(topicRecords));
	}
	return grouped;
}

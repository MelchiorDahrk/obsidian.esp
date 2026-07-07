/**
 * @file Branch families, phase assignment, and transition-target resolution.
 *
 * The semantic middle layer of canvas generation, between discovery (raw
 * {@link DialogueRecord}s) and layout (canvas nodes). Three responsibilities:
 *
 * 1. **Family grouping** — records with the same topic, phase, non-speaker
 *    conditions, results, and body collapse into one {@link BranchFamily}
 *    (one card), so speaker variants don't multiply the canvas.
 * 2. **Phase anchoring** — each record/family is assigned the journal stage
 *    ("phase") it belongs to, derived from its journal conditions and
 *    progression results ({@link determinePhaseAnchor} and friends), and the
 *    phases are ordered into a {@link PhaseGraph}.
 * 3. **Transition targets** — given a choice or AddTopic, which records can
 *    execution actually flow to? The `conditionsCanFollow*` predicates model
 *    the engine's filter evaluation (speaker identity, numeric ranges,
 *    journal state known after the source's Result runs), and the `score*`
 *    functions rank ambiguous candidates.
 *
 * Everything here is pure; no Obsidian API use.
 */
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

/**
 * Whether the record's journal conditions on the selected quest all admit
 * `phaseValue`. Records without such conditions return `false` — "can run"
 * here means "is explicitly gated to this phase".
 */
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

/** Whether the record is gated behind a `Choice` filter. */
export function recordHasChoiceCondition(record: DialogueRecord): boolean {
	return record.conditions.some((condition) => condition.kind === 'choice');
}

/** Buckets families by topic, preserving input order. */
export function groupFamiliesByTopic(families: BranchFamily[]): Map<string, BranchFamily[]> {
	const grouped = new Map<string, BranchFamily[]>();
	for (const family of families) {
		const topicFamilies = grouped.get(family.topic) ?? [];
		topicFamilies.push(family);
		grouped.set(family.topic, topicFamilies);
	}
	return grouped;
}

/**
 * Buckets families by the (lowest) choice value gating them; ungated
 * families form the `null` "root" group. Sorted root-first, then by value.
 */
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

/**
 * Assembles the {@link PhaseGraph}: families bucketed and sorted per phase,
 * topic segments within each phase, phase-to-phase transitions from
 * progression targets, and a topological phase order for the columns.
 */
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

/**
 * Kahn's-algorithm ordering of phases along their transition edges, with
 * numeric value as the tiebreaker; unreachable phases (cycles) append at the
 * end in numeric order.
 */
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

/** Indexes choice groups by their key (`'root'` or the choice value). */
export function mapChoiceGroupsByChoice(choiceGroups: ChoiceGroup[]): Map<string, ChoiceGroup> {
	const groupsByChoice = new Map<string, ChoiceGroup>();
	for (const group of choiceGroups) {
		groupsByChoice.set(choiceGroupKey(group.choiceValue), group);
	}
	return groupsByChoice;
}

/** Choice values that any family's results set (`Choice "…" n`). */
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

/**
 * The groups that start conversation trees: the root group plus any choice
 * group whose value is never emitted locally (its choice is set elsewhere).
 */
export function resolveRootChoiceGroups(choiceGroups: ChoiceGroup[]): ChoiceGroup[] {
	const emittedChoices = collectEmittedChoices(choiceGroups.flatMap((group) => group.families));
	return choiceGroups.filter(
		(group) => group.choiceValue === null || !emittedChoices.has(group.choiceValue),
	);
}

/**
 * Vertical lane order for a phase's choice groups: progression-bearing
 * groups first (lowest priority number), then by their forward progression
 * target, then by choice value.
 */
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

/** Ascending by choice value, `null` (root) last. */
export function compareChoiceGroups(left: ChoiceGroup, right: ChoiceGroup): number {
	return compareNullableNumbers(left.choiceValue, right.choiceValue);
}

/** Dedup key for a choice-set action (value + display text). */
export function choiceActionIdentity(action: ResultAction): string {
	return `${action.choiceValue ?? ''}:${action.displayText}`;
}

/** Map key for a choice group (`'root'` for the ungated group). */
export function choiceGroupKey(choiceValue: number | null): string {
	return choiceValue === null ? 'root' : String(choiceValue);
}

/**
 * Whether the record is gated on a bounded journal *range* (both a lower and
 * an upper bound on some quest) — such records are reachable from several
 * phases and get special jump-node routing.
 */
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

/**
 * Whether the record can be the *introduction point* for topics wikilinked
 * in its body: it must be un-choiced and gated on `Journal == 0` (i.e. it is
 * the pre-quest conversation where the player first hears the topic).
 */
export function recordCanIntroduceBodyTopic(record: DialogueRecord): boolean {
	return !record.conditions.some((condition) => condition.kind === 'choice')
		&& record.conditions.some((condition) => condition.kind === 'journal'
			&& condition.value === 0
			&& (condition.operator === '=' || condition.operator === '=='));
}

/**
 * Whether some record at `sourcePhase` explicitly journals the quest to
 * `targetPhase` — if so, no implied phase-bridge edge is needed.
 */
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

/**
 * Resolves which records an `AddTopic "targetTopic"` should connect to.
 * Candidates must be condition-compatible with the source; ambiguity is
 * broken by (in order) canvas position when a layout context is available
 * (first quest-tree column wins), then condition-match score, then falling
 * back to the topic's first record.
 *
 * @param questIds When given (and no context), candidates must also carry a
 *   journal filter on the selected quest — used during relevance analysis.
 */
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

/**
 * Position-aware AddTopic target filter: projects the candidates onto their
 * laid-out canvas nodes and keeps those in the topic's first (leftmost)
 * column (see add-topic.ts). Empty when no candidate has a node yet.
 */
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

/** Whether the record has a journal filter on one of the selected quests. */
export function recordHasSelectedQuestJournalFilter(record: DialogueRecord, questIds: string[]): boolean {
	return hasSelectedQuestJournalFilter(record.conditions, questIds);
}

/** Whether the record is gated on exactly `Journal == phaseValue`. */
export function recordHasExactJournalCondition(record: DialogueRecord, phaseValue: number, questIds: string[]): boolean {
	return exactJournalConditionQuestIds(record, phaseValue, questIds).length > 0;
}

/**
 * Whether the two records' exact journal conditions (at their respective
 * phases) reference at least one quest in common.
 */
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

/** Quest IDs on which the record requires exactly `Journal == phaseValue`. */
export function exactJournalConditionQuestIds(record: DialogueRecord, phaseValue: number, questIds: string[]): string[] {
	return record.conditions
		.filter((condition) => condition.kind === 'journal'
			&& condition.questId !== undefined
			&& questIds.includes(condition.questId)
			&& condition.value === phaseValue
			&& (condition.operator === '=' || condition.operator === '=='))
		.map((condition) => condition.questId as string);
}

/**
 * Whether execution can plausibly continue from `sourceRecord` into
 * `candidate` when the quest advances to `targetPhase`: compatible speaker,
 * numeric, and journal conditions, and every journal condition on the
 * candidate must admit the target phase.
 */
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

/** Whether the two records' journal ranges can hold simultaneously. */
export function journalConditionsAreCompatible(sourceConditions: Condition[], candidateConditions: Condition[]): boolean {
	return numericConditionsAreCompatible(sourceConditions, candidateConditions, ['journal']);
}

/**
 * Mutates each record's `infoOrder` to its position in the topic's engine
 * evaluation sequence (see {@link orderTopicRecordsByInfoSequence}).
 */
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

/**
 * Pulls choice-source records back to the earliest phase of the records
 * their choices lead to (iterated to a fixed point). A prompt must render in
 * the same phase as its answers, even when its own conditions say later.
 */
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

/**
 * Marks indirectly-relevant records that both add a topic and set a choice
 * so their choice edges are suppressed — their choice flow belongs to
 * another quest's conversation and would only add noise here.
 */
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

/**
 * Resolves which records a `Choice n` transition flows to: same-topic
 * records gated on that value whose conditions are compatible with at least
 * one source record. When several qualify, only the best condition-match
 * score is kept (unless nothing scores above zero, in which case all stay).
 */
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

/**
 * Orders a topic's records the way the engine stores them: chains records by
 * their DiagID/PrevID links (depth-first from chain heads), falling back to
 * speaker-condition/path order for unlinked records. This is the "info
 * sequence" that `infoOrder` indexes into.
 */
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

/**
 * Whether `candidate` can be the response the engine picks after
 * `sourceRecord` sets `Choice choiceValue`: the candidate's choice filters
 * must accept the value, speaker and numeric conditions must be compatible,
 * and any journal/item conditions must hold against the values known to be
 * true *after* the source's Result script runs.
 */
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

/**
 * {@link conditionsCanFollowChoice}'s counterpart for `AddTopic`: the
 * candidate must be an un-choiced Topic record whose conditions are
 * compatible with the source's state (including post-Result journal values).
 */
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

/**
 * Relevance score for an AddTopic candidate: one point per speaker condition
 * matching the source's, plus one per journal/item condition satisfied by
 * the source's post-Result state. Used to break ties between candidates.
 */
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

/** Same scoring as {@link scoreAddTopicTransitionTarget}, for choice targets. */
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

/**
 * Whether one NPC can satisfy both records' speaker conditions: for every
 * label (ID, Faction, Race, ...) both sides define, the values must be
 * compatible. Labels only one side defines don't constrain anything.
 */
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

/** Counts labels where both sides define compatible speaker values. */
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

/**
 * Whether the numeric conditions of the given kinds can hold simultaneously:
 * for every same-kind, same-subject (questId) pair across the two records,
 * their value ranges must intersect.
 */
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

/** Whether the condition has all parts needed for range comparison. */
export function isStructuredNumericCondition(condition: Condition, kinds: Array<Condition['kind']>): boolean {
	return kinds.includes(condition.kind)
		&& condition.questId !== undefined
		&& condition.value !== undefined
		&& condition.operator !== undefined;
}

/** Alias of {@link numericConditionRangesAreCompatible} for Condition pairs. */
export function numericConditionRangesOverlap(left: Condition, right: Condition): boolean {
	return numericConditionRangesAreCompatible(left, right);
}

/**
 * Journal values known to hold *after* the record's Result runs: exact
 * (`=`) journal conditions, overridden by any `Journal` sets in the results.
 * This is the state candidate follow-up conditions are checked against.
 */
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

/** Item counts pinned by exact (`=`) item conditions, keyed by item ID. */
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

/** Whether a journal stage value satisfies the condition (valueless = yes). */
export function journalConditionMatches(value: number, condition: Condition): boolean {
	if (condition.value === undefined) {
		return true;
	}

	return numericConditionMatches(value, condition);
}

/** Evaluates `value <op> condition.value` for the condition's operator. */
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

/**
 * Collapses records into {@link BranchFamily}s. The family key is
 * type + topic + phase + non-speaker conditions + results + body text, so
 * records that differ only in *who says the line* (speaker variants) share
 * one card. The first record provides the family's display data.
 */
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

/**
 * Display order for families. Within one topic: fewer emitted choices first,
 * then engine info order; across topics: priority, progression target, then
 * name/path for stability.
 */
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

/** Orders families by how many (and how high) choices their results emit. */
export function compareFamilyChoiceBreadth(left: BranchFamily, right: BranchFamily): number {
	const leftChoices = familyChoiceValues(left);
	const rightChoices = familyChoiceValues(right);
	if (leftChoices.length === 0 && rightChoices.length === 0) {
		return 0;
	}

	return leftChoices.length - rightChoices.length
		|| compareNullableNumbers(maxNumber(leftChoices), maxNumber(rightChoices));
}

/** Distinct choice values the family's results set, ascending. */
export function familyChoiceValues(family: BranchFamily): number[] {
	return uniqueNumbers(
		family.results
			.filter((action) => action.kind === 'choice-set' && action.choiceValue !== undefined)
			.map((action) => action.choiceValue as number),
	);
}

/** Stable record order: info sequence, then speaker conditions, then path. */
export function compareDialogueRecords(left: DialogueRecord, right: DialogueRecord): number {
	return compareInfoOrder(left, right)
		|| normalizeConditionKey(left.speakerConditions).localeCompare(normalizeConditionKey(right.speakerConditions))
		|| left.file.path.localeCompare(right.file.path);
}

/** Orders families by their earliest record's engine info order. */
export function compareFamilyInfoOrder(left: BranchFamily, right: BranchFamily): number {
	return minFamilyInfoOrder(left) - minFamilyInfoOrder(right);
}

/** The smallest `infoOrder` among the family's records. */
export function minFamilyInfoOrder(family: BranchFamily): number {
	return Math.min(...family.records.map((record) => record.infoOrder), Number.MAX_SAFE_INTEGER);
}

/** Info-order comparison; ties (different topics/types) compare equal. */
export function compareInfoOrder(left: DialogueRecord, right: DialogueRecord): number {
	if (left.topic !== right.topic || left.type !== right.type) {
		return 0;
	}

	return left.infoOrder - right.infoOrder;
}

/**
 * Assigns a record's phase (the journal-stage column it renders in).
 *
 * A record that *advances* the quest to stage N belongs to the phase before
 * N — it is the dialogue that causes the transition. That result-derived
 * anchor wins unless the record sits behind a Choice whose own journal
 * conditions place it at/after the target (then the condition anchor wins,
 * as the choice chain started earlier). Records with journal conditions but
 * no matching phase snap to the nearest phase; unconditioned records default
 * to the first phase.
 */
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

/**
 * Whether the record's own journal conditions permit it to run *before* the
 * stage its result sets — i.e. the journal-set is a genuine progression and
 * not a re-assertion of an already-reached stage.
 */
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

/** Per-condition helper for {@link journalResultCanRunBeforeTarget}. */
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

/**
 * Phase anchor from journal conditions alone: the first phase satisfying
 * all of them, the nearest phase when none does, the first phase when the
 * only journal conditions concern other quests, or `null` when there are no
 * journal conditions at all.
 */
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

/**
 * The milestone indices whose journal nodes should link into a record with
 * these conditions: normally just the first satisfying milestone, but when
 * that milestone is a `Finished` ending, every satisfying finished ending
 * links in (the record follows the quest's completion however it ended).
 */
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

/** Buckets journal conditions by the quest ID they test. */
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

/** Ascending by index, then by file path for stability. */
export function compareJournalMilestones(left: JournalMilestone, right: JournalMilestone): number {
	const byIndex = left.index - right.index;
	if (byIndex !== 0) {
		return byIndex;
	}

	return left.file.path.localeCompare(right.file.path);
}

/**
 * Best-effort phase for a journal condition whose exact value has no
 * milestone: picks the closest existing phase in the direction the operator
 * implies (e.g. `> 40` snaps to the first phase above 40).
 */
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

/** Highest phase <= value, else the first phase, else the value itself. */
export function nearestPhaseAtOrBelow(value: number, phaseIndices: number[]): number {
	const eligible = phaseIndices.filter((phaseValue) => phaseValue <= value);
	if (eligible.length > 0) {
		return eligible[eligible.length - 1] ?? phaseIndices[0] ?? value;
	}
	return phaseIndices[0] ?? value;
}

/** Lowest phase >= value, or `null`. */
export function firstPhaseAtOrAbove(value: number, phaseIndices: number[]): number | null {
	return phaseIndices.find((phaseValue) => phaseValue >= value) ?? null;
}

/** Lowest phase > value, or `null`. */
export function firstPhaseAbove(value: number, phaseIndices: number[]): number | null {
	return phaseIndices.find((phaseValue) => phaseValue > value) ?? null;
}

/** Highest phase < value, or `null`. */
export function lastPhaseBelow(value: number, phaseIndices: number[]): number | null {
	const lower = phaseIndices.filter((phaseValue) => phaseValue < value);
	return lower[lower.length - 1] ?? null;
}

/**
 * The phase a record that journals to `value` renders in: the highest phase
 * below the target, or the pre-journal phase when the target is the first.
 */
export function previousPhaseBefore(value: number, phaseIndices: number[]): number {
	const lower = phaseIndices.filter((phaseValue) => phaseValue < value);
	if (lower.length > 0) {
		return lower[lower.length - 1] ?? phaseIndices[0] ?? value;
	}
	return Math.min(PRE_JOURNAL_PHASE, value);
}

/**
 * Lane priority within a phase: 0 = advances the quest, 1 = opens choices,
 * 2 = plain dialogue, 3 = re-journals an already-reached stage.
 */
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

/** The lowest journal stage the results set on the selected quest, if any. */
export function firstJournalResult(resultActions: ResultAction[], questIds: string[]): number | null {
	return firstJournalResultAction(resultActions, questIds)?.targetJournalIndex ?? null;
}

/** The journal-set action with the lowest target stage on the selected quest. */
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

/** Buckets records by exact topic string, preserving input order. */
export function groupRecordsByTopic(records: DialogueRecord[]): Map<string, DialogueRecord[]> {
	const grouped = new Map<string, DialogueRecord[]>();
	for (const record of records) {
		const topicRecords = grouped.get(record.topic) ?? [];
		topicRecords.push(record);
		grouped.set(record.topic, topicRecords);
	}
	return grouped;
}

/**
 * Buckets records by normalized topic key, each bucket ordered by the
 * engine's info sequence — the shape transition-target resolution expects.
 */
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

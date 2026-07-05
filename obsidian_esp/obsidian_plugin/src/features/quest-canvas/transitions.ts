import { addEdge, addTextNode, edgeEndpoint, findCanvasNode, isChoiceNode, nodeCanReach } from './emit';
import {
	conditionsCanFollowJournalPhase,
	groupRecordsByNormalizedTopic,
	groupRecordsByTopic,
	hasJournalRangeCondition,
	linkedJournalConditionPhases,
	orderTopicRecordsByInfoSequence,
	phaseHasExplicitJournalProgression,
	recordCanIntroduceBodyTopic,
	recordCanRunAtPhase,
	recordHasChoiceCondition,
	recordHasExactJournalCondition,
	recordsShareExactJournalQuest,
	resolveAddTopicTransitionTargets,
	resolveChoiceTransitionTargets,
} from './families';
import {
	type AddTopicTransition,
	type BranchFamily,
	type CanvasEdge,
	type CanvasLayoutContext,
	type DialogueRecord,
	type JournalMilestone,
	JUMP_COLOR,
	JUMP_WIDTH,
	type PendingPhaseEntryEdge,
} from './model';
import { createNodeId, extractBodyTopicLinks, measureTextHeight, normalizeTopicKey, uniqueNumbers } from './utils';

export function entryCanFollowPhaseMilestone(
	entryId: string,
	families: BranchFamily[],
	context: CanvasLayoutContext,
	phaseValue: number,
	questIds: string[],
): boolean {
	const entryRecords = families.flatMap((family) => family.records).filter(
		(record) => context.recordEntryNodeIds.get(record.id) === entryId,
	);
	if (entryRecords.length === 0) {
		return true;
	}

	return entryRecords.some((record) => recordCanRunAtPhase(record, phaseValue, questIds));
}

export function connectPendingPhaseEntryEdges(context: CanvasLayoutContext, pendingEdges: PendingPhaseEntryEdge[]): void {
	const orderedEdges = [...pendingEdges].sort(
		(left, right) => Number(pendingPhaseEntryHasChoiceCondition(left, context))
			- Number(pendingPhaseEntryHasChoiceCondition(right, context))
			|| left.phaseValue - right.phaseValue
			|| left.entryId.localeCompare(right.entryId),
	);

	for (const pendingEdge of orderedEdges) {
		if (nodeCanReach(context, pendingEdge.phaseNodeId, pendingEdge.entryId)) {
			continue;
		}

		addEdge(
			context,
			`${pendingEdge.phaseNodeId}:${pendingEdge.entryId}`,
			pendingEdge.phaseNodeId,
			'right',
			pendingEdge.entryId,
			'left',
		);
	}
}

export function pendingPhaseEntryHasChoiceCondition(
	pendingEdge: PendingPhaseEntryEdge,
	context: CanvasLayoutContext,
): boolean {
	return pendingEdge.families
		.flatMap((family) => family.records)
		.some((record) => (
			context.recordEntryNodeIds.get(record.id) === pendingEdge.entryId
			&& record.conditions.some((condition) => condition.kind === 'choice')
		));
}

export function connectJournalConditionMilestones(
	context: CanvasLayoutContext,
	records: DialogueRecord[],
	milestones: JournalMilestone[],
	questIds: string[],
): void {
	interface JournalConditionMilestoneEdge {
		phaseValue: number;
		phaseNodeId: string;
		entryNodeId: string;
	}

	const orderedRecords = [...records].sort((left, right) => (
		Number(recordHasChoiceCondition(left)) - Number(recordHasChoiceCondition(right))
		|| left.sourcePhaseAnchor - right.sourcePhaseAnchor
		|| left.infoOrder - right.infoOrder
		|| left.file.path.localeCompare(right.file.path)
	));
	const candidateEdges: JournalConditionMilestoneEdge[] = [];
	const candidateEdgeKeys = new Set<string>();

	for (const record of orderedRecords) {
		const entryNodeId = context.recordEntryNodeIds.get(record.id);
		if (!entryNodeId) {
			continue;
		}

		for (const phaseValue of linkedJournalConditionPhases(record.conditions, milestones, questIds)) {
			const phaseNodeId = context.phaseNodeIds.get(phaseValue);
			if (!phaseNodeId) {
				continue;
			}

			const edgeKey = `${phaseNodeId}:${entryNodeId}`;
			if (candidateEdgeKeys.has(edgeKey)) {
				continue;
			}

			candidateEdges.push({ phaseValue, phaseNodeId, entryNodeId });
			candidateEdgeKeys.add(edgeKey);
		}
	}

	for (const candidateEdge of candidateEdges) {
		if (nodeCanReach(context, candidateEdge.phaseNodeId, candidateEdge.entryNodeId)) {
			continue;
		}
		if (hasReachableMilestoneParent(context, candidateEdge, candidateEdges)) {
			continue;
		}

		addEdge(
			context,
			`${candidateEdge.phaseNodeId}:${candidateEdge.entryNodeId}`,
			candidateEdge.phaseNodeId,
			'right',
			candidateEdge.entryNodeId,
			'left',
		);
	}

	pruneRedundantJournalConditionMilestoneEdges(context, candidateEdges);
}

export function hasReachableMilestoneParent(
	context: CanvasLayoutContext,
	candidateEdge: { phaseValue: number; entryNodeId: string },
	candidateEdges: Array<{ phaseValue: number; entryNodeId: string }>,
): boolean {
	for (const otherEdge of candidateEdges) {
		if (
			otherEdge.phaseValue !== candidateEdge.phaseValue
			|| otherEdge.entryNodeId === candidateEdge.entryNodeId
		) {
			continue;
		}

		if (
			nodeCanReach(context, otherEdge.entryNodeId, candidateEdge.entryNodeId)
			&& !nodeCanReach(context, candidateEdge.entryNodeId, otherEdge.entryNodeId)
		) {
			return true;
		}
	}

	return false;
}

export function pruneRedundantJournalConditionMilestoneEdges(
	context: CanvasLayoutContext,
	candidateEdges: Array<{ phaseValue: number; phaseNodeId: string; entryNodeId: string }>,
): void {
	const redundantEdgeIds = new Set<string>();
	const candidatesByPhaseNode = new Map<string, Array<{ phaseValue: number; phaseNodeId: string; entryNodeId: string }>>();
	for (const candidateEdge of candidateEdges) {
		const phaseCandidates = candidatesByPhaseNode.get(candidateEdge.phaseNodeId) ?? [];
		phaseCandidates.push(candidateEdge);
		candidatesByPhaseNode.set(candidateEdge.phaseNodeId, phaseCandidates);
	}

	for (const phaseCandidates of candidatesByPhaseNode.values()) {
		for (const candidateEdge of phaseCandidates) {
			const edge = context.edges.find((item) => (
				item.fromNode === candidateEdge.phaseNodeId
				&& item.fromSide === 'right'
				&& item.toNode === candidateEdge.entryNodeId
				&& item.toSide === 'left'
			));
			if (!edge) {
				continue;
			}

			const hasIndirectParent = phaseCandidates.some((otherEdge) => (
				otherEdge.phaseValue === candidateEdge.phaseValue
				&& otherEdge.entryNodeId !== candidateEdge.entryNodeId
				&& nodeCanReach(context, otherEdge.entryNodeId, candidateEdge.entryNodeId)
				&& !nodeCanReach(context, candidateEdge.entryNodeId, otherEdge.entryNodeId)
			));
			if (hasIndirectParent) {
				redundantEdgeIds.add(edge.id);
			}
		}
	}

	if (redundantEdgeIds.size === 0) {
		return;
	}

	context.edges = context.edges.filter((edge) => !redundantEdgeIds.has(edge.id));
	for (const edgeId of redundantEdgeIds) {
		context.edgeIds.delete(edgeId);
	}
}

export function connectChoiceTransitions(context: CanvasLayoutContext, records: DialogueRecord[]): void {
	const orderedRecordsByTopic = new Map<string, DialogueRecord[]>();
	for (const [topic, topicRecords] of groupRecordsByTopic(records)) {
		orderedRecordsByTopic.set(topic, orderTopicRecordsByInfoSequence(topicRecords));
	}

	const connected = new Set<string>();
	for (const anchor of context.choiceTransitionAnchors) {
		const sourceRecords = anchor.sourceRecords.filter((record) => !record.suppressChoiceTransitions);
		if (sourceRecords.length === 0) {
			continue;
		}

		const targetRecords = resolveChoiceTransitionTargets(
			{
				...anchor,
				sourceRecords,
			},
			orderedRecordsByTopic,
		);
		if (targetRecords.length === 0) {
			continue;
		}

		for (const targetRecord of targetRecords) {
			const entryNodeId = context.recordEntryNodeIds.get(targetRecord.id);
			if (!entryNodeId) {
				continue;
			}

			const connectionKey = `${anchor.nodeId}:${entryNodeId}:${anchor.choiceValue}`;
			if (connected.has(connectionKey)) {
				continue;
			}

			addEdge(context, connectionKey, anchor.nodeId, 'right', entryNodeId, 'left');
			connected.add(connectionKey);
		}
	}
}

export function routeJournalRangeChoiceTransitions(context: CanvasLayoutContext, records: DialogueRecord[]): void {
	const recordByEntryNodeId = new Map<string, DialogueRecord>();
	for (const record of records) {
		const entryNodeId = context.recordEntryNodeIds.get(record.id);
		if (entryNodeId) {
			recordByEntryNodeId.set(entryNodeId, record);
		}
	}

	const sourcePhaseByChoiceNodeId = new Map<string, number>();
	for (const anchor of context.choiceTransitionAnchors) {
		const sourcePhases = anchor.sourceRecords.map((record) => record.sourcePhaseAnchor);
		if (sourcePhases.length === 0) {
			continue;
		}
		sourcePhaseByChoiceNodeId.set(anchor.nodeId, Math.min(...sourcePhases));
	}

	const incomingChoiceEdgesByTarget = new Map<string, Array<{ edge: CanvasEdge; sourcePhase: number }>>();
	for (const edge of context.edges) {
		if (edge.fromSide !== 'right' || edge.toSide !== 'left') {
			continue;
		}

		const sourceNode = findCanvasNode(context, edge.fromNode);
		if (!sourceNode || !isChoiceNode(sourceNode)) {
			continue;
		}

		const targetRecord = recordByEntryNodeId.get(edge.toNode);
		if (!targetRecord || !hasJournalRangeCondition(targetRecord)) {
			continue;
		}

		const sourcePhase = sourcePhaseByChoiceNodeId.get(edge.fromNode);
		if (sourcePhase === undefined) {
			continue;
		}

		const targetEdges = incomingChoiceEdgesByTarget.get(edge.toNode) ?? [];
		targetEdges.push({ edge, sourcePhase });
		incomingChoiceEdgesByTarget.set(edge.toNode, targetEdges);
	}

	let jumpIndex = 1;
	for (const [targetNodeId, incomingEdges] of incomingChoiceEdgesByTarget) {
		if (incomingEdges.length <= 1) {
			continue;
		}

		const lowestPhase = Math.min(...incomingEdges.map((item) => item.sourcePhase));
		for (const item of incomingEdges.sort((left, right) => left.sourcePhase - right.sourcePhase || left.edge.id.localeCompare(right.edge.id))) {
			if (item.sourcePhase === lowestPhase) {
				continue;
			}

			const sourceNode = findCanvasNode(context, item.edge.fromNode);
			const targetNode = findCanvasNode(context, targetNodeId);
			if (!sourceNode || !targetNode) {
				continue;
			}

			const jumpText = `Jump #${jumpIndex}`;
			const jumpNodeId = addTextNode(
				context,
				`jump:${item.edge.fromNode}:${targetNodeId}:${jumpIndex}`,
				jumpText,
				Math.round((sourceNode.x + sourceNode.width + targetNode.x - JUMP_WIDTH) / 2),
				Math.round(edgeEndpoint(sourceNode, 'right').y - measureTextHeight(jumpText, JUMP_WIDTH) / 2),
				JUMP_WIDTH,
				JUMP_COLOR,
				{ role: 'jump' },
			);
			jumpIndex += 1;

			item.edge.toNode = jumpNodeId;
			item.edge.toSide = 'left';
			addEdge(context, `${jumpNodeId}:${targetNodeId}`, jumpNodeId, 'right', targetNodeId, 'left');
		}
	}
}

export function connectAddTopicTransitions(context: CanvasLayoutContext, records: DialogueRecord[], questIds: string[]): void {
	const orderedRecordsByTopic = groupRecordsByNormalizedTopic(records);
	const transitions: AddTopicTransition[] = [];

	for (const sourceRecord of records) {
		for (const action of sourceRecord.resultActions) {
			if (action.kind !== 'add-topic' || !action.targetTopic) {
				continue;
			}

			const targetRecords = resolveAddTopicTransitionTargets(sourceRecord, action.targetTopic, orderedRecordsByTopic, questIds, context);
			if (targetRecords.length === 0) {
				continue;
			}

			const sourceNodeId = createNodeId(`dialogue:${sourceRecord.file.path}`);
			for (const targetRecord of targetRecords) {
				const targetNodeId = context.recordEntryNodeIds.get(targetRecord.id);
				if (!targetNodeId) {
					continue;
				}
				if (nodeCanReach(context, sourceNodeId, targetNodeId)) {
					continue;
				}

				transitions.push({
					sourceRecord,
					sourceNodeId,
					targetNodeId,
				});
			}
		}
	}

	for (const transition of transitions) {
		addEdge(
			context,
			`${transition.sourceNodeId}:${transition.targetNodeId}:add-topic`,
			transition.sourceNodeId,
			'right',
			transition.targetNodeId,
			'left',
			'AddTopic',
		);
	}
}

export function connectBodyTopicLinkTransitions(context: CanvasLayoutContext, records: DialogueRecord[]): void {
	const orderedRecordsByTopic = groupRecordsByNormalizedTopic(records);

	for (const sourceRecord of records) {
		if (!recordCanIntroduceBodyTopic(sourceRecord)) {
			continue;
		}

		const linkedTopics = extractBodyTopicLinks(sourceRecord.bodyText).filter(
			(topic) => normalizeTopicKey(topic) !== normalizeTopicKey(sourceRecord.topic),
		);
		if (linkedTopics.length === 0) {
			continue;
		}

		const sourceNodeId = createNodeId(`dialogue:${sourceRecord.file.path}`);
		for (const targetTopic of linkedTopics) {
			const targetRecords = resolveAddTopicTransitionTargets(sourceRecord, targetTopic, orderedRecordsByTopic);
			for (const targetRecord of targetRecords) {
				if (targetRecord.id === sourceRecord.id) {
					continue;
				}

				const targetNodeId = context.recordEntryNodeIds.get(targetRecord.id);
				if (!targetNodeId || nodeCanReach(context, sourceNodeId, targetNodeId)) {
					continue;
				}

				addEdge(
					context,
					`${sourceNodeId}:${targetNodeId}:body-topic:${normalizeTopicKey(targetTopic)}`,
					sourceNodeId,
					'right',
					targetNodeId,
					'left',
				);
			}
		}
	}
}

export function connectAdjacentJournalPhaseTerminalTransitions(
	context: CanvasLayoutContext,
	records: DialogueRecord[],
	phaseIndices: number[],
	questIds: string[],
): void {
	const recordByEntryNodeId = new Map<string, DialogueRecord>();
	for (const record of records) {
		const entryNodeId = context.recordEntryNodeIds.get(record.id);
		if (entryNodeId) {
			recordByEntryNodeId.set(entryNodeId, record);
		}
	}

	const orderedPhases = uniqueNumbers(phaseIndices.filter((phaseValue) => phaseValue > 0));
	for (let index = 1; index < orderedPhases.length; index += 1) {
		const sourcePhase = orderedPhases[index - 1];
		const targetPhase = orderedPhases[index];
		if (sourcePhase === undefined || targetPhase === undefined) {
			continue;
		}
		if (phaseHasExplicitJournalProgression(records, sourcePhase, targetPhase, questIds)) {
			continue;
		}

		const sourceRecords = records.filter(
			(record) => recordHasExactJournalCondition(record, sourcePhase, questIds)
				&& isTerminalCanvasRecord(context, record),
		);
		const targetRecords = records.filter(
			(record) => recordHasExactJournalCondition(record, targetPhase, questIds)
				&& !record.conditions.some((condition) => condition.kind === 'choice'),
		);

		for (const sourceRecord of sourceRecords) {
			const sourceNodeId = createNodeId(`dialogue:${sourceRecord.file.path}`);
			for (const targetRecord of targetRecords) {
				if (!recordsShareExactJournalQuest(sourceRecord, sourcePhase, targetRecord, targetPhase, questIds)) {
					continue;
				}
				if (!conditionsCanFollowJournalPhase(sourceRecord, targetRecord, targetPhase)) {
					continue;
				}

				const targetNodeId = context.recordEntryNodeIds.get(targetRecord.id);
				const entryNodeId: string | undefined = targetNodeId
					? rootEntryNodeForExistingBranch(
						context,
						targetNodeId,
						recordByEntryNodeId,
						targetPhase,
						questIds,
					)
					: undefined;
				const entryPhaseValue: number | null = entryNodeId ? phaseNodeIdValue(context, entryNodeId) : null;
				if (
					!entryNodeId
					|| (entryPhaseValue !== null && entryPhaseValue !== targetPhase)
					|| nodeCanReach(context, sourceNodeId, entryNodeId)
				) {
					continue;
				}

				addEdge(
					context,
					`${sourceNodeId}:${entryNodeId}:journal-phase:${sourcePhase}:${targetPhase}`,
					sourceNodeId,
					'right',
					entryNodeId,
					'left',
				);
			}
		}
	}
}

export function phaseNodeIdValue(context: CanvasLayoutContext, nodeId: string): number | null {
	for (const [phaseValue, phaseNodeId] of context.phaseNodeIds) {
		if (phaseNodeId === nodeId) {
			return phaseValue;
		}
	}
	return null;
}

export function rootEntryNodeForExistingBranch(
	context: CanvasLayoutContext,
	targetNodeId: string,
	recordByEntryNodeId: Map<string, DialogueRecord>,
	targetPhase: number,
	questIds: string[],
): string {
	const incomingByNode = new Map<string, CanvasEdge[]>();
	for (const edge of context.edges) {
		if (edge.fromSide === 'bottom' && edge.toSide === 'top') {
			continue;
		}

		const incomingEdges = incomingByNode.get(edge.toNode) ?? [];
		incomingEdges.push(edge);
		incomingByNode.set(edge.toNode, incomingEdges);
	}

	const ancestors = new Set<string>();
	const queue = [targetNodeId];
	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (!nodeId || ancestors.has(nodeId)) {
			continue;
		}

		ancestors.add(nodeId);
		for (const edge of incomingByNode.get(nodeId) ?? []) {
			if (!ancestors.has(edge.fromNode)) {
				queue.push(edge.fromNode);
			}
		}
	}

	const roots = [...ancestors].filter((nodeId) => (incomingByNode.get(nodeId) ?? []).length === 0);
	if (roots.length === 0) {
		return targetNodeId;
	}

	const validAncestors = [...ancestors].filter((nodeId) => {
		const record = recordByEntryNodeId.get(nodeId);
		return record !== undefined && recordCanRunAtPhase(record, targetPhase, questIds);
	});
	const validAncestorSet = new Set(validAncestors);
	const validRootAncestors = validAncestors.filter((nodeId) =>
		(incomingByNode.get(nodeId) ?? []).every((edge) => !validAncestorSet.has(edge.fromNode)),
	);

	return (validRootAncestors.length > 0 ? validRootAncestors : validAncestors)
		.sort((left, right) => compareCanvasNodePosition(context, left, right))[0]
		?? targetNodeId;
}

export function compareCanvasNodePosition(context: CanvasLayoutContext, leftNodeId: string, rightNodeId: string): number {
	const leftNode = findCanvasNode(context, leftNodeId);
	const rightNode = findCanvasNode(context, rightNodeId);
	if (!leftNode || !rightNode) {
		return leftNodeId.localeCompare(rightNodeId);
	}

	return leftNode.x - rightNode.x
		|| leftNode.y - rightNode.y
		|| leftNodeId.localeCompare(rightNodeId);
}

export function isTerminalCanvasRecord(context: CanvasLayoutContext, record: DialogueRecord): boolean {
	if (record.resultActions.some((action) => action.kind === 'journal-set' || action.kind === 'choice-set' || action.kind === 'add-topic')) {
		return false;
	}

	const sourceNodeId = createNodeId(`dialogue:${record.file.path}`);
	return !context.edges.some(
		(edge) => edge.fromNode === sourceNodeId
			&& !(edge.fromSide === 'bottom' && edge.toSide === 'top'),
	);
}

export function connectScriptedMilestones(context: CanvasLayoutContext, phaseIndices: number[]): void {
	for (let index = 1; index < phaseIndices.length; index += 1) {
		const previousPhase = phaseIndices[index - 1];
		const currentPhase = phaseIndices[index];
		if (previousPhase === undefined || currentPhase === undefined) {
			continue;
		}

		const incoming = context.phaseIncomingCounts.get(currentPhase) ?? 0;
		const outgoing = context.phaseOutgoingCounts.get(previousPhase) ?? 0;
		if (incoming > 0 || outgoing > 0) {
			continue;
		}

		const fromNode = context.phaseNodeIds.get(previousPhase);
		const toNode = context.phaseNodeIds.get(currentPhase);
		if (!fromNode || !toNode) {
			continue;
		}

		addEdge(context, `${fromNode}:${toNode}:scripted`, fromNode, 'right', toNode, 'left');
	}
}

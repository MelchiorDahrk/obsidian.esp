import { containsJournalLine, renderConditionBlock, renderResultAction, resolveJournalResultMilestone } from './cards';
import {
	addEdge,
	addFileNode,
	addTextNode,
	edgeEndpoint,
	isAddTopicResultNode,
	isChoiceNode,
	isDialogueFileNode,
	isGateNode,
} from './emit';
import {
	choiceActionIdentity,
	choiceGroupKey,
	compareBranchFamilies,
	compareDialogueRecords,
	groupFamiliesByPrimaryChoice,
	mapChoiceGroupsByChoice,
	orderChoiceGroupsForLanes,
	resolveRootChoiceGroups,
} from './families';
import {
	type AnchoredTopicLayout,
	type BranchFamily,
	type CanvasLayoutContext,
	type CanvasNode,
	CHOICE_GAP_X,
	CHOICE_STACK_GAP_Y,
	CHOICE_WIDTH,
	type ChoiceAnchor,
	type ChoiceAnchorGroup,
	type ChoiceGroup,
	CLUSTER_GAP_Y,
	DENSE_VARIANT_GAP_Y,
	DIALOGUE_COLOR,
	DIALOGUE_GAP_X,
	DIALOGUE_WIDTH,
	FILE_NODE_MIN_HEIGHT,
	FOLLOWUP_GROUP_GAP_X,
	GATE_COLOR,
	GATE_GAP_X,
	GATE_WIDTH,
	INTRODUCER_ORIGIN_X,
	JOURNAL_COLOR,
	JOURNAL_WIDTH,
	type JournalMilestone,
	LANE_GAP_Y,
	LAYER_GAP_X,
	LAYER_UNIT_GAP_Y,
	MIN_HORIZONTAL_EDGE_GAP_X,
	PHASE_GAP_X,
	type PhaseTopicSegment,
	RESULT_COLOR,
	RESULT_GAP_Y,
	type ResultAction,
	SPACER_UNIT_GAP_Y,
	SPACER_UNIT_SIZE,
	TOPIC_SEGMENT_GAP_X,
	type TopicLayoutResult,
} from './model';
import { incrementPhaseCount, measureCanvasBodyHeight, measureTextHeight, uniqueValues } from './utils';

export function layoutBranchFamily(
	context: CanvasLayoutContext,
	family: BranchFamily,
	phaseValue: number,
	gateX: number,
	dialogueX: number,
	choiceX: number,
	startY: number,
	allMilestones: JournalMilestone[],
	clusterGapY = CLUSTER_GAP_Y,
): { firstEntryId: string; nextY: number; choiceAnchors: ChoiceAnchor[] } {
	const familyRecords = [...family.records].sort(compareDialogueRecords);
	const familyChoiceActions = family.results.filter((action) => action.kind === 'choice-set');
	const choiceAnchors: ChoiceAnchor[] = [];
	let currentY = startY;
	let firstEntryId = '';

	for (let recordIndex = 0; recordIndex < familyRecords.length; recordIndex += 1) {
		const record = familyRecords[recordIndex];
		if (!record) {
			continue;
		}

		const gateText = renderConditionBlock(record.conditions);
		const gateHeight = gateText.length > 0 ? measureTextHeight(gateText, GATE_WIDTH) : 0;
		const dialogueHeight = measureCanvasBodyHeight(record.bodyText, DIALOGUE_WIDTH);
		const localResultLines = record.resultActions
			.filter((action) => action.kind !== 'choice-set')
			.map((action) => renderResultAction(action, allMilestones));
		const localResultHeight = localResultLines.length > 0 ? measureTextHeight(localResultLines.join('\n'), DIALOGUE_WIDTH) + RESULT_GAP_Y : 0;
		const choiceActions = familyChoiceActions.filter((action) => action.choiceValue !== undefined);
		const choiceHeights = choiceActions.map((action) => measureTextHeight(choicePromptText(action), CHOICE_WIDTH));
		const choiceStackHeight = choiceHeights.reduce((total, height, index) => {
			const spacing = index === 0 ? 0 : 24;
			return total + spacing + height;
		}, 0);
		const clusterHeight = Math.max(gateHeight, dialogueHeight, choiceStackHeight) + localResultHeight + clusterGapY;
		const recordY = currentY;
		const dialogueId = addFileNode(
			context,
			`dialogue:${record.file.path}`,
			record.file.path,
			dialogueX,
			recordY,
			DIALOGUE_WIDTH,
			dialogueHeight,
			DIALOGUE_COLOR,
			{ role: 'dialogue', file: record.file.path },
		);
		const gateY = Math.round(recordY + Math.max(0, (dialogueHeight - gateHeight) / 2));
		const gateId = gateText.length > 0
			? addTextNode(
				context,
				`gate:${record.file.path}`,
				gateText,
				gateX,
				gateY,
				GATE_WIDTH,
				GATE_COLOR,
				{ role: 'gate', file: record.file.path },
			)
			: dialogueId;
		context.relatedFiles.set(record.file.path, record.file);
		if (firstEntryId.length === 0) {
			firstEntryId = gateId;
		}
		context.recordEntryNodeIds.set(record.id, gateId);

		if (gateId !== dialogueId) {
			addEdge(context, `${gateId}:${dialogueId}`, gateId, 'right', dialogueId, 'left');
		}

		if (localResultLines.length > 0) {
			const resultText = localResultLines.join('\n');
			const resultId = addTextNode(
				context,
				`result:${record.file.path}`,
				resultText,
				dialogueX,
				recordY + dialogueHeight + RESULT_GAP_Y,
				DIALOGUE_WIDTH,
				containsJournalLine(localResultLines) ? JOURNAL_COLOR : RESULT_COLOR,
				{ role: 'result', file: record.file.path },
			);
			addEdge(context, `${dialogueId}:${resultId}`, dialogueId, 'bottom', resultId, 'top');
		}

		for (const action of record.resultActions) {
			if (action.kind !== 'journal-set' || action.targetJournalIndex === undefined) {
				continue;
			}

			const targetMilestone = resolveJournalResultMilestone(action, allMilestones);
			if (!targetMilestone) {
				continue;
			}

			const targetPhaseId = context.phaseNodeIds.get(targetMilestone.index);
			if (!targetPhaseId) {
				continue;
			}

			addEdge(context, `${dialogueId}:${targetPhaseId}:${action.targetJournalIndex}`, dialogueId, 'right', targetPhaseId, 'left');
			incrementPhaseCount(context.phaseOutgoingCounts, phaseValue);
			incrementPhaseCount(context.phaseIncomingCounts, targetMilestone.index);
		}

		let choiceCursorY = recordY + Math.max(0, Math.round((dialogueHeight - choiceStackHeight) / 2));
		const recordChoiceNodeIds = new Map<string, string>();
		for (let choiceIndex = 0; choiceIndex < choiceActions.length; choiceIndex += 1) {
			const choiceAction = choiceActions[choiceIndex];
			const choiceHeight = choiceHeights[choiceIndex] ?? measureTextHeight(choiceAction?.displayText ?? '', CHOICE_WIDTH);
			if (!choiceAction || choiceAction.choiceValue === undefined) {
				continue;
			}
			const choiceNodeKey = choiceActionIdentity(choiceAction);
			let choiceNodeId = recordChoiceNodeIds.get(choiceNodeKey);
			if (!choiceNodeId) {
				choiceNodeId = addTextNode(
					context,
					`choice:${record.file.path}:${choiceAction.choiceValue}:${choiceAction.displayText}`,
					choicePromptText(choiceAction),
					choiceX,
					choiceCursorY,
					CHOICE_WIDTH,
					GATE_COLOR,
					{ role: 'choice', file: record.file.path, choiceValue: choiceAction.choiceValue },
				);
				recordChoiceNodeIds.set(choiceNodeKey, choiceNodeId);
				choiceAnchors.push({
					choiceValue: choiceAction.choiceValue,
					nodeId: choiceNodeId,
					x: choiceX,
					y: Math.round(choiceCursorY + choiceHeight / 2),
				});
				context.choiceTransitionAnchors.push({
					topic: family.topic,
					choiceValue: choiceAction.choiceValue,
					nodeId: choiceNodeId,
					sourceRecords: [record],
				});
				choiceCursorY += choiceHeight + 24;
			}

			addEdge(context, `${dialogueId}:${choiceNodeId}`, dialogueId, 'right', choiceNodeId, 'left');
		}

		currentY += clusterHeight;
	}

	return {
		firstEntryId,
		nextY: currentY,
		choiceAnchors,
	};
}

/**
 * Choice cards show only the prompt string; the choice value lives in
 * espCard.choiceValue (§2 of the editing plan).
 */
function choicePromptText(action: ResultAction): string {
	return action.choiceText ?? action.displayText;
}

export function layoutTopicFamilies(
	context: CanvasLayoutContext,
	families: BranchFamily[],
	phaseValue: number,
	topicBaseX: number,
	allMilestones: JournalMilestone[],
): TopicLayoutResult {
	const choiceGroups = groupFamiliesByPrimaryChoice(families);
	if (choiceGroups.length === 0) {
		return { rootEntryIds: [], topY: 0, bottomY: 0, mainLaneCenterY: 0, nodeIds: [] };
	}

	const groupsByChoice = mapChoiceGroupsByChoice(choiceGroups);
	let rootGroups = resolveRootChoiceGroups(choiceGroups);
	if (rootGroups.length === 0) {
		rootGroups = [...choiceGroups];
	}
	rootGroups = orderChoiceGroupsForLanes(rootGroups, phaseValue);

	const renderedGroupLayouts = new Map<string, TopicLayoutResult>();
	const renderingGroups = new Set<string>();
	const rootEntryIds: string[] = [];
	let topicTopY = Number.POSITIVE_INFINITY;
	let topicBottomY = Number.NEGATIVE_INFINITY;

	const renderChoiceGroup = (group: ChoiceGroup, gateX: number, startY: number): TopicLayoutResult => {
		const groupKey = choiceGroupKey(group.choiceValue);
		const cachedLayout = renderedGroupLayouts.get(groupKey);
		if (cachedLayout) {
			return cachedLayout;
		}
		if (renderingGroups.has(groupKey)) {
			return { rootEntryIds: [], topY: startY, bottomY: startY, mainLaneCenterY: startY, nodeIds: [] };
		}
		renderingGroups.add(groupKey);
		const renderedNodeCount = context.nodes.length;

		const dialogueX = gateX + (DIALOGUE_GAP_X - GATE_GAP_X);
		const choiceX = dialogueX + (CHOICE_GAP_X - DIALOGUE_GAP_X);
		let currentY = startY;
		let groupTopY = startY;
		let groupBottomY = startY;
		let localTopY = startY;
		let localBottomY = startY;
		const localEntryIds: string[] = [];
		const emittedAnchors: ChoiceAnchor[] = [];
		const childLayouts: TopicLayoutResult[] = [];
		const clusterGapY = choiceGroupUsesDenseVariantLayout(group) ? DENSE_VARIANT_GAP_Y : CLUSTER_GAP_Y;

		for (const family of [...group.families].sort(compareBranchFamilies)) {
			const familyLayout = layoutBranchFamily(
				context,
				family,
				phaseValue,
				gateX,
				dialogueX,
				choiceX,
				currentY,
				allMilestones,
				clusterGapY,
			);
			localEntryIds.push(familyLayout.firstEntryId);
			emittedAnchors.push(...familyLayout.choiceAnchors);
			groupBottomY = Math.max(groupBottomY, familyLayout.nextY);
			localBottomY = Math.max(localBottomY, familyLayout.nextY);
			currentY = familyLayout.nextY;
		}

		const mainLaneBottomY = Math.max(groupTopY, groupBottomY - CLUSTER_GAP_Y);
		const mainLaneCenterY = Math.round((groupTopY + mainLaneBottomY) / 2);
		const mainColumnTopY = localTopY;
		const mainColumnBottomY = localBottomY;
		const anchoredChildLayouts: AnchoredTopicLayout[] = [];
		for (const anchor of collapseChoiceAnchors(emittedAnchors).sort((left, right) => left.y - right.y || left.choiceValue - right.choiceValue)) {
			const childGroup = groupsByChoice.get(choiceGroupKey(anchor.choiceValue));
			if (!childGroup) {
				continue;
			}

			const childGroupKey = choiceGroupKey(childGroup.choiceValue);
			const cachedChildLayout = renderedGroupLayouts.get(childGroupKey);
			if (cachedChildLayout) {
				childLayouts.push(cachedChildLayout);
				anchoredChildLayouts.push({
					choiceValue: anchor.choiceValue,
					anchorY: anchor.y,
					layout: cachedChildLayout,
				});
				continue;
			}
			if (renderingGroups.has(childGroupKey)) {
				continue;
			}

			const childHeight = estimateChoiceGroupHeight(childGroup);
			const childStartY = Math.round(anchor.y - childHeight / 2);
			const childLayout = renderChoiceGroup(
				childGroup,
				anchor.x + FOLLOWUP_GROUP_GAP_X,
				childStartY,
			);
			childLayouts.push(childLayout);
			anchoredChildLayouts.push({
				choiceValue: anchor.choiceValue,
				anchorY: anchor.y,
				layout: childLayout,
			});
		}

		arrangeAnchoredChildLayouts(context, anchoredChildLayouts, CLUSTER_GAP_Y);
		localTopY = mainColumnTopY;
		localBottomY = mainColumnBottomY;
		for (const childLayout of childLayouts) {
			localTopY = Math.min(localTopY, childLayout.topY);
			localBottomY = Math.max(localBottomY, childLayout.bottomY);
		}

		topicTopY = Math.min(topicTopY, localTopY);
		topicBottomY = Math.max(topicBottomY, localBottomY);

		const layout = {
			rootEntryIds: localEntryIds,
			topY: localTopY,
			bottomY: localBottomY,
			mainLaneCenterY,
			nodeIds: context.nodes.slice(renderedNodeCount).map((node) => node.id),
		};
		renderedGroupLayouts.set(groupKey, layout);
		renderingGroups.delete(groupKey);
		return layout;
	};

	const rootStartYs = buildCenteredGroupStartYs(rootGroups);
	const rootLayouts: TopicLayoutResult[] = [];
	for (let rootIndex = 0; rootIndex < rootGroups.length; rootIndex += 1) {
		const rootGroup = rootGroups[rootIndex];
		if (!rootGroup) {
			continue;
		}
		const rootLayout = renderChoiceGroup(rootGroup, topicBaseX, rootStartYs[rootIndex] ?? 0);
		rootEntryIds.push(...rootLayout.rootEntryIds);
		rootLayouts.push(rootLayout);
	}
	pushDownOverlappingLayouts(context, rootLayouts, LANE_GAP_Y);
	topicTopY = Number.POSITIVE_INFINITY;
	topicBottomY = Number.NEGATIVE_INFINITY;
	for (const rootLayout of rootLayouts) {
		topicTopY = Math.min(topicTopY, rootLayout.topY);
		topicBottomY = Math.max(topicBottomY, rootLayout.bottomY);
	}
	const layoutNodeIds = uniqueValues(rootLayouts.flatMap((layout) => layout.nodeIds));

	let nextFallbackY = Number.isFinite(topicBottomY) ? topicBottomY + LANE_GAP_Y : 0;
	for (const group of orderChoiceGroupsForLanes(choiceGroups, phaseValue)) {
		if (renderedGroupLayouts.has(choiceGroupKey(group.choiceValue))) {
			continue;
		}

		const fallbackLayout = renderChoiceGroup(group, topicBaseX, nextFallbackY);
		rootEntryIds.push(...fallbackLayout.rootEntryIds);
		rootLayouts.push(fallbackLayout);
		layoutNodeIds.push(...fallbackLayout.nodeIds.filter((nodeId) => !layoutNodeIds.includes(nodeId)));
		nextFallbackY = fallbackLayout.bottomY + LANE_GAP_Y;
	}

	const mainLaneCenterY = rootLayouts[0]?.mainLaneCenterY ?? 0;
	return {
		rootEntryIds: uniqueValues(rootEntryIds),
		topY: Number.isFinite(topicTopY) ? topicTopY : 0,
		bottomY: Number.isFinite(topicBottomY) ? topicBottomY : 0,
		mainLaneCenterY,
		nodeIds: layoutNodeIds,
	};
}

export function pushDownOverlappingLayouts(
	context: CanvasLayoutContext,
	layouts: TopicLayoutResult[],
	gapY: number,
): void {
	const sortedLayouts = [...layouts]
		.filter((layout) => layout.nodeIds.length > 0)
		.sort((left, right) => left.topY - right.topY || left.bottomY - right.bottomY);

	let previousBottomY: number | null = null;
	for (const layout of sortedLayouts) {
		if (previousBottomY !== null) {
			const minimumTopY = previousBottomY + gapY;
			if (layout.topY < minimumTopY) {
				shiftTopicLayout(context, layout, minimumTopY - layout.topY);
			}
		}

		previousBottomY = layout.bottomY;
	}
}

export function arrangeAnchoredChildLayouts(
	context: CanvasLayoutContext,
	anchoredLayouts: AnchoredTopicLayout[],
	gapY: number,
): void {
	const orderedLayouts = [...anchoredLayouts]
		.filter((item) => item.layout.nodeIds.length > 0)
		.sort((left, right) => left.anchorY - right.anchorY || left.choiceValue - right.choiceValue);
	if (orderedLayouts.length === 0) {
		return;
	}

	const heights = orderedLayouts.map((item) => item.layout.bottomY - item.layout.topY);
	const cumulativeMinimumTops: number[] = [];
	let cumulativeTop = 0;
	for (let index = 0; index < orderedLayouts.length; index += 1) {
		cumulativeMinimumTops.push(cumulativeTop);
		cumulativeTop += (heights[index] ?? 0) + gapY;
	}

	const desiredOffsets = orderedLayouts.map((item, index) => {
		const minimumTop = cumulativeMinimumTops[index] ?? 0;
		const mainLaneOffset = item.layout.mainLaneCenterY - item.layout.topY;
		return item.anchorY - mainLaneOffset - minimumTop;
	});
	const compactOffsets = compactIncreasingOffsets(desiredOffsets);

	for (let index = 0; index < orderedLayouts.length; index += 1) {
		const item = orderedLayouts[index];
		if (!item) {
			continue;
		}

		const nextTop = Math.round((compactOffsets[index] ?? 0) + (cumulativeMinimumTops[index] ?? 0));
		shiftTopicLayout(context, item.layout, nextTop - item.layout.topY);
	}
}

export function compactIncreasingOffsets(desiredOffsets: number[]): number[] {
	const blocks: Array<{ start: number; end: number; weight: number; total: number }> = [];
	for (let index = 0; index < desiredOffsets.length; index += 1) {
		blocks.push({
			start: index,
			end: index,
			weight: 1,
			total: desiredOffsets[index] ?? 0,
		});

		while (blocks.length >= 2) {
			const right = blocks[blocks.length - 1];
			const left = blocks[blocks.length - 2];
			if (!left || !right || left.total / left.weight <= right.total / right.weight) {
				break;
			}

			blocks.splice(blocks.length - 2, 2, {
				start: left.start,
				end: right.end,
				weight: left.weight + right.weight,
				total: left.total + right.total,
			});
		}
	}

	const offsets = new Array<number>(desiredOffsets.length);
	for (const block of blocks) {
		const value = block.total / block.weight;
		for (let index = block.start; index <= block.end; index += 1) {
			offsets[index] = value;
		}
	}
	return offsets;
}

export function shiftTopicLayout(
	context: CanvasLayoutContext,
	layout: TopicLayoutResult,
	deltaY: number,
): void {
	if (deltaY === 0) {
		return;
	}

	const nodeIds = new Set(layout.nodeIds);
	for (const node of context.nodes) {
		if (nodeIds.has(node.id)) {
			node.y += deltaY;
		}
	}

	layout.topY += deltaY;
	layout.bottomY += deltaY;
	layout.mainLaneCenterY += deltaY;
}

export function buildCenteredGroupStartYs(groups: ChoiceGroup[]): number[] {
	if (groups.length === 0) {
		return [];
	}

	const heights = groups.map((group) => estimateChoiceGroupHeight(group));
	const totalHeight = heights.reduce((sum, height, index) => {
		const spacing = index === 0 ? 0 : LANE_GAP_Y;
		return sum + spacing + height;
	}, 0);
	const startYs = new Array<number>(groups.length);
	let cursorY = -Math.round(totalHeight / 2);

	for (let index = 0; index < groups.length; index += 1) {
		startYs[index] = cursorY;
		cursorY += (heights[index] ?? 0) + LANE_GAP_Y;
	}

	return startYs;
}

export function choiceGroupUsesDenseVariantLayout(group: ChoiceGroup): boolean {
	return group.choiceValue === null
		&& group.families.length >= 4
		&& group.families.every((family) => !family.results.some((action) => action.kind === 'choice-set'));
}

export function computePhasePositions(
	phaseIndices: number[],
	segmentsByPhase: Map<number, PhaseTopicSegment[]>,
): Map<number, number> {
	const positions = new Map<number, number>();
	let currentX = 0;

	for (let index = 0; index < phaseIndices.length; index += 1) {
		const phaseValue = phaseIndices[index];
		if (phaseValue === undefined) {
			continue;
		}

		positions.set(phaseValue, currentX);
		const phaseWidth = estimatePhaseWidth(segmentsByPhase.get(phaseValue) ?? []);
		currentX += Math.max(PHASE_GAP_X, phaseWidth + 420);
	}

	return positions;
}

export function estimatePhaseWidth(segments: PhaseTopicSegment[]): number {
	if (segments.length === 0) {
		return JOURNAL_WIDTH;
	}

	let furthestRight = JOURNAL_WIDTH;
	for (let topicIndex = 0; topicIndex < segments.length; topicIndex += 1) {
		const segment = segments[topicIndex];
		if (!segment) {
			continue;
		}
		const depth = estimateTopicDepth(segment.families);
		const topicBaseX = GATE_GAP_X + topicIndex * TOPIC_SEGMENT_GAP_X;
		const lastGateX = topicBaseX + (depth - 1) * sourceGroupStepX();
		const lastChoiceX = lastGateX + (CHOICE_GAP_X - GATE_GAP_X);
		furthestRight = Math.max(furthestRight, lastChoiceX + CHOICE_WIDTH);
	}

	return furthestRight;
}

export function estimateChoiceGroupHeight(group: ChoiceGroup): number {
	if (group.families.length === 0) {
		return FILE_NODE_MIN_HEIGHT + CLUSTER_GAP_Y;
	}

	const clusterGapY = choiceGroupUsesDenseVariantLayout(group) ? DENSE_VARIANT_GAP_Y : CLUSTER_GAP_Y;
	return group.families.reduce((total, family) => total + estimateFamilyHeight(family, clusterGapY), 0);
}

export function estimateFamilyHeight(family: BranchFamily, clusterGapY = CLUSTER_GAP_Y): number {
	let total = 0;
	for (const record of family.records) {
		const gateHeight = measureTextHeight(renderConditionBlock(record.conditions), GATE_WIDTH);
		const dialogueHeight = measureCanvasBodyHeight(record.bodyText, DIALOGUE_WIDTH);
		const localResultLines = record.resultActions
			.filter((action) => action.kind !== 'choice-set')
			.map((action) => action.displayText);
		const resultHeight = localResultLines.length > 0 ? measureTextHeight(localResultLines.join('\n'), DIALOGUE_WIDTH) + RESULT_GAP_Y : 0;
		total += Math.max(gateHeight, dialogueHeight) + resultHeight + clusterGapY;
	}
	return Math.max(total, FILE_NODE_MIN_HEIGHT + clusterGapY);
}

export function estimateTopicDepth(families: BranchFamily[]): number {
	const choiceGroups = groupFamiliesByPrimaryChoice(families);
	if (choiceGroups.length === 0) {
		return 1;
	}

	const groupsByChoice = mapChoiceGroupsByChoice(choiceGroups);
	let roots = resolveRootChoiceGroups(choiceGroups);
	if (roots.length === 0) {
		roots = [...choiceGroups];
	}

	const visiting = new Set<string>();
	const memo = new Map<string, number>();
	const depthForGroup = (group: ChoiceGroup): number => {
		const key = choiceGroupKey(group.choiceValue);
		const cached = memo.get(key);
		if (cached !== undefined) {
			return cached;
		}
		if (visiting.has(key)) {
			return 1;
		}

		visiting.add(key);
		let maxChildDepth = 0;
		for (const family of group.families) {
			for (const action of family.results) {
				if (action.kind !== 'choice-set' || action.choiceValue === undefined) {
					continue;
				}

				const childGroup = groupsByChoice.get(choiceGroupKey(action.choiceValue));
				if (!childGroup) {
					continue;
				}
				maxChildDepth = Math.max(maxChildDepth, depthForGroup(childGroup));
			}
		}
		visiting.delete(key);

		const depth = 1 + maxChildDepth;
		memo.set(key, depth);
		return depth;
	};

	return Math.max(...roots.map((group) => depthForGroup(group)), 1);
}

export function collapseChoiceAnchors(anchors: ChoiceAnchor[]): ChoiceAnchorGroup[] {
	const grouped = new Map<number, ChoiceAnchor[]>();
	for (const anchor of anchors) {
		const existing = grouped.get(anchor.choiceValue) ?? [];
		existing.push(anchor);
		grouped.set(anchor.choiceValue, existing);
	}

	return [...grouped.entries()]
		.sort((left, right) => left[0] - right[0])
		.map(([, valueAnchors]) => {
			const y = Math.round(
				valueAnchors.reduce((sum, anchor) => sum + anchor.y, 0) / valueAnchors.length,
			);
			const x = Math.max(...valueAnchors.map((anchor) => anchor.x));
			return {
				choiceValue: valueAnchors[0]?.choiceValue ?? 0,
				nodeIds: uniqueValues(valueAnchors.map((anchor) => anchor.nodeId)),
				x,
				y,
			};
		});
}

export function sourceGroupStepX(): number {
	return (CHOICE_GAP_X - GATE_GAP_X) + FOLLOWUP_GROUP_GAP_X;
}

export interface LayoutUnit {
	id: string;
	root: CanvasNode;
	attachments: CanvasNode[];
	width: number;
	height: number;
	layer: number;
	componentOrder: number;
	creationIndex: number;
	top: number;
	predIds: Set<string>;
	succIds: Set<string>;
	virtual?: boolean;
	chainSourceId?: string;
	chainTargetId?: string;
	chainT?: number;
}

/**
 * Re-derives every node position from the finished node/edge graph using a
 * layered (Sugiyama-style) layout: nodes flow left to right by graph depth,
 * result text hangs below its dialogue, and vertical placement follows the
 * average position of connected neighbors so edges stay short and parallel.
 */
export function applyLayeredCanvasLayout(context: CanvasLayoutContext): void {
	const units = buildLayoutUnits(context);
	if (units.length === 0) {
		return;
	}

	const unitById = new Map<string, LayoutUnit>();
	const unitIdByNodeId = new Map<string, string>();
	for (const unit of units) {
		unitById.set(unit.id, unit);
		unitIdByNodeId.set(unit.root.id, unit.id);
		for (const attachment of unit.attachments) {
			unitIdByNodeId.set(attachment.id, unit.id);
		}
	}

	linkAcyclicUnitGraph(context, units, unitById, unitIdByNodeId);
	assignUnitLayers(units, unitById);
	assignUnitComponentOrder(units, unitById);
	const layerXPositions = computeLayerXPositions(context, units, unitById, unitIdByNodeId);
	insertSpacerUnits(units, unitById, layerXPositions);
	assignUnitTops(units, unitById);
	applyUnitPositions(units, layerXPositions);
	nudgeUnitsOffEdges(context, units, unitIdByNodeId, layerXPositions);
}

export function applyUnitPositions(units: LayoutUnit[], layerXPositions: Map<number, number>): void {
	for (const unit of units) {
		if (unit.virtual) {
			continue;
		}

		const unitX = layerXPositions.get(unit.layer) ?? 0;
		unit.root.x = unitX;
		unit.root.y = Math.round(unit.top);
		let cursorY = unit.root.y + unit.root.height;
		for (const attachment of unit.attachments) {
			attachment.x = unitX;
			attachment.y = cursorY + RESULT_GAP_Y;
			cursorY = attachment.y + attachment.height;
		}
	}
}

export function buildLayoutUnits(context: CanvasLayoutContext): LayoutUnit[] {
	const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
	const attachmentChildIds = new Map<string, string[]>();
	const attachedIds = new Set<string>();
	for (const edge of context.edges) {
		if (edge.fromSide !== 'bottom' || edge.toSide !== 'top') {
			continue;
		}
		if (!nodeById.has(edge.fromNode) || !nodeById.has(edge.toNode)) {
			continue;
		}
		if (attachedIds.has(edge.toNode) || edge.fromNode === edge.toNode) {
			continue;
		}

		const childIds = attachmentChildIds.get(edge.fromNode) ?? [];
		childIds.push(edge.toNode);
		attachmentChildIds.set(edge.fromNode, childIds);
		attachedIds.add(edge.toNode);
	}

	const units: LayoutUnit[] = [];
	for (let nodeIndex = 0; nodeIndex < context.nodes.length; nodeIndex += 1) {
		const node = context.nodes[nodeIndex];
		if (!node || attachedIds.has(node.id)) {
			continue;
		}

		const attachments: CanvasNode[] = [];
		const queue = [...(attachmentChildIds.get(node.id) ?? [])];
		while (queue.length > 0) {
			const attachmentId = queue.shift();
			const attachment = attachmentId ? nodeById.get(attachmentId) : undefined;
			if (!attachment) {
				continue;
			}

			attachments.push(attachment);
			queue.push(...(attachmentChildIds.get(attachment.id) ?? []));
		}

		let width = node.width;
		let height = node.height;
		for (const attachment of attachments) {
			width = Math.max(width, attachment.width);
			height += RESULT_GAP_Y + attachment.height;
		}

		units.push({
			id: node.id,
			root: node,
			attachments,
			width,
			height,
			layer: 0,
			componentOrder: nodeIndex,
			creationIndex: nodeIndex,
			top: 0,
			predIds: new Set<string>(),
			succIds: new Set<string>(),
		});
	}

	return units;
}

export function linkAcyclicUnitGraph(
	context: CanvasLayoutContext,
	units: LayoutUnit[],
	unitById: Map<string, LayoutUnit>,
	unitIdByNodeId: Map<string, string>,
): void {
	const rawSuccIds = new Map<string, string[]>();
	const seenUnitEdges = new Set<string>();
	for (const edge of context.edges) {
		if (edge.fromSide === 'bottom' && edge.toSide === 'top') {
			continue;
		}

		const fromUnitId = unitIdByNodeId.get(edge.fromNode);
		const toUnitId = unitIdByNodeId.get(edge.toNode);
		if (!fromUnitId || !toUnitId || fromUnitId === toUnitId) {
			continue;
		}

		const unitEdgeKey = `${fromUnitId}:${toUnitId}`;
		if (seenUnitEdges.has(unitEdgeKey)) {
			continue;
		}
		seenUnitEdges.add(unitEdgeKey);
		const succIds = rawSuccIds.get(fromUnitId) ?? [];
		succIds.push(toUnitId);
		rawSuccIds.set(fromUnitId, succIds);
	}

	// Depth-first sweep that keeps forward and cross edges but drops edges
	// closing a cycle, so layer assignment sees a DAG.
	const visitState = new Map<string, 'visiting' | 'done'>();
	const visit = (unitId: string): void => {
		visitState.set(unitId, 'visiting');
		for (const succId of rawSuccIds.get(unitId) ?? []) {
			const state = visitState.get(succId);
			if (state === 'visiting') {
				continue;
			}

			const fromUnit = unitById.get(unitId);
			const toUnit = unitById.get(succId);
			if (fromUnit && toUnit) {
				fromUnit.succIds.add(succId);
				toUnit.predIds.add(unitId);
			}
			if (state === undefined) {
				visit(succId);
			}
		}
		visitState.set(unitId, 'done');
	};
	for (const unit of units) {
		if (!visitState.has(unit.id)) {
			visit(unit.id);
		}
	}
}

export function assignUnitLayers(units: LayoutUnit[], unitById: Map<string, LayoutUnit>): void {
	const remainingIncoming = new Map<string, number>();
	const ready: LayoutUnit[] = [];
	for (const unit of units) {
		unit.layer = 0;
		remainingIncoming.set(unit.id, unit.predIds.size);
		if (unit.predIds.size === 0) {
			ready.push(unit);
		}
	}

	while (ready.length > 0) {
		const unit = ready.shift();
		if (!unit) {
			break;
		}

		for (const succId of unit.succIds) {
			const succ = unitById.get(succId);
			if (!succ) {
				continue;
			}

			succ.layer = Math.max(succ.layer, unit.layer + 1);
			const remaining = (remainingIncoming.get(succId) ?? 0) - 1;
			remainingIncoming.set(succId, remaining);
			if (remaining === 0) {
				ready.push(succ);
			}
		}
	}

	// Pull entry units (no predecessors) right, next to their earliest
	// consumer, so side branches start beside the column they feed.
	for (const unit of units) {
		if (unit.predIds.size > 0 || unit.succIds.size === 0) {
			continue;
		}

		let minSuccLayer = Number.POSITIVE_INFINITY;
		for (const succId of unit.succIds) {
			minSuccLayer = Math.min(minSuccLayer, unitById.get(succId)?.layer ?? Number.POSITIVE_INFINITY);
		}
		if (Number.isFinite(minSuccLayer)) {
			unit.layer = Math.max(unit.layer, minSuccLayer - 1);
		}
	}
}

export function assignUnitComponentOrder(units: LayoutUnit[], unitById: Map<string, LayoutUnit>): void {
	const componentRoots = new Map<string, string>();
	const findRoot = (unitId: string): string => {
		const parent = componentRoots.get(unitId);
		if (!parent || parent === unitId) {
			componentRoots.set(unitId, unitId);
			return unitId;
		}

		const root = findRoot(parent);
		componentRoots.set(unitId, root);
		return root;
	};
	const union = (leftId: string, rightId: string): void => {
		const leftRoot = findRoot(leftId);
		const rightRoot = findRoot(rightId);
		if (leftRoot !== rightRoot) {
			componentRoots.set(rightRoot, leftRoot);
		}
	};

	for (const unit of units) {
		findRoot(unit.id);
	}
	for (const unit of units) {
		for (const succId of unit.succIds) {
			union(unit.id, succId);
		}
	}

	const componentOrderByRoot = new Map<string, number>();
	for (const unit of units) {
		const root = findRoot(unit.id);
		const existing = componentOrderByRoot.get(root);
		if (existing === undefined || unit.creationIndex < existing) {
			componentOrderByRoot.set(root, unit.creationIndex);
		}
	}
	for (const unit of units) {
		unit.componentOrder = componentOrderByRoot.get(findRoot(unit.id)) ?? unit.creationIndex;
	}

	void unitById;
}

/**
 * Iteratively shifts units vertically when a straight edge still passes over
 * them after relaxation, then restacks each layer to keep minimum gaps.
 */
export function nudgeUnitsOffEdges(
	context: CanvasLayoutContext,
	units: LayoutUnit[],
	unitIdByNodeId: Map<string, string>,
	layerXPositions: Map<number, number>,
): void {
	const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
	const realUnits = units.filter((unit) => !unit.virtual);
	const unitsByLayer = new Map<number, LayoutUnit[]>();
	for (const unit of realUnits) {
		const layerUnits = unitsByLayer.get(unit.layer) ?? [];
		layerUnits.push(unit);
		unitsByLayer.set(unit.layer, layerUnits);
	}

	const margin = 24;
	const maxPasses = 6;
	for (let pass = 0; pass < maxPasses; pass += 1) {
		const segments: Array<{
			p1: { x: number; y: number };
			p2: { x: number; y: number };
			fromUnitId: string | undefined;
			toUnitId: string | undefined;
		}> = [];
		for (const edge of context.edges) {
			if (edge.fromSide === 'bottom' && edge.toSide === 'top') {
				continue;
			}

			const fromNode = nodeById.get(edge.fromNode);
			const toNode = nodeById.get(edge.toNode);
			if (!fromNode || !toNode) {
				continue;
			}

			segments.push({
				p1: edgeEndpoint(fromNode, edge.fromSide),
				p2: edgeEndpoint(toNode, edge.toSide),
				fromUnitId: unitIdByNodeId.get(edge.fromNode),
				toUnitId: unitIdByNodeId.get(edge.toNode),
			});
		}

		let moved = false;
		for (const layerUnits of unitsByLayer.values()) {
			for (const unit of layerUnits) {
				const left = unit.root.x;
				const right = unit.root.x + unit.width;
				const top = unit.top;
				const bottom = unit.top + unit.height;
				let delta = 0;
				for (const segment of segments) {
					if (segment.fromUnitId === unit.id || segment.toUnitId === unit.id) {
						continue;
					}

					const clip = segmentYRangeOverSpan(segment.p1, segment.p2, left, right);
					if (!clip || clip.maxY < top - margin / 2 || clip.minY > bottom + margin / 2) {
						continue;
					}

					const moveDownBy = clip.maxY + margin - top;
					const moveUpBy = bottom + margin - clip.minY;
					const candidate = moveDownBy <= moveUpBy ? moveDownBy : -moveUpBy;
					if (Math.abs(candidate) > Math.abs(delta)) {
						delta = candidate;
					}
				}

				if (delta !== 0) {
					unit.top += delta;
					moved = true;
				}
			}
		}

		if (!moved) {
			return;
		}

		for (const layerUnits of unitsByLayer.values()) {
			layerUnits.sort((leftUnit, rightUnit) => leftUnit.top - rightUnit.top);
			let previous: LayoutUnit | null = null;
			for (const unit of layerUnits) {
				if (previous) {
					const minimumTop = previous.top + previous.height + verticalUnitGap(previous, unit);
					unit.top = Math.max(unit.top, minimumTop);
				}
				previous = unit;
			}
		}

		applyUnitPositions(units, layerXPositions);
	}
}

export function segmentYRangeOverSpan(
	p1: { x: number; y: number },
	p2: { x: number; y: number },
	left: number,
	right: number,
): { minY: number; maxY: number } | null {
	const minX = Math.min(p1.x, p2.x);
	const maxX = Math.max(p1.x, p2.x);
	const clippedLeft = Math.max(minX, left);
	const clippedRight = Math.min(maxX, right);
	if (clippedLeft >= clippedRight) {
		return null;
	}

	const yAt = (x: number): number => {
		if (p1.x === p2.x) {
			return Math.min(p1.y, p2.y);
		}
		return p1.y + ((p2.y - p1.y) * (x - p1.x)) / (p2.x - p1.x);
	};
	const yLeft = yAt(clippedLeft);
	const yRight = yAt(clippedRight);
	return {
		minY: Math.min(yLeft, yRight),
		maxY: Math.max(yLeft, yRight),
	};
}

/**
 * Replaces every layout edge spanning more than one layer with a chain of
 * invisible spacer units, one per intermediate layer, so vertical relaxation
 * keeps a clear corridor for the edge instead of routing it across nodes.
 */
export function insertSpacerUnits(
	units: LayoutUnit[],
	unitById: Map<string, LayoutUnit>,
	layerXPositions: Map<number, number>,
): void {
	const layerWidths = new Map<number, number>();
	for (const unit of units) {
		layerWidths.set(unit.layer, Math.max(layerWidths.get(unit.layer) ?? 0, unit.width));
	}

	for (const unit of [...units]) {
		for (const succId of [...unit.succIds]) {
			const succ = unitById.get(succId);
			if (!succ || succ.layer - unit.layer < 2) {
				continue;
			}

			// The edge is a straight line in X, so each spacer's blend factor
			// comes from real X coordinates, not its layer index.
			const sourceAnchorX = (layerXPositions.get(unit.layer) ?? 0) + unit.root.width;
			const targetAnchorX = layerXPositions.get(succ.layer) ?? sourceAnchorX + 1;
			const anchorSpanX = Math.max(1, targetAnchorX - sourceAnchorX);

			unit.succIds.delete(succId);
			succ.predIds.delete(unit.id);
			let previous = unit;
			for (let layer = unit.layer + 1; layer < succ.layer; layer += 1) {
				const spacerX = (layerXPositions.get(layer) ?? 0) + (layerWidths.get(layer) ?? 0) / 2;
				const chainT = Math.min(1, Math.max(0, (spacerX - sourceAnchorX) / anchorSpanX));
				const spacerId = `spacer:${unit.id}:${succId}:${layer}`;
				const spacer: LayoutUnit = {
					id: spacerId,
					root: {
						id: spacerId,
						type: 'text',
						text: '',
						x: 0,
						y: 0,
						width: SPACER_UNIT_SIZE,
						height: SPACER_UNIT_SIZE,
					},
					attachments: [],
					width: SPACER_UNIT_SIZE,
					height: SPACER_UNIT_SIZE,
					layer,
					componentOrder: unit.componentOrder,
					creationIndex: unit.creationIndex,
					top: 0,
					predIds: new Set([previous.id]),
					succIds: new Set<string>(),
					virtual: true,
					chainSourceId: unit.id,
					chainTargetId: succId,
					chainT,
				};
				previous.succIds.add(spacerId);
				unitById.set(spacerId, spacer);
				units.push(spacer);
				previous = spacer;
			}

			previous.succIds.add(succId);
			succ.predIds.add(previous.id);
		}
	}
}

export function computeLayerXPositions(
	context: CanvasLayoutContext,
	units: LayoutUnit[],
	unitById: Map<string, LayoutUnit>,
	unitIdByNodeId: Map<string, string>,
): Map<number, number> {
	const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
	const maxLayer = Math.max(...units.map((unit) => unit.layer));
	const layerWidths = new Map<number, number>();
	for (const unit of units) {
		layerWidths.set(unit.layer, Math.max(layerWidths.get(unit.layer) ?? 0, unit.width));
	}

	// A boundary collapses to the tight gap when everything crossing it is a
	// gate flowing into its dialogue node.
	const tightBoundaries = new Map<number, boolean>();
	for (const edge of context.edges) {
		if (edge.fromSide === 'bottom' && edge.toSide === 'top') {
			continue;
		}

		const fromUnit = unitById.get(unitIdByNodeId.get(edge.fromNode) ?? '');
		const toUnit = unitById.get(unitIdByNodeId.get(edge.toNode) ?? '');
		if (!fromUnit || !toUnit || toUnit.layer - fromUnit.layer !== 1) {
			continue;
		}

		const fromNode = nodeById.get(edge.fromNode);
		const toNode = nodeById.get(edge.toNode);
		const isGateToDialogue = Boolean(
			fromNode && toNode && isGateNode(fromNode) && isDialogueFileNode(toNode),
		);
		const boundary = fromUnit.layer;
		const existing = tightBoundaries.get(boundary);
		tightBoundaries.set(boundary, existing === undefined ? isGateToDialogue : existing && isGateToDialogue);
	}

	const xPositions = new Map<number, number>();
	let cursorX = 0;
	for (let layer = 0; layer <= maxLayer; layer += 1) {
		xPositions.set(layer, cursorX);
		const gapX = tightBoundaries.get(layer) ? MIN_HORIZONTAL_EDGE_GAP_X : LAYER_GAP_X;
		cursorX += (layerWidths.get(layer) ?? 0) + gapX;
	}

	return xPositions;
}

export function assignUnitTops(units: LayoutUnit[], unitById: Map<string, LayoutUnit>): void {
	const unitsByLayer = new Map<number, LayoutUnit[]>();
	for (const unit of units) {
		const layerUnits = unitsByLayer.get(unit.layer) ?? [];
		layerUnits.push(unit);
		unitsByLayer.set(unit.layer, layerUnits);
	}

	const orderedLayers = [...unitsByLayer.keys()].sort((left, right) => left - right);
	for (const layer of orderedLayers) {
		const layerUnits = unitsByLayer.get(layer) ?? [];
		layerUnits.sort(
			(left, right) => left.componentOrder - right.componentOrder
				|| left.creationIndex - right.creationIndex,
		);
		let cursorY = 0;
		for (const unit of layerUnits) {
			unit.top = cursorY;
			cursorY += unit.height + LAYER_UNIT_GAP_Y;
		}
	}

	const unitAnchorY = (unit: LayoutUnit): number => unit.top + unit.root.height / 2;
	const neighborAlignedCenter = (unit: LayoutUnit, neighborIds: Set<string>): number | null => {
		let total = 0;
		let count = 0;
		for (const neighborId of neighborIds) {
			const neighbor = unitById.get(neighborId);
			if (!neighbor) {
				continue;
			}

			total += unitAnchorY(neighbor);
			count += 1;
		}
		return count > 0 ? total / count : null;
	};

	const relaxLayer = (layerUnits: LayoutUnit[], mode: 'preds' | 'succs' | 'both'): void => {
		if (layerUnits.length === 0) {
			return;
		}

		const desiredCenters = new Map<string, number>();
		for (const unit of layerUnits) {
			// Spacer units track the straight line between the real endpoints
			// of the long edge they stand in for, reserving its corridor.
			const chainSource = unit.chainSourceId ? unitById.get(unit.chainSourceId) : undefined;
			const chainTarget = unit.chainTargetId ? unitById.get(unit.chainTargetId) : undefined;
			if (unit.virtual && chainSource && chainTarget && unit.chainT !== undefined) {
				const sourceCenter = unitAnchorY(chainSource);
				const targetCenter = unitAnchorY(chainTarget);
				desiredCenters.set(unit.id, sourceCenter + (targetCenter - sourceCenter) * unit.chainT);
				continue;
			}

			const neighborIds = mode === 'preds'
				? unit.predIds
				: mode === 'succs'
					? unit.succIds
					: new Set([...unit.predIds, ...unit.succIds]);
			desiredCenters.set(unit.id, neighborAlignedCenter(unit, neighborIds) ?? unitAnchorY(unit));
		}

		const previousOrder = new Map(layerUnits.map((unit, index) => [unit.id, index]));
		const ordered = [...layerUnits].sort(
			(left, right) => (desiredCenters.get(left.id) ?? 0) - (desiredCenters.get(right.id) ?? 0)
				|| (previousOrder.get(left.id) ?? 0) - (previousOrder.get(right.id) ?? 0),
		);

		const minimumTops: number[] = [];
		let cumulativeTop = 0;
		for (let index = 0; index < ordered.length; index += 1) {
			minimumTops.push(cumulativeTop);
			const unit = ordered[index];
			const next = ordered[index + 1];
			if (!unit || !next) {
				continue;
			}

			cumulativeTop += unit.height + verticalUnitGap(unit, next);
		}

		const desiredOffsets = ordered.map((unit, index) => {
			const desiredTop = (desiredCenters.get(unit.id) ?? 0) - unit.root.height / 2;
			return desiredTop - (minimumTops[index] ?? 0);
		});
		const compactOffsets = compactIncreasingOffsets(desiredOffsets);
		for (let index = 0; index < ordered.length; index += 1) {
			const unit = ordered[index];
			if (!unit) {
				continue;
			}

			unit.top = (compactOffsets[index] ?? 0) + (minimumTops[index] ?? 0);
		}

		layerUnits.length = 0;
		layerUnits.push(...ordered);
	};

	const sweepCount = 6;
	for (let sweep = 0; sweep < sweepCount; sweep += 1) {
		for (const layer of orderedLayers) {
			relaxLayer(unitsByLayer.get(layer) ?? [], 'preds');
		}
		for (const layer of [...orderedLayers].reverse()) {
			relaxLayer(unitsByLayer.get(layer) ?? [], 'succs');
		}
	}
	for (const layer of orderedLayers) {
		relaxLayer(unitsByLayer.get(layer) ?? [], 'both');
	}
}

export function verticalUnitGap(upper: LayoutUnit, lower: LayoutUnit): number {
	if (upper.virtual || lower.virtual) {
		return SPACER_UNIT_GAP_Y;
	}
	if (isChoiceNode(upper.root) && isChoiceNode(lower.root)) {
		return CHOICE_STACK_GAP_Y;
	}

	return LAYER_UNIT_GAP_Y;
}

export function normalizeCanvasOrigin(context: CanvasLayoutContext): void {
	if (context.nodes.length === 0) {
		return;
	}

	const minimumX = Math.min(...context.nodes.map((node) => node.x));
	const targetX = context.nodes.some((node) => isAddTopicResultNode(node)) ? INTRODUCER_ORIGIN_X : 0;
	const deltaX = targetX - minimumX;
	if (deltaX === 0) {
		return;
	}

	for (const node of context.nodes) {
		node.x += deltaX;
	}
}

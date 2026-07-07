/**
 * @file Target selection for AddTopic edges.
 *
 * When a result card runs `AddTopic "x"`, the canvas draws an edge to where
 * topic "x" is laid out — but a topic can be rendered in several places.
 * This module picks which rendered instances should receive the edge.
 */

/** A candidate edge target with its canvas position and relevance score. */
export interface PositionedAddTopicTarget<T> {
	target: T;
	nodeId: string;
	/** Canvas coordinates of the candidate node. */
	x: number;
	y: number;
	/** Higher = more relevant to the quest (0 when unscored). */
	score?: number;
}

/**
 * Picks the AddTopic edge targets from the topic's first (leftmost) layout
 * column, i.e. where the reader enters the topic's tree. Within that column,
 * only the best-scoring candidates are kept when any scores are present;
 * ties keep all tied candidates (stable order: top-to-bottom, then node ID).
 */
export function selectFirstQuestTreeAddTopicTargets<T>(
	positionedTargets: Array<PositionedAddTopicTarget<T>>,
): T[] {
	if (positionedTargets.length === 0) {
		return [];
	}

	const firstX = Math.min(...positionedTargets.map((item) => item.x));
	const firstColumnTargets = positionedTargets
		.filter((item) => item.x === firstX)
		.sort((left, right) => left.y - right.y || left.nodeId.localeCompare(right.nodeId));
	const bestScore = Math.max(...firstColumnTargets.map((item) => item.score ?? 0));
	const selectedTargets = bestScore > 0
		? firstColumnTargets.filter((item) => (item.score ?? 0) === bestScore)
		: firstColumnTargets;

	return selectedTargets
		.map((item) => item.target);
}

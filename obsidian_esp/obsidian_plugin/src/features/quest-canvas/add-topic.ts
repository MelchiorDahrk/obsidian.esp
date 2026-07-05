export interface PositionedAddTopicTarget<T> {
	target: T;
	nodeId: string;
	x: number;
	y: number;
	score?: number;
}

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

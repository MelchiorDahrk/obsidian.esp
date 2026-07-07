/**
 * @file Provenance-matched refresh (canvas_editing_internals.md,
 * "Provenance-matched refresh").
 *
 * Rebuilds a quest canvas from the notes while keeping the user's manual
 * layout. Freshly generated nodes are matched to existing ones by provenance
 * (role + file + choiceValue); matched nodes keep their position and size,
 * genuinely new nodes are placed relative to a matched neighbor, and orphaned
 * generated nodes disappear. User-created nodes (no espCard) and user-drawn
 * edges always survive.
 */
import { getCardMeta } from './card-meta';
import { type CanvasEdge, type CanvasNode } from './model';
import { type CanvasData } from './sync-core';

/** Tallies of what a refresh merge did, for the completion notice. */
export interface RefreshStats {
	matched: number;
	added: number;
	removed: number;
	userNodesKept: number;
	userEdgesKept: number;
}

/**
 * Provenance identity of a generated node (`role:file:choiceValue`), or
 * `null` for user-created nodes. Two nodes with the same key across a
 * regeneration are "the same card" and share geometry.
 */
function provenanceKey(node: CanvasNode): string | null {
	const meta = getCardMeta(node);
	if (!meta) {
		return null;
	}
	return `${meta.role}:${meta.file ?? ''}:${meta.choiceValue ?? ''}`;
}

/**
 * Merges a freshly generated canvas into the existing one, preserving
 * manual layout. Returns the merged canvas (fresh node identities, existing
 * geometry) and the merge statistics.
 */
export function mergeCanvasPreservingLayout(
	existing: CanvasData,
	fresh: { nodes: CanvasNode[]; edges: CanvasEdge[] },
): { merged: CanvasData; stats: RefreshStats } {
	const stats: RefreshStats = { matched: 0, added: 0, removed: 0, userNodesKept: 0, userEdgesKept: 0 };

	const existingByProvenance = new Map<string, CanvasNode>();
	for (const node of existing.nodes) {
		const key = provenanceKey(node);
		if (key !== null && !existingByProvenance.has(key)) {
			existingByProvenance.set(key, node);
		}
	}

	// Old node id -> new node id, for remapping user-drawn edges. Ids only
	// change when the generator's seed includes mutable text (choice cards).
	const idRemap = new Map<string, string>();
	const matchedExistingIds = new Set<string>();
	const mergedNodes: CanvasNode[] = [];
	const unmatchedFresh: CanvasNode[] = [];

	for (const freshNode of fresh.nodes) {
		const key = provenanceKey(freshNode);
		const match = key !== null ? existingByProvenance.get(key) : undefined;
		if (match) {
			stats.matched += 1;
			matchedExistingIds.add(match.id);
			idRemap.set(match.id, freshNode.id);
			mergedNodes.push({
				...freshNode,
				x: match.x,
				y: match.y,
				width: match.width,
				height: freshNode.type === 'text' ? freshNode.height : match.height,
			});
		} else {
			unmatchedFresh.push(freshNode);
		}
	}

	// Place genuinely new nodes relative to a matched neighbor so they land
	// near their branch instead of at generated-layout coordinates.
	const freshById = new Map(fresh.nodes.map((node) => [node.id, node]));
	const mergedById = new Map(mergedNodes.map((node) => [node.id, node]));
	for (const freshNode of unmatchedFresh) {
		stats.added += 1;
		const neighborEdge = fresh.edges.find(
			(edge) => (edge.fromNode === freshNode.id && mergedById.has(edge.toNode))
				|| (edge.toNode === freshNode.id && mergedById.has(edge.fromNode)),
		);
		let placed = { ...freshNode };
		if (neighborEdge) {
			const freshNeighborId = neighborEdge.fromNode === freshNode.id ? neighborEdge.toNode : neighborEdge.fromNode;
			const freshNeighbor = freshById.get(freshNeighborId);
			const mergedNeighbor = mergedById.get(freshNeighborId);
			if (freshNeighbor && mergedNeighbor) {
				placed = {
					...freshNode,
					x: mergedNeighbor.x + (freshNode.x - freshNeighbor.x),
					y: mergedNeighbor.y + (freshNode.y - freshNeighbor.y),
				};
			}
		}
		mergedNodes.push(placed);
		mergedById.set(placed.id, placed);
	}

	// Keep user-created nodes; drop orphaned generated nodes.
	for (const node of existing.nodes) {
		if (getCardMeta(node)) {
			if (!matchedExistingIds.has(node.id)) {
				stats.removed += 1;
			}
			continue;
		}
		stats.userNodesKept += 1;
		mergedNodes.push(node);
		mergedById.set(node.id, node);
	}

	// Fresh edges carry the regenerated wiring; user-drawn edges survive when
	// both endpoints still exist (remapped through provenance matching).
	const mergedEdges: CanvasEdge[] = [...fresh.edges];
	const freshEdgeIds = new Set(fresh.edges.map((edge) => edge.id));
	const generatedOldEdgeIds = new Set<string>();
	for (const edge of existing.edges) {
		if (edge.espCard?.role === 'derived') {
			generatedOldEdgeIds.add(edge.id);
		}
	}
	for (const edge of existing.edges) {
		if (freshEdgeIds.has(edge.id) || generatedOldEdgeIds.has(edge.id)) {
			continue;
		}
		const fromNode = idRemap.get(edge.fromNode) ?? edge.fromNode;
		const toNode = idRemap.get(edge.toNode) ?? edge.toNode;
		if (!mergedById.has(fromNode) || !mergedById.has(toNode)) {
			continue;
		}
		if (mergedEdges.some((candidate) => candidate.fromNode === fromNode && candidate.toNode === toNode)) {
			continue;
		}
		stats.userEdgesKept += 1;
		mergedEdges.push({ ...edge, fromNode, toNode });
	}

	const merged: CanvasData = {
		...existing,
		nodes: mergedNodes,
		edges: mergedEdges,
	};
	return { merged, stats };
}

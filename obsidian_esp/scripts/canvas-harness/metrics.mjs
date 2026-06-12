// Layout-quality metrics for .canvas files.
//
// Usage: node scripts/canvas-harness/metrics.mjs <file.canvas> [more.canvas...]

import { readFileSync } from 'node:fs';

function endpoint(node, side) {
	switch (side) {
		case 'left':
			return { x: node.x, y: node.y + node.height / 2 };
		case 'right':
			return { x: node.x + node.width, y: node.y + node.height / 2 };
		case 'top':
			return { x: node.x + node.width / 2, y: node.y };
		case 'bottom':
			return { x: node.x + node.width / 2, y: node.y + node.height };
		default:
			return { x: node.x, y: node.y };
	}
}

function segmentsIntersect(p1, p2, p3, p4) {
	const d = (a, b, c) => (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
	const d1 = d(p3, p4, p1);
	const d2 = d(p3, p4, p2);
	const d3 = d(p1, p2, p3);
	const d4 = d(p1, p2, p4);
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
		&& ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentIntersectsRect(p1, p2, rect) {
	const corners = [
		{ x: rect.x, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y + rect.height },
		{ x: rect.x, y: rect.y + rect.height },
	];
	const inside = (p) => p.x > rect.x && p.x < rect.x + rect.width && p.y > rect.y && p.y < rect.y + rect.height;
	if (inside(p1) || inside(p2)) {
		return true;
	}
	for (let index = 0; index < 4; index += 1) {
		if (segmentsIntersect(p1, p2, corners[index], corners[(index + 1) % 4])) {
			return true;
		}
	}
	return false;
}

function analyze(filePath) {
	const canvas = JSON.parse(readFileSync(filePath, 'utf8'));
	const nodeById = new Map(canvas.nodes.map((node) => [node.id, node]));
	const segments = [];
	let backwardEdges = 0;
	let totalFlowLength = 0;
	let flowCount = 0;

	for (const edge of canvas.edges) {
		const from = nodeById.get(edge.fromNode);
		const to = nodeById.get(edge.toNode);
		if (!from || !to) {
			continue;
		}
		const p1 = endpoint(from, edge.fromSide);
		const p2 = endpoint(to, edge.toSide);
		segments.push({ edge, p1, p2, from, to });
		if (edge.fromSide === 'right' && edge.toSide === 'left') {
			flowCount += 1;
			totalFlowLength += Math.hypot(p2.x - p1.x, p2.y - p1.y);
			if (p2.x < p1.x) {
				backwardEdges += 1;
			}
		}
	}

	let crossings = 0;
	const detailCross = process.env.METRICS_DETAIL === '1';
	const labelNode = (node) => (node.file ? node.file.split('/').pop() : (node.text ?? '').split('\n')[0].slice(0, 36));
	for (let a = 0; a < segments.length; a += 1) {
		for (let b = a + 1; b < segments.length; b += 1) {
			if (segmentsIntersect(segments[a].p1, segments[a].p2, segments[b].p1, segments[b].p2)) {
				crossings += 1;
				if (detailCross) {
					console.log(`  [cross] (${labelNode(segments[a].from)} -> ${labelNode(segments[a].to)}) x (${labelNode(segments[b].from)} -> ${labelNode(segments[b].to)})`);
				}
			}
		}
	}

	let edgeNodeOverlaps = 0;
	const detail = process.env.METRICS_DETAIL === '1';
	const label = (node) => (node.file ? node.file.split('/').pop() : (node.text ?? '').split('\n')[0].slice(0, 40));
	for (const segment of segments) {
		for (const node of canvas.nodes) {
			if (node === segment.from || node === segment.to) {
				continue;
			}
			if (segmentIntersectsRect(segment.p1, segment.p2, node)) {
				edgeNodeOverlaps += 1;
				if (detail) {
					console.log(`  [over] ${label(segment.from)} -> ${label(segment.to)} crosses node ${label(node)}`);
				}
			}
		}
	}

	let nodeOverlaps = 0;
	for (let a = 0; a < canvas.nodes.length; a += 1) {
		for (let b = a + 1; b < canvas.nodes.length; b += 1) {
			const left = canvas.nodes[a];
			const right = canvas.nodes[b];
			if (
				left.x < right.x + right.width && right.x < left.x + left.width
				&& left.y < right.y + right.height && right.y < left.y + left.height
			) {
				nodeOverlaps += 1;
			}
		}
	}

	const minX = Math.min(...canvas.nodes.map((node) => node.x));
	const maxX = Math.max(...canvas.nodes.map((node) => node.x + node.width));
	const minY = Math.min(...canvas.nodes.map((node) => node.y));
	const maxY = Math.max(...canvas.nodes.map((node) => node.y + node.height));

	return {
		file: filePath,
		nodes: canvas.nodes.length,
		edges: canvas.edges.length,
		crossings,
		backwardEdges,
		edgeNodeOverlaps,
		nodeOverlaps,
		avgFlowLength: flowCount > 0 ? Math.round(totalFlowLength / flowCount) : 0,
		width: maxX - minX,
		height: maxY - minY,
	};
}

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('usage: node metrics.mjs <file.canvas> [more.canvas...]');
	process.exit(1);
}

const rows = files.map((file) => analyze(file));
console.table(rows.map((row) => ({
	file: row.file.split(/[\\/]/).pop(),
	nodes: row.nodes,
	edges: row.edges,
	cross: row.crossings,
	back: row.backwardEdges,
	'edge/node': row.edgeNodeOverlaps,
	'node/node': row.nodeOverlaps,
	avgLen: row.avgFlowLength,
	width: row.width,
	height: row.height,
})));

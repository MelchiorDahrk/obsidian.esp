// Renders a .canvas file to a standalone SVG for quick visual inspection.
//
// Usage: node scripts/canvas-harness/render-svg.mjs <file.canvas> <out.svg>

import { readFileSync, writeFileSync } from 'node:fs';

const COLOR_FILLS = {
	1: '#7a3b3b',
	2: '#7a5a2f',
	3: '#6b6b35',
	4: '#3d6b40',
	5: '#2f6b66',
	6: '#4a4a7a',
};

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

function escapeXml(text) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const [inFile, outFile] = process.argv.slice(2);
const canvas = JSON.parse(readFileSync(inFile, 'utf8'));
const nodeById = new Map(canvas.nodes.map((node) => [node.id, node]));

const pad = 100;
const minX = Math.min(...canvas.nodes.map((n) => n.x)) - pad;
const minY = Math.min(...canvas.nodes.map((n) => n.y)) - pad;
const maxX = Math.max(...canvas.nodes.map((n) => n.x + n.width)) + pad;
const maxY = Math.max(...canvas.nodes.map((n) => n.y + n.height)) + pad;

const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" style="background:#1e1e1e">`);
parts.push(`<rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="#1e1e1e"/>`);

for (const edge of canvas.edges) {
	const from = nodeById.get(edge.fromNode);
	const to = nodeById.get(edge.toNode);
	if (!from || !to) {
		continue;
	}
	const p1 = endpoint(from, edge.fromSide);
	const p2 = endpoint(to, edge.toSide);
	parts.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#9aa0b5" stroke-width="3" opacity="0.8"/>`);
	parts.push(`<circle cx="${p2.x}" cy="${p2.y}" r="8" fill="#9aa0b5"/>`);
	if (edge.label) {
		const mx = (p1.x + p2.x) / 2;
		const my = (p1.y + p2.y) / 2;
		parts.push(`<text x="${mx}" y="${my - 6}" fill="#cfd3e0" font-size="22" text-anchor="middle">${escapeXml(edge.label)}</text>`);
	}
}

for (const node of canvas.nodes) {
	const fill = COLOR_FILLS[node.color] ?? '#3a3a3a';
	parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="10" fill="${fill}" fill-opacity="0.55" stroke="${fill}" stroke-width="3"/>`);
	const label = node.file
		? node.file.split('/').pop().replace(/\.md$/, '')
		: (node.text ?? '').split('\n')[0].slice(0, 42);
	parts.push(`<text x="${node.x + 10}" y="${node.y + 26}" fill="#e8e8e8" font-size="20">${escapeXml(label)}</text>`);
	const second = node.text ? (node.text.split('\n')[1] ?? '') : '';
	if (second) {
		parts.push(`<text x="${node.x + 10}" y="${node.y + 52}" fill="#b8b8b8" font-size="17">${escapeXml(second.slice(0, 44))}</text>`);
	}
}

parts.push('</svg>');
writeFileSync(outFile, parts.join('\n'), 'utf8');
console.log(`wrote ${outFile} (${Math.round(maxX - minX)}x${Math.round(maxY - minY)})`);

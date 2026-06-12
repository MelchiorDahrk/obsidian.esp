// Compares the edge sets of two .canvas files by readable node names.
//
// Usage: node compare-edges.mjs <a.canvas> <b.canvas> [filterSubstring]

import { readFileSync } from 'node:fs';

const [fileA, fileB, filter] = process.argv.slice(2);

function edgeNames(path) {
	const canvas = JSON.parse(readFileSync(path, 'utf8'));
	const byId = new Map(canvas.nodes.map((node) => [node.id, node]));
	const name = (node) => (node.file
		? node.file.split('/').pop()
		: (node.text ?? '').split('\n')[0].slice(0, 48));
	const names = new Set();
	for (const edge of canvas.edges) {
		const from = byId.get(edge.fromNode);
		const to = byId.get(edge.toNode);
		if (!from || !to) {
			continue;
		}
		names.add(`${name(from)} -> ${name(to)}${edge.label ? ` [${edge.label}]` : ''}`);
	}
	return names;
}

const namesA = edgeNames(fileA);
const namesB = edgeNames(fileB);
const matches = (text) => !filter || text.toLowerCase().includes(filter.toLowerCase());

console.log(`--- only in ${fileA.split(/[\\/]/).pop()}:`);
for (const text of [...namesA].sort()) {
	if (!namesB.has(text) && matches(text)) {
		console.log(`  ${text}`);
	}
}
console.log(`--- only in ${fileB.split(/[\\/]/).pop()}:`);
for (const text of [...namesB].sort()) {
	if (!namesA.has(text) && matches(text)) {
		console.log(`  ${text}`);
	}
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);
const {
	extractMasterNamesFromPluginBytes,
} = jiti(resolve(here, '../src/database/header-parser.ts'));

function u32(value) {
	return [
		value & 0xff,
		(value >>> 8) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 24) & 0xff,
	];
}

function tag(value) {
	return [...value].map((character) => character.charCodeAt(0));
}

function masterSubrecord(name) {
	const encoded = [...Buffer.from(`${name}\0`, 'utf8')];
	return [
		...tag('MAST'),
		...u32(encoded.length),
		...encoded,
		...tag('DATA'),
		...u32(8),
		...u32(1234),
		...u32(0),
	];
}

function buildHeader(masters = []) {
	const hedr = [...tag('HEDR'), ...u32(300), ...new Array(300).fill(0)];
	const subrecords = [...hedr, ...masters.flatMap((name) => masterSubrecord(name))];
	return new Uint8Array([
		...tag('TES3'),
		...u32(subrecords.length),
		...u32(0),
		...u32(0),
		...subrecords,
	]);
}

test('extractMasterNamesFromPluginBytes returns an empty list when no masters are present', () => {
	assert.deepEqual(extractMasterNamesFromPluginBytes(buildHeader()), []);
});

test('extractMasterNamesFromPluginBytes returns all master names in order', () => {
	assert.deepEqual(
		extractMasterNamesFromPluginBytes(
			buildHeader(['Morrowind.esm', 'Tribunal.esm', 'Bloodmoon.esm']),
		),
		['Morrowind.esm', 'Tribunal.esm', 'Bloodmoon.esm'],
	);
});

test('extractMasterNamesFromPluginBytes rejects truncated headers', () => {
	assert.throws(
		() =>
			extractMasterNamesFromPluginBytes(
				buildHeader(['Morrowind.esm']).subarray(0, 40),
			),
		/truncated/i,
	);
});

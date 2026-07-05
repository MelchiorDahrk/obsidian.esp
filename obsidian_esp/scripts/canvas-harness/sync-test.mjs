// Bundles and runs the canvas→note sync-core tests.
//
// Usage: node scripts/canvas-harness/sync-test.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../obsidian_plugin/package.json'));
const esbuild = require('esbuild');

const outfile = path.join(here, '.build', 'sync-test.bundle.mjs');
await esbuild.build({
	entryPoints: [path.join(here, 'sync-test-entry.mjs')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	outfile,
	alias: {
		obsidian: path.join(here, 'obsidian-stub.mjs'),
	},
	logLevel: 'silent',
});

await import(pathToFileURL(outfile).href);

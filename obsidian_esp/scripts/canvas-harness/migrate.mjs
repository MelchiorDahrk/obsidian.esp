// Bundles migrate-entry.mjs (with 'obsidian' aliased to the local stub) and
// runs it with the given CLI arguments.
//
// Usage: node scripts/canvas-harness/migrate.mjs <vaultDir>
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../obsidian_plugin/package.json'));
const esbuild = require('esbuild');

const outfile = path.join(here, '.build', 'migrate.bundle.mjs');
await esbuild.build({
	entryPoints: [path.join(here, 'migrate-entry.mjs')],
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

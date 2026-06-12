// Headless driver for the quest canvas generator. Bundled by run.mjs with the
// 'obsidian' import aliased to obsidian-stub.mjs.
//
// Usage (after bundling): node harness.bundle.mjs <vaultDir> <questFolderPath> <outFile>

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TFile, TFolder, normalizePath } from 'obsidian';
import {
	discoverQuestScope,
	buildQuestCanvas,
} from '../../obsidian_plugin/src/features/generate-quest-canvas.ts';

class FakeVault {
	constructor(rootDir) {
		this.rootDir = rootDir;
		this.byPath = new Map();
	}

	async init() {
		const root = new TFolder();
		root.path = '/';
		root.name = '';
		root.vault = this;
		this.byPath.set('/', root);
		await this.addChildren(root, this.rootDir);
		return this;
	}

	async addChildren(folder, dir) {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const childPath = folder.path === '/' ? entry.name : `${folder.path}/${entry.name}`;
			const diskPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				const child = new TFolder();
				child.path = childPath;
				child.name = entry.name;
				child.parent = folder;
				child.vault = this;
				folder.children.push(child);
				this.byPath.set(childPath, child);
				await this.addChildren(child, diskPath);
			} else {
				const child = new TFile();
				child.path = childPath;
				child.name = entry.name;
				const dot = entry.name.lastIndexOf('.');
				child.basename = dot === -1 ? entry.name : entry.name.slice(0, dot);
				child.extension = dot === -1 ? '' : entry.name.slice(dot + 1);
				child.parent = folder;
				child.vault = this;
				folder.children.push(child);
				this.byPath.set(childPath, child);
			}
		}
	}

	getAbstractFileByPath(filePath) {
		return this.byPath.get(normalizePath(filePath)) ?? null;
	}

	async read(file) {
		return fs.readFile(path.join(this.rootDir, file.path), 'utf8');
	}
}

const [vaultDir, questFolderPath, outFile] = process.argv.slice(2);
if (!vaultDir || !questFolderPath || !outFile) {
	console.error('usage: node harness.bundle.mjs <vaultDir> <questFolderPath> <outFile>');
	process.exit(1);
}

const vault = await new FakeVault(path.resolve(vaultDir)).init();
const app = { vault, metadataCache: null };
const folder = vault.getAbstractFileByPath(questFolderPath);
if (!(folder instanceof TFolder)) {
	console.error(`quest folder not found in vault: ${questFolderPath}`);
	process.exit(1);
}

const scope = await discoverQuestScope(app, folder);
const buildResult = await buildQuestCanvas(app, scope);
const canvasJson = JSON.stringify(
	{
		nodes: buildResult.nodes,
		edges: buildResult.edges,
		metadata: { version: '1.0-1.0', frontmatter: {} },
	},
	null,
	'\t',
);
await fs.mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
await fs.writeFile(path.resolve(outFile), canvasJson, 'utf8');
console.log(`quest: ${scope.questTitle}`);
console.log(`nodes: ${buildResult.nodes.length}, edges: ${buildResult.edges.length}`);
if (buildResult.warnings.length > 0) {
	console.log(`warnings: ${buildResult.warnings.join(' | ')}`);
}
console.log(`wrote ${outFile}`);

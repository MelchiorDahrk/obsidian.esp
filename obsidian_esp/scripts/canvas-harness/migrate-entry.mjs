// Headless driver for the "Clean canvas block IDs" migration. Bundled by
// migrate.mjs with the 'obsidian' import aliased to obsidian-stub.mjs.
//
// Usage (after bundling): node migrate.bundle.mjs <vaultDir>
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TFile, TFolder, normalizePath } from 'obsidian';
import { cleanCanvasBlockIds } from '../../obsidian_plugin/src/features/quest-canvas/migration.ts';

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

	getFiles() {
		return [...this.byPath.values()].filter((file) => file instanceof TFile);
	}

	async read(file) {
		return fs.readFile(path.join(this.rootDir, file.path), 'utf8');
	}

	async process(file, fn) {
		const content = await this.read(file);
		const next = fn(content);
		if (next !== content) {
			await fs.writeFile(path.join(this.rootDir, file.path), next, 'utf8');
		}
		return next;
	}
}

const [vaultDir] = process.argv.slice(2);
if (!vaultDir) {
	console.error('usage: node migrate.bundle.mjs <vaultDir>');
	process.exit(1);
}

const vault = await new FakeVault(path.resolve(vaultDir)).init();
const app = { vault, metadataCache: null };
const summary = await cleanCanvasBlockIds(app);
console.log(`notes changed: ${summary.notesChanged}`);
console.log(`backlinks pruned: ${summary.backlinksPruned}`);
console.log(`canvases changed: ${summary.canvasesChanged}`);

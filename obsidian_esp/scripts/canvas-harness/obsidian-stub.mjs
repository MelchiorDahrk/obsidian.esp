// Minimal stub of the 'obsidian' module API surface used by
// generate-quest-canvas.ts so it can run headlessly under Node.

export function normalizePath(path) {
	const normalized = String(path)
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\//, '')
		.replace(/\/$/, '');
	return normalized.length > 0 ? normalized : '/';
}

export class Notice {
	constructor(message) {
		console.log(`[notice] ${message}`);
	}
}

export class TAbstractFile {
	constructor() {
		this.path = '';
		this.name = '';
		this.parent = null;
		this.vault = null;
	}
}

export class TFile extends TAbstractFile {
	constructor() {
		super();
		this.basename = '';
		this.extension = '';
	}
}

export class TFolder extends TAbstractFile {
	constructor() {
		super();
		this.children = [];
	}

	isRoot() {
		return this.parent === null;
	}
}

export class Modal {
	constructor(app) {
		this.app = app;
		this.contentEl = null;
		this.titleEl = null;
	}

	open() {}

	close() {}

	onOpen() {}

	onClose() {}
}

export class App {
	constructor() {
		this.vault = null;
		this.metadataCache = null;
	}
}

// UI base classes referenced (but never instantiated) by inspector.ts when
// the whole quest-canvas package is bundled headlessly.
export class Plugin {
	constructor() {
		this.app = null;
	}

	registerEvent() {}

	registerView() {}
}

export class ItemView {
	constructor(leaf) {
		this.leaf = leaf;
		this.app = null;
		this.contentEl = null;
	}
}

export class FuzzySuggestModal extends Modal {}

export class Setting {
	constructor() {}
}

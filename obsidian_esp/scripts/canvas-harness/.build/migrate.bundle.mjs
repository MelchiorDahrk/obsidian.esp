// scripts/canvas-harness/migrate-entry.mjs
import { promises as fs } from "node:fs";
import path from "node:path";

// scripts/canvas-harness/obsidian-stub.mjs
function normalizePath(path2) {
  const normalized = String(path2).replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\//, "").replace(/\/$/, "");
  return normalized.length > 0 ? normalized : "/";
}
var TAbstractFile = class {
  constructor() {
    this.path = "";
    this.name = "";
    this.parent = null;
    this.vault = null;
  }
};
var TFile = class extends TAbstractFile {
  constructor() {
    super();
    this.basename = "";
    this.extension = "";
  }
};
var TFolder = class extends TAbstractFile {
  constructor() {
    super();
    this.children = [];
  }
  isRoot() {
    return this.parent === null;
  }
};

// obsidian_plugin/src/utils/obsidian-utils.ts
function splitFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (match) {
    return {
      frontmatter: match[0],
      body: content.slice(match[0].length)
    };
  }
  return { frontmatter: "", body: content };
}

// obsidian_plugin/src/features/quest-canvas/model.ts
var CANVAS_BODY_BLOCK_PREFIX = "obsidian-esp-canvas";
var GATE_GAP_X = 520;
var INTRODUCER_ORIGIN_X = -GATE_GAP_X;

// obsidian_plugin/src/features/quest-canvas/migration.ts
var BLOCK_ID_PATTERN = new RegExp(`[ \\t]*\\^${CANVAS_BODY_BLOCK_PREFIX}-[A-Za-z0-9]+[ \\t]*$`, "gm");
var CANVAS_SUBPATH_PREFIX = `#^${CANVAS_BODY_BLOCK_PREFIX}`;
var TEXT_SUBPATH_PATTERN = new RegExp(`#\\^${CANVAS_BODY_BLOCK_PREFIX}-[A-Za-z0-9]+`, "g");
async function cleanCanvasBlockIds(app2) {
  const summary2 = { notesChanged: 0, backlinksPruned: 0, canvasesChanged: 0 };
  const files = app2.vault.getFiles();
  for (const file of files.filter((candidate) => candidate.extension === "md")) {
    let prunedHere = 0;
    let changed = false;
    await app2.vault.process(file, (content) => {
      const withoutBlockIds = content.replace(BLOCK_ID_PATTERN, "");
      const { next, pruned } = pruneDeadCanvasBacklinks(app2, file, withoutBlockIds);
      prunedHere = pruned;
      changed = next !== content;
      return next;
    });
    if (changed) {
      summary2.notesChanged += 1;
      summary2.backlinksPruned += prunedHere;
    }
  }
  for (const file of files.filter((candidate) => candidate.extension === "canvas")) {
    let changed = false;
    await app2.vault.process(file, (content) => {
      const cleaned = stripCanvasSubpaths(content);
      changed = cleaned !== null;
      return cleaned ?? content;
    });
    if (changed) {
      summary2.canvasesChanged += 1;
    }
  }
  return summary2;
}
function pruneDeadCanvasBacklinks(app2, file, content) {
  const { frontmatter, body } = splitFrontmatter(content);
  if (frontmatter.length === 0 || !/^canvas:/m.test(frontmatter)) {
    return { next: content, pruned: 0 };
  }
  const lines = frontmatter.split("\n");
  const keptLines = [];
  let pruned = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/^canvas:\s*$/.test(line)) {
      keptLines.push(line);
      continue;
    }
    const itemLines = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length && /^\s*-\s+/.test(lines[nextIndex] ?? "")) {
      itemLines.push(lines[nextIndex] ?? "");
      nextIndex += 1;
    }
    const keptItems = itemLines.filter((item) => {
      const linkMatch = item.match(/\[\[([^\]|#]+)/);
      const target = linkMatch?.[1]?.trim();
      if (!target) {
        return true;
      }
      if (canvasLinkTargetExists(app2, file, target)) {
        return true;
      }
      pruned += 1;
      return false;
    });
    if (keptItems.length > 0) {
      keptLines.push(line, ...keptItems);
    }
    index = nextIndex - 1;
  }
  if (pruned === 0) {
    return { next: content, pruned: 0 };
  }
  return { next: `${keptLines.join("\n")}${body}`, pruned };
}
function canvasLinkTargetExists(app2, sourceFile, linkTarget) {
  const resolved = app2.metadataCache?.getFirstLinkpathDest(linkTarget, sourceFile.path);
  if (resolved) {
    return true;
  }
  const targetName = linkTarget.split("/").pop() ?? linkTarget;
  return app2.vault.getFiles().some((candidate) => candidate.name === targetName);
}
function stripCanvasSubpaths(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.nodes)) {
    return null;
  }
  let changed = false;
  for (const node of parsed.nodes) {
    const subpath = node["subpath"];
    if (typeof subpath === "string" && subpath.startsWith(CANVAS_SUBPATH_PREFIX)) {
      delete node["subpath"];
      changed = true;
    }
    const text = node["text"];
    if (typeof text === "string" && TEXT_SUBPATH_PATTERN.test(text)) {
      node["text"] = text.replace(TEXT_SUBPATH_PATTERN, "");
      changed = true;
    }
    TEXT_SUBPATH_PATTERN.lastIndex = 0;
  }
  if (!changed) {
    return null;
  }
  return JSON.stringify(parsed, null, "	");
}

// scripts/canvas-harness/migrate-entry.mjs
var FakeVault = class {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.byPath = /* @__PURE__ */ new Map();
  }
  async init() {
    const root = new TFolder();
    root.path = "/";
    root.name = "";
    root.vault = this;
    this.byPath.set("/", root);
    await this.addChildren(root, this.rootDir);
    return this;
  }
  async addChildren(folder, dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = folder.path === "/" ? entry.name : `${folder.path}/${entry.name}`;
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
        const dot = entry.name.lastIndexOf(".");
        child.basename = dot === -1 ? entry.name : entry.name.slice(0, dot);
        child.extension = dot === -1 ? "" : entry.name.slice(dot + 1);
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
    return fs.readFile(path.join(this.rootDir, file.path), "utf8");
  }
  async process(file, fn) {
    const content = await this.read(file);
    const next = fn(content);
    if (next !== content) {
      await fs.writeFile(path.join(this.rootDir, file.path), next, "utf8");
    }
    return next;
  }
};
var [vaultDir] = process.argv.slice(2);
if (!vaultDir) {
  console.error("usage: node migrate.bundle.mjs <vaultDir>");
  process.exit(1);
}
var vault = await new FakeVault(path.resolve(vaultDir)).init();
var app = { vault, metadataCache: null };
var summary = await cleanCanvasBlockIds(app);
console.log(`notes changed: ${summary.notesChanged}`);
console.log(`backlinks pruned: ${summary.backlinksPruned}`);
console.log(`canvases changed: ${summary.canvasesChanged}`);

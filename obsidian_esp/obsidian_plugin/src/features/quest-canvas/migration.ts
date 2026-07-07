/**
 * @file One-shot cleanup migration for legacy quest canvases. Backs the
 * "Clean canvas block ID markers" command.
 */
import { App, TFile } from 'obsidian';
import { splitFrontmatter } from '../../utils/obsidian-utils';
import { CANVAS_BODY_BLOCK_PREFIX } from './model';

/**
 * One-shot migration for vaults generated before canvases became read-only
 * over dialogue notes:
 *
 * - strips the trailing ` ^obsidian-esp-canvas-<hash>` block ids that older
 *   generations appended to note bodies,
 * - prunes `canvas:` backlinks whose target canvas no longer exists,
 * - removes `#^obsidian-esp-canvas-*` subpaths from canvas file nodes.
 */
export interface CanvasCleanupSummary {
	notesChanged: number;
	backlinksPruned: number;
	canvasesChanged: number;
}

const BLOCK_ID_PATTERN = new RegExp(`[ \\t]*\\^${CANVAS_BODY_BLOCK_PREFIX}-[A-Za-z0-9]+[ \\t]*$`, 'gm');
const CANVAS_SUBPATH_PREFIX = `#^${CANVAS_BODY_BLOCK_PREFIX}`;
const TEXT_SUBPATH_PATTERN = new RegExp(`#\\^${CANVAS_BODY_BLOCK_PREFIX}-[A-Za-z0-9]+`, 'g');

export async function cleanCanvasBlockIds(app: App): Promise<CanvasCleanupSummary> {
	const summary: CanvasCleanupSummary = { notesChanged: 0, backlinksPruned: 0, canvasesChanged: 0 };
	const files = app.vault.getFiles();

	for (const file of files.filter((candidate) => candidate.extension === 'md')) {
		let prunedHere = 0;
		let changed = false;
		await app.vault.process(file, (content) => {
			const withoutBlockIds = content.replace(BLOCK_ID_PATTERN, '');
			const { next, pruned } = pruneDeadCanvasBacklinks(app, file, withoutBlockIds);
			prunedHere = pruned;
			changed = next !== content;
			return next;
		});
		if (changed) {
			summary.notesChanged += 1;
			summary.backlinksPruned += prunedHere;
		}
	}

	for (const file of files.filter((candidate) => candidate.extension === 'canvas')) {
		let changed = false;
		await app.vault.process(file, (content) => {
			const cleaned = stripCanvasSubpaths(content);
			changed = cleaned !== null;
			return cleaned ?? content;
		});
		if (changed) {
			summary.canvasesChanged += 1;
		}
	}

	return summary;
}

/**
 * Removes `- "[[X.canvas]]"` items under the `canvas:` frontmatter key when
 * X.canvas no longer exists, and the whole key when its list empties.
 */
function pruneDeadCanvasBacklinks(
	app: App,
	file: TFile,
	content: string,
): { next: string; pruned: number } {
	const { frontmatter, body } = splitFrontmatter(content);
	if (frontmatter.length === 0 || !/^canvas:/m.test(frontmatter)) {
		return { next: content, pruned: 0 };
	}

	const lines = frontmatter.split('\n');
	const keptLines: string[] = [];
	let pruned = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (!/^canvas:\s*$/.test(line)) {
			keptLines.push(line);
			continue;
		}

		const itemLines: string[] = [];
		let nextIndex = index + 1;
		while (nextIndex < lines.length && /^\s*-\s+/.test(lines[nextIndex] ?? '')) {
			itemLines.push(lines[nextIndex] ?? '');
			nextIndex += 1;
		}

		const keptItems = itemLines.filter((item) => {
			const linkMatch = item.match(/\[\[([^\]|#]+)/);
			const target = linkMatch?.[1]?.trim();
			if (!target) {
				return true;
			}
			if (canvasLinkTargetExists(app, file, target)) {
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
	return { next: `${keptLines.join('\n')}${body}`, pruned };
}

function canvasLinkTargetExists(app: App, sourceFile: TFile, linkTarget: string): boolean {
	const resolved = app.metadataCache?.getFirstLinkpathDest(linkTarget, sourceFile.path);
	if (resolved) {
		return true;
	}

	// Fallback (also used headlessly, where metadataCache is unavailable):
	// match by file name anywhere in the vault.
	const targetName = linkTarget.split('/').pop() ?? linkTarget;
	return app.vault.getFiles().some((candidate) => candidate.name === targetName);
}

/** Returns the cleaned canvas JSON, or null when nothing changed / not parseable. */
export function stripCanvasSubpaths(content: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return null;
	}

	if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { nodes?: unknown }).nodes)) {
		return null;
	}

	let changed = false;
	for (const node of (parsed as { nodes: Array<Record<string, unknown>> }).nodes) {
		const subpath = node['subpath'];
		if (typeof subpath === 'string' && subpath.startsWith(CANVAS_SUBPATH_PREFIX)) {
			delete node['subpath'];
			changed = true;
		}

		// Result cards rendered wikilinks with block-id subpaths
		// (`Journal [[Note#^obsidian-esp-canvas-…|label]]`); flatten them to
		// plain links.
		const text = node['text'];
		if (typeof text === 'string' && TEXT_SUBPATH_PATTERN.test(text)) {
			node['text'] = text.replace(TEXT_SUBPATH_PATTERN, '');
			changed = true;
		}
		TEXT_SUBPATH_PATTERN.lastIndex = 0;
	}

	if (!changed) {
		return null;
	}
	return JSON.stringify(parsed, null, '\t');
}

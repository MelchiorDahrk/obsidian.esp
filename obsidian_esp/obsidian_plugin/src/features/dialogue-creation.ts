/**
 * @file Right-click "create" actions for dialogue projects.
 *
 * Two families of commands, wired into the folder/file context menu by
 * `main.ts`:
 *
 * - **On a dialogue note** (`Type:` is one of the dialogue types): Insert
 *   above, Insert below, Duplicate. These create a sibling entry positioned
 *   relative to the clicked note. Ordering follows the project's filename
 *   convention — `{topic} ~{n}.md` for Topic/Greeting/Voice (numeric `~n`
 *   sort) and `{topic} {index}.md` for Journal (the `Index` field, which the
 *   compiler ultimately sorts journals by). See `src/parse/mod.rs`
 *   (`default_sort_order`) and `src/export.rs` (`info_file_name`) for the
 *   authoritative scheme this mirrors.
 *
 * - **On a type folder** (`Topic`/`Journal`/`Greeting`/`Voice` directly under
 *   a plugin root): Add new topic/journal/greeting/voice. Each creates the
 *   subfolder, its Bases index note, and a first blank entry, then opens the
 *   entry for editing.
 *
 * New entries are written with blank `DiagID`/`PrevID`; the compiler assigns
 * real ids and repairs the prev/next chain from file order at compile time.
 */
import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { PathManager } from './path-manager';
import { BASE_FILE_NAME, ensureBaseFileInFolder } from './topic-base';
import {
	promptForMarking,
	promptForText,
	promptFromList,
	type ListChoice,
	type MarkingRow,
} from '../ui/input-modals';
import { splitFrontmatter } from '../utils/obsidian-utils';

/** Dialogue types that count as an authorable "dialogue note". */
const DIALOGUE_NOTE_TYPES = ['Topic', 'Greeting', 'Journal', 'Voice', 'Persuasion'] as const;

/** Top-level type folders that expose an "Add new …" command. */
export type TypeFolderKind = 'Topic' | 'Journal' | 'Greeting' | 'Voice';
const TYPE_FOLDER_KINDS: TypeFolderKind[] = ['Topic', 'Journal', 'Greeting', 'Voice'];

/** The engine's fixed greeting topics (mirrors `VALID_GREETING_TOPICS`). */
const VALID_GREETING_TOPICS = [
	'Greeting 0', 'Greeting 1', 'Greeting 2', 'Greeting 3', 'Greeting 4',
	'Greeting 5', 'Greeting 6', 'Greeting 7', 'Greeting 8', 'Greeting 9',
];

/** The engine's fixed voice-line topics (mirrors `VALID_VOICE_TOPICS`). */
const VALID_VOICE_TOPICS = [
	'Alarm', 'Attack', 'Flee', 'Hello', 'Hit', 'Idle', 'Intruder', 'Thief',
];

/** Journal index used for a brand-new quest's first stage. */
const FIRST_JOURNAL_INDEX = 10;

/**
 * Reads a single frontmatter key as a string from the metadata cache. Returns
 * `undefined` when absent or non-string; arrays yield their first string entry.
 * Synchronous so it can gate context-menu items.
 */
function readStringFrontmatter(app: App, file: TFile, key: string): string | undefined {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as
		| Record<string, unknown>
		| undefined;
	const raw = frontmatter?.[key];
	if (typeof raw === 'string') {
		return raw;
	}
	if (Array.isArray(raw) && typeof raw[0] === 'string') {
		return raw[0];
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Classification (synchronous — safe to call while building a context menu).
// ---------------------------------------------------------------------------

/**
 * Returns the dialogue `Type` of a note if it is a dialogue entry, else `null`.
 * Reads the metadata cache synchronously so it can gate menu items; falls back
 * to the folder name under a recognized type directory when frontmatter has not
 * been indexed yet.
 */
export function dialogueNoteType(app: App, file: TFile): string | null {
	if (file.extension !== 'md') {
		return null;
	}

	const type = readStringFrontmatter(app, file, 'Type');
	if (type && (DIALOGUE_NOTE_TYPES as readonly string[]).includes(type)) {
		return type;
	}

	// Index/view notes (e.g. `Background.md`) share the folder name and have no
	// `Type`, so a note whose stem equals its parent folder is not an entry.
	if (file.basename === file.parent?.name) {
		return null;
	}

	const parts = file.path.split('/');
	for (const kind of DIALOGUE_NOTE_TYPES) {
		const idx = parts.indexOf(kind);
		if (idx !== -1 && idx < parts.length - 2) {
			return kind;
		}
	}
	return null;
}

/**
 * Returns the kind of a top-level type folder (`Topic`/`Journal`/`Greeting`/
 * `Voice`) when `folder` sits directly under a plugin root, else `null`.
 */
export function typeFolderKind(folder: TFolder): TypeFolderKind | null {
	const kind = TYPE_FOLDER_KINDS.find((k) => k.toLowerCase() === folder.name.toLowerCase());
	if (!kind) {
		return null;
	}
	const parent = folder.parent;
	if (!parent || !PathManager.isPluginRoot(parent)) {
		return null;
	}
	return kind;
}

// ---------------------------------------------------------------------------
// Content templates.
// ---------------------------------------------------------------------------

/** Blank Topic/Greeting entry frontmatter (mirrors `render_info` field order). */
function blankSpeakerEntry(type: 'Topic' | 'Greeting' | 'Voice', topic: string): string {
	const voiceFields = type === 'Voice' ? 'Sound Path:\nResult:\n' : '';
	return `---
Source:
Type: ${type}
Topic: ${topic}
DiagID:
PrevID:
Disposition: 0
ID:
Race:
Sex:
Class:
Faction:
Rank:
Cell:
PC Faction:
PC Rank:
${voiceFields}---

`;
}

/** Blank Journal entry frontmatter for the given stage index. */
function blankJournalEntry(topic: string, index: number): string {
	return `---
Source:
Type: Journal
Topic: ${topic}
DiagID:
PrevID:
Index: ${index}
Quest Name: false
Finished: false
Restart: false
---

`;
}

/** The Bases index/view note that renders a topic folder's entries as a table. */
function indexNoteContent(kind: TypeFolderKind, rootFolder: TFolder): string {
	const baseFilePath = normalizePath(`${rootFolder.path}/${BASE_FILE_NAME}`);
	return `![[${baseFilePath}#${kind} View]]\n`;
}

// ---------------------------------------------------------------------------
// Sibling-entry bookkeeping.
// ---------------------------------------------------------------------------

interface SpeakerEntry {
	file: TFile;
	/** The numeric `~n` position from the filename. */
	order: number;
}

interface JournalEntry {
	file: TFile;
	index: number;
	/** The `~n` duplicate-order suffix (0 when absent). */
	duplicate: number;
}

/** Escapes a string for use as a literal inside a `RegExp`. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Non-journal sibling entries (`{stem} ~{n}.md`), sorted by `n` ascending. */
function collectSpeakerEntries(folder: TFolder, stem: string): SpeakerEntry[] {
	const pattern = new RegExp(`^${escapeRegExp(stem)} ~(\\d+)$`);
	const entries: SpeakerEntry[] = [];
	for (const child of folder.children) {
		if (!(child instanceof TFile) || child.extension !== 'md') {
			continue;
		}
		const match = child.basename.match(pattern);
		if (match) {
			entries.push({ file: child, order: Number(match[1]) });
		}
	}
	return entries.sort((left, right) => left.order - right.order);
}

/** Journal sibling entries (`{stem} {index}[ ~{dup}].md`), sorted by stage. */
function collectJournalEntries(folder: TFolder, stem: string): JournalEntry[] {
	const pattern = new RegExp(`^${escapeRegExp(stem)} (\\d+)(?: ~(\\d+))?$`);
	const entries: JournalEntry[] = [];
	for (const child of folder.children) {
		if (!(child instanceof TFile) || child.extension !== 'md') {
			continue;
		}
		const match = child.basename.match(pattern);
		if (match) {
			entries.push({
				file: child,
				index: Number(match[1]),
				duplicate: match[2] ? Number(match[2]) : 0,
			});
		}
	}
	return entries.sort((left, right) => left.index - right.index || left.duplicate - right.duplicate);
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

/** Reveals a freshly created note in a new tab. */
async function openNote(app: App, path: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		await app.workspace.getLeaf(false).openFile(file);
	}
}

/** Reads a file and blanks its `PrevID` if it is currently set, so the compiler
 *  re-derives the link from file order (used after inserting a note ahead of it). */
async function clearPrevId(app: App, file: TFile): Promise<void> {
	const content = await app.vault.read(file);
	const cleared = content.replace(/^PrevID:.*$/m, 'PrevID:');
	if (cleared !== content) {
		await app.vault.modify(file, cleared);
	}
}

/** The plugin project root for a note/folder, falling back to the type folder. */
function projectRoot(folder: TFolder): TFolder {
	return PathManager.findPluginRoot(folder) ?? folder;
}

// ---------------------------------------------------------------------------
// Note-level actions: Insert above / below / Duplicate.
// ---------------------------------------------------------------------------

/**
 * Creates a sibling dialogue entry positioned relative to `source`.
 *
 * @param placement `above`/`below` for a blank entry either side of `source`;
 *   `duplicate` copies `source`'s content (minus its ids) directly below it.
 */
export async function createSiblingEntry(
	app: App,
	source: TFile,
	type: string,
	placement: 'above' | 'below' | 'duplicate',
): Promise<void> {
	const folder = source.parent;
	if (!folder) {
		return;
	}

	try {
		if (type === 'Journal') {
			await insertJournalEntry(app, source, folder, placement);
		} else {
			await insertSpeakerEntry(app, source, folder, type, placement);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Failed to create entry: ${message}`);
	}
}

/** Handles Topic/Greeting/Voice insertion, renumbering `~n` siblings as needed. */
async function insertSpeakerEntry(
	app: App,
	source: TFile,
	folder: TFolder,
	type: string,
	placement: 'above' | 'below' | 'duplicate',
): Promise<void> {
	const stem = folder.name;
	const entries = collectSpeakerEntries(folder, stem);
	const sourceIdx = entries.findIndex((entry) => entry.file.path === source.path);
	if (sourceIdx === -1) {
		new Notice('Could not locate the note among its siblings.');
		return;
	}

	const insertPos = placement === 'above' ? sourceIdx : sourceIdx + 1;
	// The entry the new note is inserted directly before (its future successor).
	const successor = entries[insertPos];

	const newOrder = await openSpeakerSlot(app, entries, insertPos, stem);

	let content: string;
	if (placement === 'duplicate') {
		content = stripIdentity(await app.vault.read(source));
	} else if (type === 'Voice') {
		content = blankSpeakerEntry('Voice', getTopic(app, source, stem));
	} else {
		content = blankSpeakerEntry(type === 'Greeting' ? 'Greeting' : 'Topic', getTopic(app, source, stem));
	}

	const newPath = normalizePath(`${folder.path}/${stem} ~${newOrder}.md`);
	await app.vault.create(newPath, content);

	// Keep the chain consistent: the successor now follows the new note, so its
	// authored PrevID (which pointed at the new note's predecessor) is stale.
	if (successor) {
		await clearPrevId(app, successor.file);
	}

	await openNote(app, newPath);
}

/**
 * Opens the `~n` slot at `insertPos`, renumbering the contiguous run of later
 * siblings upward when there is no numeric gap. Returns the free `~n` value.
 */
async function openSpeakerSlot(
	app: App,
	entries: SpeakerEntry[],
	insertPos: number,
	stem: string,
): Promise<number> {
	const prevOrder = insertPos > 0 ? entries[insertPos - 1]!.order : -1;

	// Appending at the end, or a numeric gap already exists — no renumber needed.
	if (insertPos >= entries.length) {
		return prevOrder + 1;
	}
	const nextOrder = entries[insertPos]!.order;
	if (nextOrder - prevOrder >= 2) {
		return prevOrder + 1;
	}

	// No gap: shift the contiguous run starting at insertPos up by one. Rename
	// via a temporary name first so no intermediate collides with a sibling.
	const toShift: SpeakerEntry[] = [];
	let expected = nextOrder;
	for (let i = insertPos; i < entries.length && entries[i]!.order === expected; i += 1) {
		toShift.push(entries[i]!);
		expected += 1;
	}

	const folderPath = entries[insertPos]!.file.parent!.path;
	const stamp = Date.now();
	for (let i = 0; i < toShift.length; i += 1) {
		const tempPath = normalizePath(`${folderPath}/${stem} ~tmp-${stamp}-${i}.md`);
		await app.fileManager.renameFile(toShift[i]!.file, tempPath);
	}
	for (const entry of toShift) {
		const finalPath = normalizePath(`${folderPath}/${stem} ~${entry.order + 1}.md`);
		await app.fileManager.renameFile(entry.file, finalPath);
	}

	return prevOrder + 1;
}

/** Handles Journal insertion by choosing a stage `Index` between neighbors. */
async function insertJournalEntry(
	app: App,
	source: TFile,
	folder: TFolder,
	placement: 'above' | 'below' | 'duplicate',
): Promise<void> {
	const stem = folder.name;
	const entries = collectJournalEntries(folder, stem);
	const sourceIdx = entries.findIndex((entry) => entry.file.path === source.path);
	if (sourceIdx === -1) {
		new Notice('Could not locate the note among its siblings.');
		return;
	}

	const insertPos = placement === 'above' ? sourceIdx : sourceIdx + 1;
	const prev = entries[insertPos - 1];
	const next = entries[insertPos];

	// Pick a stage index that sorts into the requested slot. A duplicate keeps
	// the source's own stage (its content already carries that `Index`); a
	// blank insert takes the gap between neighbors, or — when they are adjacent
	// — reuses the predecessor's index as a duplicate, which
	// `default_sort_order` positions via the ` ~dup` filename suffix.
	let index: number;
	if (placement === 'duplicate') {
		index = entries[sourceIdx]!.index;
	} else if (!next) {
		index = (prev?.index ?? 0) + FIRST_JOURNAL_INDEX;
	} else if (!prev) {
		index = Math.max(0, next.index - 1);
	} else if (next.index - prev.index >= 2) {
		index = prev.index + 1;
	} else {
		index = prev.index;
	}

	const topic = getTopic(app, source, stem);
	const content = placement === 'duplicate'
		? stripIdentity(await app.vault.read(source))
		: blankJournalEntry(topic, index);

	const newPath = pickFreeJournalPath(folder, stem, index, entries);
	await app.vault.create(newPath, content);
	await openNote(app, newPath);
}

/** Smallest free `{stem} {index}[ ~{dup}].md` path for a journal stage. */
function pickFreeJournalPath(
	folder: TFolder,
	stem: string,
	index: number,
	entries: JournalEntry[],
): string {
	const base = normalizePath(`${folder.path}/${stem} ${index}.md`);
	if (!entries.some((entry) => entry.index === index)) {
		return base;
	}
	for (let dup = 1; ; dup += 1) {
		const candidate = normalizePath(`${folder.path}/${stem} ${index} ~${dup}.md`);
		if (!entries.some((entry) => entry.file.path === candidate)) {
			return candidate;
		}
	}
}

/** Blanks the record-identity fields on copied content for a fresh entry. */
function stripIdentity(content: string): string {
	return content
		.replace(/^DiagID:.*$/m, 'DiagID:')
		.replace(/^PrevID:.*$/m, 'PrevID:')
		.replace(/^Source:.*$/m, 'Source:');
}

/** The `Topic` value for a note, from frontmatter or the folder name fallback. */
function getTopic(app: App, file: TFile, fallback: string): string {
	const topic = readStringFrontmatter(app, file, 'Topic');
	return topic && topic.length > 0 ? topic : fallback;
}

// ---------------------------------------------------------------------------
// Note-level action: Move to… (reorder within the topic folder).
// ---------------------------------------------------------------------------

/**
 * Reorders a non-journal dialogue note within its topic folder. Prompts for a
 * target `~n` marking, then renames the note to that marking (shifting only the
 * occupant's contiguous run when the marking is taken) and repairs the
 * prev/next chain. Journals order by their `Index` field and are excluded.
 */
export async function moveDialogueNote(app: App, source: TFile, type: string): Promise<void> {
	if (type === 'Journal') {
		return;
	}

	const folder = source.parent;
	if (!folder) {
		return;
	}

	try {
		const stem = folder.name;
		const entries = collectSpeakerEntries(folder, stem);
		const sourceIdx = entries.findIndex((entry) => entry.file.path === source.path);
		if (sourceIdx === -1) {
			new Notice('Could not locate the note among its siblings.');
			return;
		}
		if (entries.length < 2) {
			new Notice('Nothing to reorder — this topic has only one entry.');
			return;
		}

		const currentMarking = entries[sourceIdx]!.order;
		const rows = await buildMarkingRows(app, entries, sourceIdx);
		const target = await promptForMarking(app, {
			title: 'Move to position',
			description: 'Enter or pick the ~n marking to move this note to. '
				+ 'If it is taken, the entries there shift down to make room.',
			rows,
			initialValue: currentMarking,
		});
		if (target === null || target === currentMarking) {
			return;
		}

		await placeSpeakerAtMarking(app, entries, entries[sourceIdx]!, target, stem);
		await openNote(app, source.path);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Failed to move note: ${message}`);
	}
}

/** Builds picker rows (marking + short body preview) for each sibling entry. */
async function buildMarkingRows(
	app: App,
	entries: SpeakerEntry[],
	sourceIdx: number,
): Promise<MarkingRow[]> {
	return await Promise.all(
		entries.map(async (entry, index) => ({
			marking: entry.order,
			label: await previewLine(app, entry.file),
			current: index === sourceIdx,
		})),
	);
}

/** First non-empty body line of a note, truncated — used to label picker rows. */
async function previewLine(app: App, file: TFile): Promise<string> {
	const content = await app.vault.read(file);
	const { body } = splitFrontmatter(content);
	const line = body
		.split('\n')
		.map((text) => text.trim())
		.find((text) => text.length > 0 && !text.startsWith('!['));
	const stripped = (line ?? '').replace(/\[\[(?:[^|\]]*\|)?([^|\]]*)\]\]/g, '$1');
	if (stripped.length === 0) {
		return '(empty)';
	}
	return stripped.length > 60 ? `${stripped.slice(0, 60)}…` : stripped;
}

/**
 * Renames `source` to the `~target` marking, preserving every other entry's
 * marking. When `target` is already taken, the occupant and its contiguous run
 * shift up by one to open the slot (so a note can be pushed into an occupied
 * position). Renames go through a temporary name first to avoid collisions, and
 * every entry whose predecessor changed has its `PrevID` cleared so the
 * compiler rebuilds the chain from the new file order.
 */
async function placeSpeakerAtMarking(
	app: App,
	entries: SpeakerEntry[],
	source: SpeakerEntry,
	target: number,
	stem: string,
): Promise<void> {
	const folderPath = source.file.parent!.path;
	const remaining = entries.filter((entry) => entry.file !== source.file);

	// If `target` is occupied, shift its contiguous run (target, target+1, …) up
	// by one to free the slot; a numeric gap needs no shifting.
	const occupantIdx = remaining.findIndex((entry) => entry.order === target);
	const toShift: SpeakerEntry[] = [];
	if (occupantIdx !== -1) {
		let expected = target;
		for (let i = occupantIdx; i < remaining.length && remaining[i]!.order === expected; i += 1) {
			toShift.push(remaining[i]!);
			expected += 1;
		}
	}

	// New markings: source -> target, each shifted entry -> its marking + 1.
	const newMarking = new Map<TFile, number>();
	newMarking.set(source.file, target);
	for (const entry of toShift) {
		newMarking.set(entry.file, entry.order + 1);
	}

	// Two-pass rename (via temp names) for every file whose marking changes.
	const renamed = [source, ...toShift];
	const stamp = Date.now();
	for (let i = 0; i < renamed.length; i += 1) {
		const tempPath = normalizePath(`${folderPath}/${stem} ~tmp-${stamp}-${i}.md`);
		await app.fileManager.renameFile(renamed[i]!.file, tempPath);
	}
	for (const entry of renamed) {
		const finalPath = normalizePath(`${folderPath}/${stem} ~${newMarking.get(entry.file)!}.md`);
		await app.fileManager.renameFile(entry.file, finalPath);
	}

	// Clear PrevID on any entry whose predecessor changed, so its link re-derives.
	// Keyed on the stable TFile reference, since paths mutate during renaming.
	const markingOf = (entry: SpeakerEntry) => newMarking.get(entry.file) ?? entry.order;
	const newOrder = [...entries].sort((left, right) => markingOf(left) - markingOf(right));

	const oldPredecessor = new Map<TFile, TFile | null>();
	entries.forEach((entry, index) => {
		oldPredecessor.set(entry.file, index > 0 ? entries[index - 1]!.file : null);
	});
	for (let index = 0; index < newOrder.length; index += 1) {
		const entry = newOrder[index]!;
		const newPred = index > 0 ? newOrder[index - 1]!.file : null;
		if (oldPredecessor.get(entry.file) !== newPred) {
			await clearPrevId(app, entry.file);
		}
	}
}

// ---------------------------------------------------------------------------
// Folder-level actions: Add new topic / journal / greeting / voice.
// ---------------------------------------------------------------------------

/** Dispatches the "Add new …" command for a clicked type folder. */
export async function addNewDialogue(app: App, typeFolder: TFolder, kind: TypeFolderKind): Promise<void> {
	try {
		switch (kind) {
			case 'Topic':
				await addNamedDialogue(app, typeFolder, 'Topic');
				break;
			case 'Journal':
				await addNamedDialogue(app, typeFolder, 'Journal');
				break;
			case 'Greeting':
				await addFixedDialogue(app, typeFolder, 'Greeting', VALID_GREETING_TOPICS);
				break;
			case 'Voice':
				await addFixedDialogue(app, typeFolder, 'Voice', VALID_VOICE_TOPICS);
				break;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Failed to add ${kind.toLowerCase()}: ${message}`);
	}
}

/** Topic/Journal: prompt for a free-text name, then create the subfolder. */
async function addNamedDialogue(app: App, typeFolder: TFolder, kind: 'Topic' | 'Journal'): Promise<void> {
	const name = await promptForText(app, {
		title: kind === 'Topic' ? 'New topic name' : 'New journal (quest) ID',
		placeholder: kind === 'Topic' ? 'e.g. Background' : 'e.g. MyMod_TheQuest',
	});
	if (!name) {
		return;
	}

	const existing = app.vault.getAbstractFileByPath(normalizePath(`${typeFolder.path}/${name}`));
	if (existing) {
		new Notice(`A ${kind.toLowerCase()} named "${name}" already exists.`);
		return;
	}

	await createDialogueFolder(app, typeFolder, kind, name);
}

/** Greeting/Voice: pick a valid topic from the fixed list, then create it. */
async function addFixedDialogue(
	app: App,
	typeFolder: TFolder,
	kind: 'Greeting' | 'Voice',
	validTopics: string[],
): Promise<void> {
	const choices: ListChoice[] = validTopics.map((topic) => {
		const exists = app.vault.getAbstractFileByPath(normalizePath(`${typeFolder.path}/${topic}`)) instanceof TFolder;
		return { value: topic, hint: exists ? '(add another entry)' : undefined };
	});

	const topic = await promptFromList(app, {
		title: kind === 'Greeting' ? 'Select a greeting' : 'Select a voice type',
		choices,
	});
	if (!topic) {
		return;
	}

	await createDialogueFolder(app, typeFolder, kind, topic);
}

/**
 * Creates (or reuses) a `{type}/{name}` folder, ensures its Bases index note
 * and the shared `base.base`, appends a blank first entry, and opens it.
 */
async function createDialogueFolder(
	app: App,
	typeFolder: TFolder,
	kind: TypeFolderKind,
	name: string,
): Promise<void> {
	const folderPath = normalizePath(`${typeFolder.path}/${name}`);
	let folder = app.vault.getAbstractFileByPath(folderPath);
	if (!folder) {
		folder = await app.vault.createFolder(folderPath);
	}
	if (!(folder instanceof TFolder)) {
		new Notice(`Could not create folder "${name}".`);
		return;
	}

	const root = projectRoot(typeFolder);
	await ensureBaseFileInFolder(app, root);

	const indexPath = normalizePath(`${folderPath}/${name}.md`);
	if (!app.vault.getAbstractFileByPath(indexPath)) {
		await app.vault.create(indexPath, indexNoteContent(kind, root));
	}

	let entryPath: string;
	let entryContent: string;
	if (kind === 'Journal') {
		const entries = collectJournalEntries(folder, name);
		const index = entries.length === 0
			? FIRST_JOURNAL_INDEX
			: entries[entries.length - 1]!.index + FIRST_JOURNAL_INDEX;
		entryPath = pickFreeJournalPath(folder, name, index, entries);
		entryContent = blankJournalEntry(name, index);
	} else {
		const entries = collectSpeakerEntries(folder, name);
		const order = entries.length === 0 ? 0 : entries[entries.length - 1]!.order + 1;
		entryPath = normalizePath(`${folderPath}/${name} ~${order}.md`);
		entryContent = blankSpeakerEntry(kind === 'Greeting' ? 'Greeting' : kind === 'Voice' ? 'Voice' : 'Topic', name);
	}

	await app.vault.create(entryPath, entryContent);
	await openNote(app, entryPath);
	new Notice(`Created ${kind.toLowerCase()} "${name}".`);
}

/**
 * @file Quest discovery: the first stage of canvas generation.
 *
 * Resolves what the user selected into a {@link QuestScope} (quest title,
 * IDs, journal milestones, output path), reads dialogue notes into
 * {@link DialogueRecord}s, and decides which records belong on the canvas.
 * Relevance is transitive: a record is included if it references the quest
 * directly, or if it leads to / is led to by a relevant record through
 * Choice chains and AddTopic results (`resolvePropagatedRelevantRecords`).
 *
 * A "quest" may span multiple journal topics — sibling `Journal/<Id>` folders
 * whose quest-name entries normalize to the same key are treated as one quest.
 */
import { App, normalizePath, TFile, TFolder } from 'obsidian';
import { splitFrontmatter } from '../../utils/obsidian-utils';
import { PathManager } from '../path-manager';
import { firstChoiceValue, parseConditions, parseResultActions } from './cards';
import {
	conditionsCanFollowChoice,
	determinePhaseAnchor,
	groupRecordsByNormalizedTopic,
	groupRecordsByTopic,
	resolveAddTopicTransitionTargets,
} from './families';
import { parseStructuredFrontmatter } from './frontmatter-surgeon';
import {
	DIALOGUE_TYPES,
	type DialogueRecord,
	JOURNAL_FOLDER_NAME,
	type JournalMilestone,
	type MarkdownDocument,
	QUEST_NAME_FIELD,
	QUESTS_FOLDER_NAME,
	type QuestScope,
} from './model';
import {
	createNodeId,
	firstNonEmptyLine,
	firstSentence,
	getBooleanValue,
	getResultValue,
	getStringValue,
	isDialogueType,
	normalizeQuestNameKey,
	sanitizeFileName,
	stripBlockId,
	stripWikilinkSyntax,
	uniqueValues,
} from './utils';

/**
 * Builds the {@link QuestScope} for a selected folder.
 *
 * Walks up to the `Journal/<QuestId>` folder, reads its journal entries,
 * pulls the quest title from the quest-name entry, then scans sibling
 * journal folders for entries with the same normalized title so multi-topic
 * quests are merged. Throws with a user-facing message when the selection is
 * not inside a project's Journal tree or has no indexed milestones.
 */
export async function discoverQuestScope(app: App, folder: TFolder): Promise<QuestScope> {
	const projectRoot = PathManager.findPluginRoot(folder);
	if (!projectRoot) {
		throw new Error('Could not find a valid obsidian.esp project root (missing header.md).');
	}

	const journalFolder = resolveJournalQuestFolder(folder, projectRoot);
	if (!journalFolder) {
		throw new Error('Select a quest folder inside Journal/<QuestId>.');
	}

	const selectedDocs = await readFolderMarkdownDocuments(app, journalFolder);
	const selectedQuestTitle = extractQuestTitle(selectedDocs) ?? journalFolder.name;
	const selectedQuestKey = normalizeQuestNameKey(selectedQuestTitle);
	const allJournalFolders = getImmediateChildFolders(projectRoot, JOURNAL_FOLDER_NAME);
	const linkedFolders = [journalFolder];

	if (selectedQuestKey !== null) {
		for (const sibling of allJournalFolders) {
			if (sibling.path === journalFolder.path) {
				continue;
			}

			const siblingDocs = await readFolderMarkdownDocuments(app, sibling);
			const siblingTitle = extractQuestTitle(siblingDocs);
			if (!siblingTitle) {
				continue;
			}

			if (normalizeQuestNameKey(siblingTitle) === selectedQuestKey) {
				linkedFolders.push(sibling);
			}
		}
	}

	const journalDocuments = (
		await Promise.all(linkedFolders.map((childFolder) => readFolderMarkdownDocuments(app, childFolder)))
	).flat();
	const rootJournalDocuments = journalDocuments.filter((document) => isQuestNameNote(document));
	const journalMilestones = journalDocuments
		.map((document) => toJournalMilestone(document))
		.filter((milestone): milestone is JournalMilestone => milestone !== null)
		.sort((left, right) => left.index - right.index || left.file.path.localeCompare(right.file.path));

	if (journalMilestones.length === 0) {
		throw new Error('No journal milestones with numeric Index values were found in the selected quest folder.');
	}

	const questIds = uniqueValues(journalDocuments.map((document) => getStringValue(document.frontmatter, 'Topic')).filter((value): value is string => Boolean(value)));
	const questsFolderPath = normalizePath(`${projectRoot.path}/${QUESTS_FOLDER_NAME}`);
	const outputCanvasPath = normalizePath(`${questsFolderPath}/${sanitizeFileName(selectedQuestTitle)}.canvas`);

	return {
		projectRoot,
		selectedFolder: journalFolder,
		questTitle: selectedQuestTitle,
		questKey: selectedQuestKey,
		questIds,
		journalFolders: linkedFolders,
		journalDocuments,
		journalMilestones,
		rootJournalDocuments,
		outputCanvasPath,
	};
}

/** Reads every note under the project's dialogue type folders. */
export async function readDialogueDocuments(app: App, projectRoot: TFolder): Promise<MarkdownDocument[]> {
	const documents: MarkdownDocument[] = [];
	for (const dialogueType of DIALOGUE_TYPES) {
		const folderPath = normalizePath(`${projectRoot.path}/${dialogueType}`);
		const folder = app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) {
			continue;
		}

		documents.push(...(await readFolderMarkdownDocuments(app, folder)));
	}

	return documents;
}

/** Reads a folder's Markdown notes recursively, in stable path order. */
export async function readFolderMarkdownDocuments(app: App, folder: TFolder): Promise<MarkdownDocument[]> {
	const files = collectMarkdownFiles(folder);
	files.sort((left, right) => left.path.localeCompare(right.path));
	return Promise.all(files.map((file) => readMarkdownDocument(app, file)));
}

/** Collects `.md` files recursively (depth-first, vault order). */
export function collectMarkdownFiles(folder: TFolder): TFile[] {
	const files: TFile[] = [];
	for (const child of folder.children) {
		if (child instanceof TFile && child.extension === 'md') {
			files.push(child);
			continue;
		}

		if (child instanceof TFolder) {
			files.push(...collectMarkdownFiles(child));
		}
	}
	return files;
}

/**
 * Reads one note into a {@link MarkdownDocument}. Frontmatter is parsed with
 * the structure-preserving parser (not Obsidian's cache) so opaque values
 * like DiagID keep their exact text.
 */
export async function readMarkdownDocument(app: App, file: TFile): Promise<MarkdownDocument> {
	const content = await app.vault.read(file);
	const { frontmatter, body } = splitFrontmatter(content);
	const parsedFrontmatter = parseStructuredFrontmatter(frontmatter);
	const trimmedBody = body.trim();
	return {
		file,
		frontmatter: parsedFrontmatter,
		body: trimmedBody,
	};
}

/**
 * Resolves the selection to its `Journal/<QuestId>` folder: the folder
 * itself when directly under `Journal/`, or the nearest such ancestor.
 * Returns `null` for selections outside the Journal tree.
 */
export function resolveJournalQuestFolder(folder: TFolder, projectRoot: TFolder): TFolder | null {
	if (folder.parent?.path === normalizePath(`${projectRoot.path}/${JOURNAL_FOLDER_NAME}`)) {
		return folder;
	}

	let current: TFolder | null = folder;
	while (current !== null && current.path.startsWith(`${projectRoot.path}/${JOURNAL_FOLDER_NAME}/`)) {
		if (current.parent?.path === normalizePath(`${projectRoot.path}/${JOURNAL_FOLDER_NAME}`)) {
			return current;
		}
		current = current.parent;
	}

	return null;
}

/** Subfolders of `root/childFolderName` (e.g. every quest under Journal/). */
export function getImmediateChildFolders(root: TFolder, childFolderName: string): TFolder[] {
	const target = root.children.find(
		(child): child is TFolder => child instanceof TFolder && child.name === childFolderName,
	);
	if (!target) {
		return [];
	}

	return target.children.filter((child): child is TFolder => child instanceof TFolder);
}

/**
 * The quest's display title: the first line of the quest-name journal entry
 * (`Quest Name: true`), with wikilink syntax and block IDs stripped.
 */
export function extractQuestTitle(documents: MarkdownDocument[]): string | null {
	const questNameDocument = documents.find((document) => isQuestNameNote(document));
	if (!questNameDocument) {
		return null;
	}

	const firstLine = firstNonEmptyLine(questNameDocument.body);
	if (!firstLine) {
		return null;
	}

	return stripWikilinkSyntax(stripBlockId(firstLine));
}

/** Whether a journal entry is the quest-name record (`Quest Name: true`). */
export function isQuestNameNote(document: MarkdownDocument): boolean {
	return (
		getStringValue(document.frontmatter, 'Type') === 'Journal'
			&& getStringValue(document.frontmatter, QUEST_NAME_FIELD)?.toLowerCase() === 'true'
	);
}

/**
 * Converts a journal entry into a {@link JournalMilestone}. Returns `null`
 * for non-journal notes and entries without a numeric `Index` (such as the
 * quest-name record).
 */
export function toJournalMilestone(document: MarkdownDocument): JournalMilestone | null {
	if (getStringValue(document.frontmatter, 'Type') !== 'Journal') {
		return null;
	}

	const questId = getStringValue(document.frontmatter, 'Topic');
	const indexValue = getStringValue(document.frontmatter, 'Index');
	if (!questId || !indexValue) {
		return null;
	}

	const index = Number.parseInt(indexValue, 10);
	if (!Number.isFinite(index)) {
		return null;
	}

	return {
		id: createNodeId(`milestone:${document.file.path}`),
		questId,
		questTitle: extractQuestTitle([document]) ?? questId,
		index,
		finished: getBooleanValue(document.frontmatter, 'Finished'),
		file: document.file,
		summary: firstSentence(document.body),
	};
}

/**
 * Analyzes one dialogue note into a {@link DialogueRecord}: parses its
 * conditions and result script, derives quest references from both, decides
 * direct relevance, and assigns the initial phase anchor. Returns `null` for
 * notes that are not canvas-relevant dialogue types.
 */
export function toDialogueRecord(
	document: MarkdownDocument,
	questIds: string[],
	phaseIndices: number[],
): DialogueRecord | null {
	const type = getStringValue(document.frontmatter, 'Type');
	const topic = getStringValue(document.frontmatter, 'Topic');
	if (!type || !topic || !isDialogueType(type)) {
		return null;
	}

	const conditionEntries = parseConditions(document.frontmatter, questIds);
	const resultActions = parseResultActions(getResultValue(document.frontmatter) ?? '', questIds);
	const bodyText = document.body.trim();
	const conditionQuestReferences = uniqueValues(
		conditionEntries
			.filter((condition) => condition.kind === 'journal' && condition.questId)
			.map((condition) => condition.questId as string),
	);
	const resultQuestReferences = uniqueValues(
		resultActions
			.filter((action) => action.kind === 'journal-set' && action.targetQuestId)
			.map((action) => action.targetQuestId as string),
	);
	const ownedQuestReferences = resultQuestReferences.length > 0 ? resultQuestReferences : conditionQuestReferences;
	const directRelevance = ownedQuestReferences.some((questId) => questIds.includes(questId));
	const phaseAnchor = determinePhaseAnchor(conditionEntries, resultActions, phaseIndices, questIds);

	return {
		id: createNodeId(`record:${document.file.path}`),
		type,
		topic,
		file: document.file,
		diagId: getStringValue(document.frontmatter, 'DiagID') ?? '',
		prevId: getStringValue(document.frontmatter, 'PrevID') ?? '',
		bodyText,
		conditions: conditionEntries,
		speakerConditions: conditionEntries.filter((condition) => condition.kind === 'speaker'),
		nonSpeakerConditions: conditionEntries.filter((condition) => condition.kind !== 'speaker'),
		resultActions,
		resultLines: resultActions.map((action) => action.displayText),
		phaseAnchor,
		sourcePhaseAnchor: phaseAnchor,
		directlyRelevant: directRelevance,
		conditionQuestReferences,
		resultQuestReferences,
		ownedQuestReferences,
		questReferences: uniqueValues([...conditionQuestReferences, ...resultQuestReferences]),
		infoOrder: Number.MAX_SAFE_INTEGER,
		primaryChoiceValue: firstChoiceValue(conditionEntries),
		choiceValues: conditionEntries
			.filter((condition) => condition.kind === 'choice' && condition.choiceValue !== undefined)
			.map((condition) => condition.choiceValue as number),
		choiceTargets: resultActions
			.filter((action) => action.kind === 'choice-set' && action.choiceValue !== undefined)
			.map((action) => action.choiceValue as number),
	};
}

/**
 * Expands the directly relevant record set to a fixed point: a record joins
 * when a relevant record reaches it (via choice targets or AddTopic results)
 * or when it leads into an already-relevant record. Records whose only
 * journal effects belong to *other* quests are excluded so shared topics
 * don't drag foreign quest lines onto the canvas.
 */
export function resolvePropagatedRelevantRecords(
	allRecords: DialogueRecord[],
	directRelevant: Set<string>,
	questIds: string[],
): Set<string> {
	const relevant = new Set<string>(directRelevant);
	const recordsByTopic = groupRecordsByTopic(allRecords);
	const recordsByNormalizedTopic = groupRecordsByNormalizedTopic(allRecords);

	let changed = true;
	while (changed) {
		changed = false;

		for (const record of allRecords) {
			if (
				record.choiceTargets.length === 0
				&& !record.resultActions.some((action) => action.kind === 'add-topic')
			) {
				continue;
			}
			if (hasOnlyJournalResultsForOtherQuests(record, questIds)) {
				continue;
			}

			const topicRecords = recordsByTopic.get(record.topic) ?? [];
			if (relevant.has(record.id)) {
				for (const candidate of resolveChoiceTargetRecords(record, topicRecords)) {
					if (hasOnlyJournalResultsForOtherQuests(candidate, questIds) || relevant.has(candidate.id)) {
						continue;
					}

					relevant.add(candidate.id);
					changed = true;
				}
				for (const candidate of resolveAddTopicTargetRecords(record, recordsByNormalizedTopic, questIds)) {
					if (hasOnlyJournalResultsForOtherQuests(candidate, questIds) || relevant.has(candidate.id)) {
						continue;
					}

					relevant.add(candidate.id);
					changed = true;
				}
				continue;
			}

			if (recordLeadsToRelevantRecord(record, topicRecords, recordsByNormalizedTopic, relevant, questIds)) {
				relevant.add(record.id);
				changed = true;
			}
		}
	}

	return relevant;
}

/** Whether any of the record's choice/AddTopic targets is already relevant. */
export function recordLeadsToRelevantRecord(
	record: DialogueRecord,
	topicRecords: DialogueRecord[],
	recordsByNormalizedTopic: Map<string, DialogueRecord[]>,
	relevant: Set<string>,
	questIds: string[],
): boolean {
	return resolveChoiceTargetRecords(record, topicRecords).some((candidate) => relevant.has(candidate.id))
		|| resolveAddTopicTargetRecords(record, recordsByNormalizedTopic, questIds).some((candidate) => relevant.has(candidate.id));
}

/**
 * Records in the same topic that a `Choice n` result of `sourceRecord` can
 * flow to: they must be gated on that choice value and have conditions
 * compatible with the source's (see `conditionsCanFollowChoice`).
 */
export function resolveChoiceTargetRecords(
	sourceRecord: DialogueRecord,
	topicRecords: DialogueRecord[],
): DialogueRecord[] {
	const targetRecords: DialogueRecord[] = [];
	for (const candidate of topicRecords) {
		if (candidate.id === sourceRecord.id) {
			continue;
		}

		if (
			sourceRecord.choiceTargets.some((value) => (
				candidate.choiceValues.includes(value)
					&& conditionsCanFollowChoice(sourceRecord, candidate, value)
			))
		) {
			targetRecords.push(candidate);
		}
	}

	return targetRecords;
}

/** Distinct records that the source's `AddTopic` results can lead into. */
export function resolveAddTopicTargetRecords(
	sourceRecord: DialogueRecord,
	recordsByNormalizedTopic: Map<string, DialogueRecord[]>,
	questIds: string[],
): DialogueRecord[] {
	const targetRecords: DialogueRecord[] = [];
	for (const action of sourceRecord.resultActions) {
		if (action.kind !== 'add-topic' || !action.targetTopic) {
			continue;
		}

		const resolvedTargets = resolveAddTopicTransitionTargets(sourceRecord, action.targetTopic, recordsByNormalizedTopic, questIds);
		for (const targetRecord of resolvedTargets) {
			if (!targetRecords.some((candidate) => candidate.id === targetRecord.id)) {
				targetRecords.push(targetRecord);
			}
		}
	}
	return targetRecords;
}

/**
 * Computes which quest(s) each record effectively serves, propagating
 * ownership *up* choice chains: a choice prompt with no quest references of
 * its own inherits them from the records its choices lead to. Result-based
 * ownership wins over condition-based ownership when both exist.
 */
export function resolveEffectiveQuestOwnership(allRecords: DialogueRecord[]): Map<string, string[]> {
	const ancestorsByRecordId = buildAncestorRecordMap(allRecords);
	const resultOwnership = new Map<string, Set<string>>();
	const conditionOwnership = new Map<string, Set<string>>();

	for (const record of allRecords) {
		resultOwnership.set(record.id, new Set(record.resultQuestReferences));
		conditionOwnership.set(record.id, new Set(record.conditionQuestReferences));
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (const record of allRecords) {
			const ancestorIds = ancestorsByRecordId.get(record.id) ?? [];
			const descendantResultOwnership = resultOwnership.get(record.id) ?? new Set<string>();
			const descendantConditionOwnership = conditionOwnership.get(record.id) ?? new Set<string>();
			for (const ancestorId of ancestorIds) {
				const ancestorResultOwnership = resultOwnership.get(ancestorId) ?? new Set<string>();
				const ancestorConditionOwnership = conditionOwnership.get(ancestorId) ?? new Set<string>();
				if (mergeQuestReferences(ancestorResultOwnership, descendantResultOwnership)) {
					resultOwnership.set(ancestorId, ancestorResultOwnership);
					changed = true;
				}
				if (mergeQuestReferences(ancestorConditionOwnership, descendantConditionOwnership)) {
					conditionOwnership.set(ancestorId, ancestorConditionOwnership);
					changed = true;
				}
			}
		}
	}

	const effectiveOwnership = new Map<string, string[]>();
	for (const record of allRecords) {
		const recordResultOwnership = [...(resultOwnership.get(record.id) ?? new Set<string>())];
		const recordConditionOwnership = [...(conditionOwnership.get(record.id) ?? new Set<string>())];
		effectiveOwnership.set(
			record.id,
			recordResultOwnership.length > 0 ? uniqueValues(recordResultOwnership) : uniqueValues(recordConditionOwnership),
		);
	}

	return effectiveOwnership;
}

/**
 * Maps each record ID to the records whose choices can lead to it (its
 * "ancestors" in the same topic's choice graph).
 */
export function buildAncestorRecordMap(allRecords: DialogueRecord[]): Map<string, string[]> {
	const ancestorsByRecordId = new Map<string, Set<string>>();
	const recordsByTopic = groupRecordsByTopic(allRecords);

	for (const record of allRecords) {
		ancestorsByRecordId.set(record.id, new Set<string>());
	}

	for (const record of allRecords) {
		const recordAncestors = ancestorsByRecordId.get(record.id);
		if (!recordAncestors) {
			continue;
		}

		const topicRecords = recordsByTopic.get(record.topic) ?? [];
		for (const candidate of topicRecords) {
			if (candidate.id === record.id || candidate.choiceTargets.length === 0) {
				continue;
			}

			if (
				candidate.choiceTargets.some((value) => (
					record.choiceValues.includes(value)
						&& conditionsCanFollowChoice(candidate, record, value)
				))
			) {
				recordAncestors.add(candidate.id);
			}
		}
	}

	return new Map(
		[...ancestorsByRecordId.entries()].map(([recordId, ancestorIds]) => [recordId, [...ancestorIds]]),
	);
}

/** Adds `source`'s quest IDs to `target`; returns whether anything changed. */
export function mergeQuestReferences(target: Set<string>, source: Set<string>): boolean {
	let changed = false;
	for (const questId of source) {
		if (target.has(questId)) {
			continue;
		}

		target.add(questId);
		changed = true;
	}
	return changed;
}

/**
 * Whether every journal update the record makes targets a *different* quest —
 * the signal that it belongs to another quest line and should not be pulled
 * onto this canvas by relevance propagation.
 */
export function hasOnlyJournalResultsForOtherQuests(record: DialogueRecord, questIds: string[]): boolean {
	const journalResults = record.resultActions.filter(
		(action) => action.kind === 'journal-set' && Boolean(action.targetQuestId),
	);
	return journalResults.length > 0
		&& journalResults.every((action) => !questIds.includes(action.targetQuestId as string));
}

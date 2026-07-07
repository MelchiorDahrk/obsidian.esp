/**
 * @file Quest canvas generation: the top-level orchestrator.
 *
 * {@link buildQuestCanvas} runs the whole pipeline for one quest — discover
 * scope, read and analyze dialogue, resolve relevance and phase anchors,
 * group families, lay out each phase, wire cross-topic transitions, then run
 * the global layered layout. The `generate*` wrappers add UI (folder pick,
 * progress bar, notices), batch generation over all quests, and refresh-mode
 * merging that preserves manual layout (see refresh.ts / sync-core.ts).
 *
 * The pipeline stages live in sibling modules: discovery.ts, families.ts,
 * layout.ts, transitions.ts, emit.ts — see each for detail.
 */
import { App, normalizePath, Notice, TFile, TFolder } from 'obsidian';
import { selectVaultFolder } from '../../ui/folder-suggest-modal';
import { ProgressBar } from '../../ui/progress-bar';
import { PathManager } from '../path-manager';
import {
	discoverQuestScope,
	hasOnlyJournalResultsForOtherQuests,
	readDialogueDocuments,
	resolveEffectiveQuestOwnership,
	resolvePropagatedRelevantRecords,
	toDialogueRecord,
} from './discovery';
import {
	addPhaseMilestone,
	centerPhaseMilestone,
	contextPhaseNodeId,
	createCanvasLayoutContext,
	writeCanvasBacklinks,
	writeCanvasPlan,
} from './emit';
import {
	assignDialogueInfoOrder,
	buildPhaseGraph,
	determinePhaseAnchor,
	groupBranchFamilies,
	resolveChoiceDerivedPhaseAnchors,
	stripUnrelatedAddTopicChoices,
} from './families';
import { applyLayeredCanvasLayout, computePhasePositions, layoutTopicFamilies, normalizeCanvasOrigin } from './layout';
import { mergeCanvasPreservingLayout } from './refresh';
import { parseCanvasData } from './sync-core';
import {
	type CanvasBuildResult,
	type DialogueRecord,
	GATE_GAP_X,
	JOURNAL_FOLDER_NAME,
	type JournalMilestone,
	type PendingPhaseEntryEdge,
	type QuestCanvasGenerationResult,
	type QuestScope,
	TOPIC_SEGMENT_GAP_X,
} from './model';
import {
	connectAddTopicTransitions,
	connectAdjacentJournalPhaseTerminalTransitions,
	connectBodyTopicLinkTransitions,
	connectChoiceTransitions,
	connectJournalConditionMilestones,
	connectPendingPhaseEntryEdges,
	connectScriptedMilestones,
	entryCanFollowPhaseMilestone,
	routeJournalRangeChoiceTransitions,
} from './transitions';
import { uniqueNumbers } from './utils';

/** Options controlling the only note write generation can perform. */
export interface QuestCanvasWriteOptions {
	/** When true, add a `canvas:` backlink to each related note (off by default). */
	writeBacklinks?: boolean;
	/**
	 * 'refresh' (default) rebuilds cards and wiring from the notes but keeps
	 * the manual layout of provenance-matched nodes; 'full' relays out the
	 * whole canvas from scratch.
	 */
	mode?: 'refresh' | 'full';
}

/** Command entry point: prompts for a folder, then generates its canvas. */
export async function generateQuestCanvasFromVaultFolder(
	app: App,
	options: QuestCanvasWriteOptions = {},
): Promise<void> {
	const folder = await selectVaultFolder(app);
	if (!folder) {
		return;
	}

	await generateQuestCanvasForFolder(app, folder, options);
}

/** Whether the folder is a `Journal/<QuestId>` folder (gates the menu item). */
export function canGenerateQuestCanvasFromFolder(folder: TFolder): boolean {
	return folder.parent?.name === JOURNAL_FOLDER_NAME;
}

/** Whether the folder is the project's top-level `Journal` folder. */
export function canGenerateAllQuestCanvasesFromFolder(folder: TFolder): boolean {
	const projectRoot = PathManager.findPluginRoot(folder);
	if (!projectRoot) {
		return false;
	}
	return folder.path === normalizePath(`${projectRoot.path}/${JOURNAL_FOLDER_NAME}`);
}

/** Generates one quest canvas with a progress bar and success/error notices. */
export async function generateQuestCanvasForFolder(
	app: App,
	folder: TFolder,
	options: QuestCanvasWriteOptions = {},
): Promise<void> {
	const progress = new ProgressBar('Generating quest canvas');
	try {
		const result = await generateQuestCanvasForFolderWithProgress(
			app,
			folder,
			(percent, message) => progress.update(percent, message),
			options,
		);
		const warningSuffix = result.warnings.length > 0 ? ` ${result.warnings[0]}` : '';
		new Notice(`Generated ${result.questTitle}.canvas.${warningSuffix}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Failed to generate quest canvas: ${message}`, 10000);
	} finally {
		progress.update(100, 'Done');
		try {
			progress.hide();
		} catch {
			// Best-effort UI cleanup.
		}
	}
}

/**
 * Generates a canvas for every quest folder under `Journal/`. Linked
 * multi-topic quests share one canvas, so folders resolving to an
 * already-generated output are skipped; per-quest failures are collected and
 * reported without aborting the batch.
 */
export async function generateAllQuestCanvasesForJournalFolder(
	app: App,
	folder: TFolder,
	options: QuestCanvasWriteOptions = {},
): Promise<void> {
	const progress = new ProgressBar('Generating all quest canvases');
	try {
		progress.update(1, 'Checking the Journal folder');
		if (!canGenerateAllQuestCanvasesFromFolder(folder)) {
			throw new Error('Select the project Journal folder.');
		}

		const questFolders = folder.children
			.filter((child): child is TFolder => child instanceof TFolder)
			.sort((left, right) => left.path.localeCompare(right.path));
		if (questFolders.length === 0) {
			throw new Error('No quest folders were found in Journal.');
		}

		const generatedCanvasPaths = new Set<string>();
		const failures: string[] = [];
		const warnings: string[] = [];
		let generatedCount = 0;
		let skippedCount = 0;

		for (let index = 0; index < questFolders.length; index += 1) {
			const questFolder = questFolders[index];
			if (!questFolder) {
				continue;
			}
			const prefix = `${index + 1}/${questFolders.length}`;
			try {
				progress.update(batchProgress(index, questFolders.length, 5), `${prefix}: Checking ${questFolder.name}`);
				const scope = await discoverQuestScope(app, questFolder);
				if (generatedCanvasPaths.has(scope.outputCanvasPath)) {
					skippedCount += 1;
					progress.update(batchProgress(index + 1, questFolders.length, 0), `${prefix}: Skipped linked quest folder`);
					continue;
				}

				const result = await generateQuestCanvasForScope(
					app,
					scope,
					(percent, message) => {
						progress.update(batchProgress(index, questFolders.length, percent), `${prefix}: ${message}`);
					},
					options,
				);
				generatedCanvasPaths.add(result.outputCanvasPath);
				generatedCount += 1;
				if (result.warnings.length > 0) {
					warnings.push(`${result.questTitle}: ${result.warnings[0]}`);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				failures.push(`${questFolder.name}: ${message}`);
			}
		}

		const skippedSuffix = skippedCount > 0 ? `, skipped ${skippedCount} linked folder${skippedCount === 1 ? '' : 's'}` : '';
		const failedSuffix = failures.length > 0 ? `, ${failures.length} failed` : '';
		new Notice(`Generated ${generatedCount} quest canvas${generatedCount === 1 ? '' : 'es'}${skippedSuffix}${failedSuffix}.`);

		const details = [...failures, ...warnings].slice(0, 5);
		if (details.length > 0) {
			new Notice(details.join('\n'), 10000);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Failed to generate quest canvases: ${message}`, 10000);
	} finally {
		progress.update(100, 'Done');
		try {
			progress.hide();
		} catch {
			// Best-effort UI cleanup.
		}
	}
}

/** Discovers scope for a folder and generates its canvas, reporting progress. */
export async function generateQuestCanvasForFolderWithProgress(
	app: App,
	folder: TFolder,
	updateProgress: (percent: number, message: string) => void,
	options: QuestCanvasWriteOptions = {},
): Promise<QuestCanvasGenerationResult> {
	updateProgress(5, 'Checking the selected folder');
	const scope = await discoverQuestScope(app, folder);
	return generateQuestCanvasForScope(app, scope, updateProgress, options);
}

/**
 * Builds the canvas for an already-discovered scope and writes it. In refresh
 * mode an existing canvas is merged so manual node moves survive
 * ({@link mergeCanvasPreservingLayout}); in full mode it is overwritten.
 * Optionally writes `canvas:` backlinks into the related notes.
 */
export async function generateQuestCanvasForScope(
	app: App,
	scope: QuestScope,
	updateProgress: (percent: number, message: string) => void,
	options: QuestCanvasWriteOptions = {},
): Promise<QuestCanvasGenerationResult> {
	updateProgress(25, `Resolving dialogue for ${scope.questTitle}`);
	const buildResult = await buildQuestCanvas(app, scope);
	updateProgress(80, 'Writing canvas');

	const existingFile = app.vault.getAbstractFileByPath(scope.outputCanvasPath);
	let merged = false;
	if ((options.mode ?? 'refresh') === 'refresh' && existingFile instanceof TFile) {
		const existing = parseCanvasData(await app.vault.read(existingFile));
		if (existing) {
			const mergeResult = mergeCanvasPreservingLayout(existing, buildResult);
			await app.vault.process(existingFile, () => JSON.stringify(mergeResult.merged, null, '\t'));
			merged = true;
		}
	}
	if (!merged) {
		await writeCanvasPlan(app, scope.outputCanvasPath, buildResult.nodes, buildResult.edges);
	}

	if (options.writeBacklinks) {
		updateProgress(90, 'Writing backlinks');
		await writeCanvasBacklinks(app, buildResult.relatedFiles, scope.outputCanvasPath);
	}

	return {
		questTitle: scope.questTitle,
		outputCanvasPath: scope.outputCanvasPath,
		warnings: buildResult.warnings,
	};
}

/** Maps a per-folder percentage onto the overall batch progress bar. */
export function batchProgress(folderIndex: number, folderCount: number, folderPercent: number): number {
	return ((folderIndex + folderPercent / 100) / folderCount) * 100;
}

/**
 * The full generation pipeline for one quest, producing the canvas nodes and
 * edges without writing anything. In order: read dialogue notes and analyze
 * each into a record; resolve which records are quest-relevant (transitively,
 * through choices and AddTopic); assign phase anchors and info order; group
 * into families; place one journal node per phase; lay out each phase's
 * topics; wire every cross-topic transition; then run the global layered
 * layout and normalize the origin. Also collects unreachable-choice warnings.
 */
export async function buildQuestCanvas(app: App, scope: QuestScope): Promise<CanvasBuildResult> {
	const dialogueDocuments = await readDialogueDocuments(app, scope.projectRoot);
	const allRecords = dialogueDocuments
		.map((document) => toDialogueRecord(document, scope.questIds, scope.journalMilestones.map((milestone) => milestone.index)))
		.filter((record): record is DialogueRecord => record !== null);

	const effectiveOwnership = resolveEffectiveQuestOwnership(allRecords);
	const directRelevant = new Set(
		allRecords
			.filter((record) => (effectiveOwnership.get(record.id) ?? []).some((questId) => scope.questIds.includes(questId)))
			.map((record) => record.id),
	);
	const relevantRecordIds = resolvePropagatedRelevantRecords(allRecords, directRelevant, scope.questIds);
	const relevantRecords = allRecords.filter(
		(record) => relevantRecordIds.has(record.id)
			&& !hasOnlyJournalResultsForOtherQuests(record, scope.questIds),
	);

	if (relevantRecords.length === 0) {
		throw new Error('No quest-relevant dialogue notes were found for the selected journal folder.');
	}

	const milestoneIndices = uniqueNumbers(scope.journalMilestones.map((milestone) => milestone.index).filter((index) => index > 0));
	const phaseIndices = milestoneIndices.length > 0 ? milestoneIndices : uniqueNumbers(scope.journalMilestones.map((milestone) => milestone.index));
	const scopedRelevantRecords = relevantRecords.map((record) => {
		const phaseAnchor = determinePhaseAnchor(record.conditions, record.resultActions, phaseIndices, scope.questIds);
		return {
			...record,
			phaseAnchor,
			sourcePhaseAnchor: phaseAnchor,
		};
	});
	const orderedRelevantRecords = assignDialogueInfoOrder(scopedRelevantRecords);
	const phaseAnchoredRecords = resolveChoiceDerivedPhaseAnchors(orderedRelevantRecords);
	const canvasRecords = stripUnrelatedAddTopicChoices(phaseAnchoredRecords);
	const families = groupBranchFamilies(canvasRecords, scope.questIds);
	const warnings = collectMissingChoiceTargetWarnings(canvasRecords);
	const canvasContext = createCanvasLayoutContext();
	for (const document of scope.journalDocuments) {
		canvasContext.fileBodyTextByPath.set(document.file.path, document.body);
	}
	for (const document of dialogueDocuments) {
		canvasContext.fileBodyTextByPath.set(document.file.path, document.body);
	}
	const phaseGraph = buildPhaseGraph(phaseIndices, families);
	const phaseXPositions = new Map<number, number>();
	const pendingPhaseEntryEdges: PendingPhaseEntryEdge[] = [];

	const milestonesByPhase = new Map<number, JournalMilestone[]>();
	for (const milestone of scope.journalMilestones) {
		if (milestone.index <= 0) {
			continue;
		}
		const phaseMilestones = milestonesByPhase.get(milestone.index) ?? [];
		phaseMilestones.push(milestone);
		milestonesByPhase.set(milestone.index, phaseMilestones);
	}

	const computedPhasePositions = computePhasePositions(phaseGraph.orderedPhases, phaseGraph.segmentsByPhase);
	for (const [phaseValue, phaseX] of computedPhasePositions) {
		phaseXPositions.set(phaseValue, phaseX);
		const phaseMilestones = milestonesByPhase.get(phaseValue) ?? [];
		const phaseMilestone = phaseMilestones[0];
		if (!phaseMilestone) {
			continue;
		}
		addPhaseMilestone(canvasContext, phaseValue, phaseMilestone, phaseX);
	}

	for (let phaseIndex = 0; phaseIndex < phaseGraph.orderedPhases.length; phaseIndex += 1) {
		const phaseValue = phaseGraph.orderedPhases[phaseIndex] ?? 0;
		const phaseX = phaseXPositions.get(phaseValue) ?? 0;
		const phaseMilestones = milestonesByPhase.get(phaseValue) ?? [];
		const phaseMilestone = phaseMilestones[0];
		const milestoneNodeId = phaseMilestone
			? contextPhaseNodeId(canvasContext, phaseValue)
			: undefined;
		const phaseSegments = phaseGraph.segmentsByPhase.get(phaseValue) ?? [];
		let topicSegmentIndex = 0;
		const phaseCenters: number[] = [];
		for (const segment of phaseSegments) {
			const topicBaseX = phaseX + GATE_GAP_X + topicSegmentIndex * TOPIC_SEGMENT_GAP_X;
			const topicLayout = layoutTopicFamilies(
				canvasContext,
				segment.families,
				phaseValue,
				topicBaseX,
				scope.journalMilestones,
			);
			if (milestoneNodeId) {
				for (const entryId of topicLayout.rootEntryIds) {
					if (!entryCanFollowPhaseMilestone(entryId, segment.families, canvasContext, phaseValue, scope.questIds)) {
						continue;
					}

					pendingPhaseEntryEdges.push({
						phaseNodeId: milestoneNodeId,
						phaseValue,
						entryId,
						families: segment.families,
					});
				}
			}
			if (Number.isFinite(topicLayout.topY) && Number.isFinite(topicLayout.bottomY)) {
				phaseCenters.push(topicLayout.mainLaneCenterY);
			}

			topicSegmentIndex += 1;
		}
		const phaseCenterY = phaseCenters.length > 0
			? Math.round(phaseCenters.reduce((sum, value) => sum + value, 0) / phaseCenters.length)
			: 0;
		if (milestoneNodeId) {
			centerPhaseMilestone(canvasContext, phaseValue, phaseCenterY);
		}
	}

	connectChoiceTransitions(canvasContext, canvasRecords);
	routeJournalRangeChoiceTransitions(canvasContext, canvasRecords);
	connectAddTopicTransitions(canvasContext, canvasRecords, scope.questIds);
	connectBodyTopicLinkTransitions(canvasContext, canvasRecords);
	connectPendingPhaseEntryEdges(canvasContext, pendingPhaseEntryEdges);
	connectJournalConditionMilestones(canvasContext, canvasRecords, scope.journalMilestones, scope.questIds);
	connectAdjacentJournalPhaseTerminalTransitions(canvasContext, canvasRecords, phaseIndices, scope.questIds);
	connectScriptedMilestones(canvasContext, phaseGraph.orderedPhases);
	applyLayeredCanvasLayout(canvasContext);
	normalizeCanvasOrigin(canvasContext);

	const relatedFiles = new Map<string, TFile>();
	for (const milestone of scope.journalDocuments) {
		relatedFiles.set(milestone.file.path, milestone.file);
	}
	for (const record of canvasRecords) {
		relatedFiles.set(record.file.path, record.file);
	}

	return {
		nodes: canvasContext.nodes,
		edges: canvasContext.edges,
		relatedFiles: [...relatedFiles.values()].sort((left, right) => left.path.localeCompare(right.path)),
		warnings,
	};
}

/**
 * Flags `Choice "…" N` results whose value no record on the same topic
 * filters on, since that branch can never be reached in game.
 */
function collectMissingChoiceTargetWarnings(records: DialogueRecord[]): string[] {
	const warnings: string[] = [];
	const recordsByTopic = new Map<string, DialogueRecord[]>();
	for (const record of records) {
		const topicRecords = recordsByTopic.get(record.topic) ?? [];
		topicRecords.push(record);
		recordsByTopic.set(record.topic, topicRecords);
	}

	for (const record of records) {
		if (record.suppressChoiceTransitions) {
			continue;
		}

		const topicRecords = recordsByTopic.get(record.topic) ?? [];
		for (const choiceValue of uniqueNumbers(record.choiceTargets)) {
			const hasTarget = topicRecords.some(
				(candidate) => candidate.id !== record.id && candidate.choiceValues.includes(choiceValue),
			);
			if (!hasTarget) {
				warnings.push(`${record.file.basename}: Choice ${choiceValue} has no matching branch.`);
			}
		}
	}

	return warnings;
}

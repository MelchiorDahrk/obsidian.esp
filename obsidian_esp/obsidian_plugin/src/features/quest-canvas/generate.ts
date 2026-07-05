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
	updateCanvasLinksAndBodyBlocks,
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
import {
	type CanvasBuildResult,
	type DialogueRecord,
	type FileNodeTarget,
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

export async function generateQuestCanvasFromVaultFolder(app: App): Promise<void> {
	const folder = await selectVaultFolder(app);
	if (!folder) {
		return;
	}

	await generateQuestCanvasForFolder(app, folder);
}

export function canGenerateQuestCanvasFromFolder(folder: TFolder): boolean {
	return folder.parent?.name === JOURNAL_FOLDER_NAME;
}

export function canGenerateAllQuestCanvasesFromFolder(folder: TFolder): boolean {
	const projectRoot = PathManager.findPluginRoot(folder);
	if (!projectRoot) {
		return false;
	}
	return folder.path === normalizePath(`${projectRoot.path}/${JOURNAL_FOLDER_NAME}`);
}

export async function generateQuestCanvasForFolder(
	app: App,
	folder: TFolder,
): Promise<void> {
	const progress = new ProgressBar('Generating quest canvas');
	try {
		const result = await generateQuestCanvasForFolderWithProgress(
			app,
			folder,
			(percent, message) => progress.update(percent, message),
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

export async function generateAllQuestCanvasesForJournalFolder(
	app: App,
	folder: TFolder,
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
			const questFolder = questFolders[index] as TFolder;
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

export async function generateQuestCanvasForFolderWithProgress(
	app: App,
	folder: TFolder,
	updateProgress: (percent: number, message: string) => void,
): Promise<QuestCanvasGenerationResult> {
	updateProgress(5, 'Checking the selected folder');
	const scope = await discoverQuestScope(app, folder);
	return generateQuestCanvasForScope(app, scope, updateProgress);
}

export async function generateQuestCanvasForScope(
	app: App,
	scope: QuestScope,
	updateProgress: (percent: number, message: string) => void,
): Promise<QuestCanvasGenerationResult> {
	updateProgress(25, `Resolving dialogue for ${scope.questTitle}`);
	const buildResult = await buildQuestCanvas(app, scope);
	updateProgress(80, 'Writing canvas and backlinks');
	await writeCanvasPlan(app, scope.outputCanvasPath, buildResult.nodes, buildResult.edges);
	await updateCanvasLinksAndBodyBlocks(
		app,
		buildResult.relatedFiles,
		buildResult.fileNodeTargets,
		scope.outputCanvasPath,
	);

	return {
		questTitle: scope.questTitle,
		outputCanvasPath: scope.outputCanvasPath,
		warnings: buildResult.warnings,
	};
}

export function batchProgress(folderIndex: number, folderCount: number, folderPercent: number): number {
	return ((folderIndex + folderPercent / 100) / folderCount) * 100;
}

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
	const warnings: string[] = [];
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
	const fileNodeTargets = new Map<string, FileNodeTarget>();
	for (const milestone of scope.journalDocuments) {
		relatedFiles.set(milestone.file.path, milestone.file);
	}
	for (const record of canvasRecords) {
		relatedFiles.set(record.file.path, record.file);
	}
	for (const milestone of scope.journalMilestones) {
		if (!milestone.canvasSubpath) {
			continue;
		}

		fileNodeTargets.set(milestone.file.path, {
			file: milestone.file,
			subpath: milestone.canvasSubpath,
		});
	}
	for (const record of canvasRecords) {
		if (!record.canvasSubpath) {
			continue;
		}

		fileNodeTargets.set(record.file.path, {
			file: record.file,
			subpath: record.canvasSubpath,
		});
	}

	return {
		nodes: canvasContext.nodes,
		edges: canvasContext.edges,
		relatedFiles: [...relatedFiles.values()].sort((left, right) => left.path.localeCompare(right.path)),
		fileNodeTargets: [...fileNodeTargets.values()].sort((left, right) => left.file.path.localeCompare(right.file.path)),
		warnings,
	};
}

// Public API of the quest canvas package. The headless harness
// (scripts/canvas-harness) bundles discoverQuestScope/buildQuestCanvas from
// here, so keep their signatures stable.
export {
	buildQuestCanvas,
	canGenerateAllQuestCanvasesFromFolder,
	canGenerateQuestCanvasFromFolder,
	generateAllQuestCanvasesForJournalFolder,
	generateQuestCanvasForFolder,
	generateQuestCanvasFromVaultFolder,
} from './generate';
export { discoverQuestScope } from './discovery';
export type {
	CanvasBuildResult,
	CanvasEdge,
	CanvasNode,
	Condition,
	DialogueRecord,
	JournalMilestone,
	QuestScope,
	ResultAction,
} from './model';

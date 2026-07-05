// Headless tests for the generative canvas actions (quest-canvas/actions.ts):
// authoring a full new quest branch (choice + gated response + journal
// advance) from canvas state alone, without regeneration.
import assert from 'node:assert/strict';
import {
	applyActionPlanToCanvas,
	pickFreeNotePath,
	planAddChoiceBranch,
	planAddSpeakerVariant,
	planLinkJournalMilestone,
	planRenumberChoice,
} from '../../obsidian_plugin/src/features/quest-canvas/actions.ts';
import {
	parseConditions,
	parseResultActions,
} from '../../obsidian_plugin/src/features/quest-canvas/cards.ts';
import { deriveQuestContext } from '../../obsidian_plugin/src/features/quest-canvas/sync-core.ts';
import { parseStructuredFrontmatter } from '../../obsidian_plugin/src/features/quest-canvas/frontmatter-surgeon.ts';

let testCount = 0;
function check(name, fn) {
	testCount += 1;
	try {
		fn();
	} catch (error) {
		console.error(`FAIL: ${name}`);
		throw error;
	}
}

const PARENT_PATH = 'TES3 Plugins/Test/Topic/test topic/test topic ~1.md';
const JOURNAL_10_PATH = 'TES3 Plugins/Test/Journal/TestQuest/10.md';
const JOURNAL_20_PATH = 'TES3 Plugins/Test/Journal/TestQuest/20.md';

const PARENT_NOTE = [
	'---',
	'Source:',
	'Type: Topic',
	'Topic: test topic',
	'Disposition: 0',
	'ID: test npc',
	'Result: |',
	'  Choice "First option." 1',
	'  Goodbye',
	'Function0: Journal',
	'Variable0: TestQuest = 10',
	'---',
	'',
	'What do you want to do?',
].join('\n');

const journalNote = (index) => [
	'---',
	'Type: Journal',
	'Topic: TestQuest',
	`Index: ${index}`,
	'---',
	'',
	`Milestone ${index}.`,
].join('\n');

function makeNotes() {
	return new Map([
		[PARENT_PATH, PARENT_NOTE],
		[JOURNAL_10_PATH, journalNote(10)],
		[JOURNAL_20_PATH, journalNote(20)],
	]);
}

const meta = (role, file, extra = {}) => ({ role, file, rev: 1, ...extra });

function makeCanvas() {
	return {
		nodes: [
			{ id: 'j10', type: 'file', file: JOURNAL_10_PATH, x: 0, y: 0, width: 440, height: 100, color: '6', espCard: meta('journal', JOURNAL_10_PATH, { questId: 'TestQuest' }) },
			{ id: 'j20', type: 'file', file: JOURNAL_20_PATH, x: 2600, y: 0, width: 440, height: 100, color: '6', espCard: meta('journal', JOURNAL_20_PATH, { questId: 'TestQuest' }) },
			{ id: 'd1', type: 'file', file: PARENT_PATH, x: 600, y: 200, width: 440, height: 120, color: '3', espCard: meta('dialogue', PARENT_PATH) },
		],
		edges: [],
	};
}

function contextFor(canvas, notes) {
	return deriveQuestContext(canvas, (path) => notes.get(path) ?? null);
}

function frontmatterOf(content) {
	return parseStructuredFrontmatter(content.match(/^---\n[\s\S]*?\n---(?:\n|$)/)?.[0] ?? '');
}

// --- full branch authoring: choice + gated response + journal advance -----------
check('add choice branch, then link a journal milestone on the new response', () => {
	const notes = makeNotes();
	const canvas = makeCanvas();
	const context = contextFor(canvas, notes);

	const plan = planAddChoiceBranch({
		parentNodeId: 'd1',
		parentPath: PARENT_PATH,
		parentContent: notes.get(PARENT_PATH),
		prompt: 'I will take the job.',
		responseText: 'Excellent. Bring me the lantern.',
		canvas,
		context,
		existingNotePaths: new Set(notes.keys()),
	});
	assert.ok(!('error' in plan), JSON.stringify(plan));

	// Parent gains the next free choice value (2).
	const parentUpdated = plan.noteUpdates.get(PARENT_PATH);
	assert.ok(parentUpdated.includes('  Choice "First option." 1'), parentUpdated);
	assert.ok(parentUpdated.includes('  Choice "I will take the job." 2'), parentUpdated);

	// The new response note is gated on Choice 2 plus the inherited journal gate.
	assert.equal(plan.noteCreations.size, 1);
	const [newPath, newContent] = [...plan.noteCreations][0];
	assert.equal(newPath, 'TES3 Plugins/Test/Topic/test topic/test topic ~2.md');
	const newFrontmatter = frontmatterOf(newContent);
	assert.equal(newFrontmatter['Function0'], 'Function');
	assert.equal(newFrontmatter['Variable0'], 'Choice = 2');
	assert.equal(newFrontmatter['Function1'], 'Journal');
	assert.equal(newFrontmatter['Variable1'], 'TestQuest = 10');
	assert.ok(newContent.includes('Excellent. Bring me the lantern.'));

	// The structure is compiler-parseable: conditions and results round-trip.
	const conditions = parseConditions(newFrontmatter, context.questIds);
	assert.ok(conditions.some((c) => c.kind === 'choice' && c.choiceValue === 2));
	assert.ok(conditions.some((c) => c.kind === 'journal' && c.questId === 'TestQuest' && c.value === 10));

	// Canvas insertion: choice card + gate + dialogue node, wired left to right.
	assert.equal(plan.canvasInsertion.nodes.length, 3);
	const [choiceNode, gateNode, dialogueNode] = plan.canvasInsertion.nodes;
	assert.equal(choiceNode.espCard.role, 'choice');
	assert.equal(choiceNode.espCard.choiceValue, 2);
	assert.equal(choiceNode.text, 'I will take the job.');
	assert.equal(gateNode.espCard.role, 'gate');
	assert.equal(gateNode.espCard.file, newPath);
	assert.equal(gateNode.text, 'Choice = 2\nJournal TestQuest = 10');
	assert.equal(dialogueNode.espCard.role, 'dialogue');
	assert.equal(plan.canvasInsertion.edges.length, 3);

	// Apply: notes + canvas, then advance the quest from the new response.
	for (const [path, content] of plan.noteUpdates) notes.set(path, content);
	for (const [path, content] of plan.noteCreations) notes.set(path, content);
	assert.ok(applyActionPlanToCanvas(canvas, plan));

	const linkPlan = planLinkJournalMilestone({
		dialoguePath: newPath,
		dialogueContent: notes.get(newPath),
		questId: 'TestQuest',
		index: 20,
		canvas,
		context: contextFor(canvas, notes),
	});
	assert.ok(!('error' in linkPlan), JSON.stringify(linkPlan));
	const advanced = linkPlan.noteUpdates.get(newPath);
	assert.ok(advanced.includes('Result: Journal "TestQuest" 20'), advanced);
	assert.equal(linkPlan.canvasInsertion.edges.length, 1);
	assert.equal(linkPlan.canvasInsertion.edges[0].toNode, 'j20');
	for (const [path, content] of linkPlan.noteUpdates) notes.set(path, content);
	applyActionPlanToCanvas(canvas, linkPlan);

	// The authored branch parses end to end.
	const finalActions = parseResultActions(frontmatterOf(notes.get(newPath))['Result'] ?? '', ['TestQuest']);
	assert.ok(finalActions.some((a) => a.kind === 'journal-set' && a.targetJournalIndex === 20));
});

check('linking the same milestone twice is rejected', () => {
	const notes = makeNotes();
	const canvas = makeCanvas();
	const context = contextFor(canvas, notes);
	const first = planLinkJournalMilestone({
		dialoguePath: PARENT_PATH,
		dialogueContent: notes.get(PARENT_PATH),
		questId: 'TestQuest',
		index: 20,
		canvas,
		context,
	});
	assert.ok(!('error' in first));
	const updated = first.noteUpdates.get(PARENT_PATH);
	const second = planLinkJournalMilestone({
		dialoguePath: PARENT_PATH,
		dialogueContent: updated,
		questId: 'TestQuest',
		index: 20,
		canvas,
		context,
	});
	assert.ok('error' in second);
});

check('add speaker variant duplicates the note minus speaker fields', () => {
	const notes = makeNotes();
	const canvas = makeCanvas();
	const plan = planAddSpeakerVariant({
		sourcePath: PARENT_PATH,
		sourceContent: notes.get(PARENT_PATH),
		canvas,
		context: contextFor(canvas, notes),
		existingNotePaths: new Set(notes.keys()),
	});
	assert.ok(!('error' in plan), JSON.stringify(plan));
	const [, newContent] = [...plan.noteCreations][0];
	const fm = frontmatterOf(newContent);
	assert.equal(fm['ID'], '', 'speaker field blanked');
	assert.equal(fm['Function0'], 'Journal', 'journal gate kept');
	assert.equal(fm['Variable0'], 'TestQuest = 10');
	assert.ok(newContent.includes('What do you want to do?'), 'body kept');
	assert.ok(newContent.includes('Choice "First option." 1'), 'results kept');
});

check('renumber choice rewrites parent pair and child filters', () => {
	const notes = makeNotes();
	const childPath = 'TES3 Plugins/Test/Topic/test topic/test topic ~2.md';
	notes.set(childPath, [
		'---',
		'Type: Topic',
		'Topic: test topic',
		'Function0: Function',
		'Variable0: Choice = 1',
		'---',
		'',
		'Child response.',
	].join('\n'));
	const canvas = makeCanvas();
	canvas.nodes.push(
		{ id: 'c1', type: 'text', text: 'First option.', x: 0, y: 0, width: 320, height: 50, espCard: meta('choice', PARENT_PATH, { choiceValue: 1 }) },
		{ id: 'g2', type: 'text', text: 'Choice = 1', x: 0, y: 0, width: 385, height: 50, espCard: meta('gate', childPath) },
	);

	const plan = planRenumberChoice({
		parentPath: PARENT_PATH,
		parentContent: notes.get(PARENT_PATH),
		oldValue: 1,
		newValue: 5,
		topicNotes: notes,
		canvas,
		context: contextFor(canvas, notes),
	});
	assert.ok(!('error' in plan), JSON.stringify(plan));
	assert.ok(plan.noteUpdates.get(PARENT_PATH).includes('Choice "First option." 5'));
	assert.ok(plan.noteUpdates.get(childPath).includes('Variable0: Choice = 5'));
	assert.equal(plan.cardUpdates.get('g2'), 'Choice = 5');
	assert.deepEqual(plan.metaUpdates.get('c1'), { role: 'choice', file: PARENT_PATH, choiceValue: 5, rev: 1 });

	applyActionPlanToCanvas(canvas, plan);
	assert.equal(canvas.nodes.find((n) => n.id === 'c1').espCard.choiceValue, 5);
});

check('renumber to an occupied value is rejected', () => {
	const notes = makeNotes();
	const withTwo = notes.get(PARENT_PATH).replace('  Goodbye', '  Choice "Second." 2\n  Goodbye');
	const plan = planRenumberChoice({
		parentPath: PARENT_PATH,
		parentContent: withTwo,
		oldValue: 1,
		newValue: 2,
		topicNotes: new Map([[PARENT_PATH, withTwo]]),
		canvas: makeCanvas(),
		context: contextFor(makeCanvas(), notes),
	});
	assert.ok('error' in plan);
});

check('pickFreeNotePath skips occupied suffixes', () => {
	const existing = new Set([
		'folder/topic ~1.md',
		'folder/topic ~2.md',
		'folder/topic ~4.md',
	]);
	assert.equal(pickFreeNotePath('folder', 'topic', existing), 'folder/topic ~3.md');
});

console.log(`actions-test: ${testCount} checks passed`);

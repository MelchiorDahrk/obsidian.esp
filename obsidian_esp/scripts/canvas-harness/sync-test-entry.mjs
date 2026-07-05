// Headless tests for the canvas→note sync core (quest-canvas/sync-core.ts).
// Mutates canvas JSON like a user edit would and asserts the exact note
// bytes the sync engine writes, plus the canonical echo texts.
import assert from 'node:assert/strict';
import {
	applySyncPlanToCanvas,
	deriveQuestContext,
	diffCanvasTextEdits,
	editableCardText,
	planSyncFromEdits,
} from '../../obsidian_plugin/src/features/quest-canvas/sync-core.ts';

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

// --- fixtures ----------------------------------------------------------------
const BRANCH_PATH = 'TES3 Plugins/Test/Topic/test topic/branch.md';
const INLINE_PATH = 'TES3 Plugins/Test/Greeting/Greeting 1/inline.md';
const JOURNAL_10_PATH = 'TES3 Plugins/Test/Journal/TestQuest/10.md';
const JOURNAL_20_PATH = 'TES3 Plugins/Test/Journal/TestQuest/20.md';

const BRANCH_NOTE = [
	'---',
	'Source:',
	'Type: Topic',
	'Topic: test topic',
	'DiagID: 11111111111111111111',
	'PrevID: 22222222222222222222',
	'Disposition: 30',
	'ID: test npc',
	'Race:',
	'Sex:',
	'Class:',
	'Faction:',
	'Rank:',
	'Cell:',
	'PC Faction:',
	'PC Rank:',
	'MyCustomKey: keep me',
	'Result: |',
	'  MessageBox "custom line"',
	'  Journal "TestQuest" 20',
	'  Choice "Yes." 1 "No." 2',
	'  Goodbye',
	'Function0: Journal',
	'Variable0: TestQuest = 10',
	'Function1: Dead',
	'Variable1: kashtes ilabael > 0',
	'---',
	'',
	'',
	'Some dialogue body text.',
].join('\n');

const INLINE_NOTE = [
	'---',
	'Source:',
	'Type: Greeting',
	'Topic: Greeting 1',
	'Disposition: 0',
	'Result: Goodbye',
	'Function0: Journal',
	'Variable0: TestQuest = 10',
	'---',
	'',
	'Hello there.',
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
		[BRANCH_PATH, BRANCH_NOTE],
		[INLINE_PATH, INLINE_NOTE],
		[JOURNAL_10_PATH, journalNote(10)],
		[JOURNAL_20_PATH, journalNote(20)],
	]);
}

const meta = (role, file, extra = {}) => ({ role, file, rev: 1, ...extra });
const GATE_TEXT = 'Disposition = 30\nID = test npc\nJournal TestQuest = 10\nDead kashtes ilabael > 0';
const RESULT_TEXT = 'MessageBox "custom line"\nJournal [[20|TestQuest 20]]\nGoodbye';

function makeCanvas() {
	return {
		nodes: [
			{ id: 'j10', type: 'file', file: JOURNAL_10_PATH, x: 0, y: 0, width: 440, height: 100, color: '6', espCard: meta('journal', JOURNAL_10_PATH, { questId: 'TestQuest' }) },
			{ id: 'j20', type: 'file', file: JOURNAL_20_PATH, x: 900, y: 0, width: 440, height: 100, color: '6', espCard: meta('journal', JOURNAL_20_PATH, { questId: 'TestQuest' }) },
			{ id: 'g1', type: 'text', text: GATE_TEXT, x: 100, y: 200, width: 385, height: 100, color: '4', espCard: meta('gate', BRANCH_PATH) },
			{ id: 'd1', type: 'file', file: BRANCH_PATH, x: 400, y: 200, width: 440, height: 120, color: '3', espCard: meta('dialogue', BRANCH_PATH) },
			{ id: 'r1', type: 'text', text: RESULT_TEXT, x: 400, y: 340, width: 440, height: 90, color: '6', espCard: meta('result', BRANCH_PATH) },
			{ id: 'c1', type: 'text', text: 'Yes.', x: 700, y: 200, width: 320, height: 50, color: '4', espCard: meta('choice', BRANCH_PATH, { choiceValue: 1 }) },
			{ id: 'user-note', type: 'text', text: 'my own annotation', x: 0, y: 900, width: 200, height: 60 },
		],
		edges: [],
	};
}

function clone(canvas) {
	return JSON.parse(JSON.stringify(canvas));
}

function runSync(previous, next, notes) {
	const readNote = (path) => notes.get(path) ?? null;
	const edits = diffCanvasTextEdits(previous, next);
	const context = deriveQuestContext(next, readNote);
	const plan = planSyncFromEdits(edits, readNote, context);
	return { edits, plan };
}

// --- diff scoping --------------------------------------------------------------
check('position changes and user notes are layout-only', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	next.nodes[2].x += 500;
	next.nodes[2].y -= 100;
	next.nodes.find((n) => n.id === 'user-note').text = 'edited annotation';
	next.nodes.push({ id: 'pasted', type: 'text', text: 'pasted node', x: 1, y: 1, width: 100, height: 50 });
	assert.deepEqual(diffCanvasTextEdits(previous, next), []);
});

check('deleting an espCard node is layout-only', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	next.nodes = next.nodes.filter((n) => n.id !== 'g1');
	const { plan } = runSync(previous, next, makeNotes());
	assert.equal(plan.noteUpdates.size, 0);
});

// --- gate edits -----------------------------------------------------------------
check('gate edit performs frontmatter surgery and echoes canonical text', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	// Remove the ID speaker line, bump the journal filter, add a Function filter.
	next.nodes[2].text = 'Disposition = 30\nJournal TestQuest=20\nDead kashtes ilabael > 0\nPCLevel > 5';
	const notes = makeNotes();
	const { plan } = runSync(previous, next, notes);

	assert.equal(plan.failures.length, 0);
	const expectedNote = [
		'---',
		'Source:',
		'Type: Topic',
		'Topic: test topic',
		'DiagID: 11111111111111111111',
		'PrevID: 22222222222222222222',
		'Disposition: 30',
		'ID:',
		'Race:',
		'Sex:',
		'Class:',
		'Faction:',
		'Rank:',
		'Cell:',
		'PC Faction:',
		'PC Rank:',
		'MyCustomKey: keep me',
		'Result: |',
		'  MessageBox "custom line"',
		'  Journal "TestQuest" 20',
		'  Choice "Yes." 1 "No." 2',
		'  Goodbye',
		'Function0: Journal',
		'Variable0: TestQuest = 20',
		'Function1: Dead',
		'Variable1: kashtes ilabael > 0',
		'Function2: Function',
		'Variable2: PCLevel > 5',
		'---',
		'',
		'',
		'Some dialogue body text.',
	].join('\n');
	assert.equal(plan.noteUpdates.get(BRANCH_PATH), expectedNote);

	// Echo: canonical order and spacing (Journal TestQuest=20 -> Journal TestQuest = 20).
	assert.equal(
		plan.cardUpdates.get('g1'),
		'Disposition = 30\nDead kashtes ilabael > 0\nJournal TestQuest = 20\nPCLevel > 5',
	);
});

check('gate edit removing all filters clears the slots', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	next.nodes[2].text = 'Disposition = 30\nID = test npc';
	const { plan } = runSync(previous, next, makeNotes());
	const updated = plan.noteUpdates.get(BRANCH_PATH);
	assert.ok(!/Function\d:/.test(updated));
	assert.ok(!/Variable\d:/.test(updated));
	assert.ok(updated.includes('Result: |'), 'Result block untouched');
});

check('unparseable gate edit writes nothing and marks the card', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	next.nodes[2].text = 'Disposition = 30\nJournal';
	const notes = makeNotes();
	const { plan } = runSync(previous, next, notes);

	assert.equal(plan.noteUpdates.size, 0);
	assert.equal(plan.failures.length, 1);
	assert.ok(applySyncPlanToCanvas(next, plan));
	const gate = next.nodes[2];
	assert.ok(gate.text.startsWith('⚠️'));
	assert.ok(gate.text.endsWith('Disposition = 30\nJournal'), 'user text preserved below the warning');
	// The warning line is invisible to the next diff pass.
	assert.equal(editableCardText(gate.text), 'Disposition = 30\nJournal');
});

// --- result edits -----------------------------------------------------------------
check('result edit does line surgery and preserves Choice lines and block style', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	// Accept the raw journal form, keep the unknown script line, delete Goodbye.
	next.nodes[4].text = 'MessageBox "custom line"\nJournal TestQuest 10';
	const notes = makeNotes();
	const { plan } = runSync(previous, next, notes);

	assert.equal(plan.failures.length, 0);
	const updated = plan.noteUpdates.get(BRANCH_PATH);
	const expectedResult = [
		'Result: |',
		'  MessageBox "custom line"',
		'  Journal "TestQuest" 10',
		'  Choice "Yes." 1 "No." 2',
	].join('\n');
	assert.ok(updated.includes(expectedResult), `Result block:\n${updated}`);
	assert.ok(!updated.includes('Goodbye'));
	assert.ok(updated.includes('MyCustomKey: keep me'));
	// Echo re-renders the journal line as a milestone wikilink.
	assert.equal(plan.cardUpdates.get('r1'), 'MessageBox "custom line"\nJournal [[10|TestQuest 10]]');
});

check('single-line result stays in the inline scalar style', () => {
	const previous = makeCanvas();
	previous.nodes.push({
		id: 'r2', type: 'text', text: 'Goodbye', x: 0, y: 0, width: 440, height: 50, color: '5',
		espCard: meta('result', INLINE_PATH),
	});
	const next = clone(previous);
	next.nodes.find((n) => n.id === 'r2').text = 'ModDisposition -10';
	const { plan } = runSync(previous, next, makeNotes());
	const updated = plan.noteUpdates.get(INLINE_PATH);
	assert.ok(updated.includes('\nResult: ModDisposition -10\n'), `inline style kept:\n${updated}`);
});

// --- choice edits ------------------------------------------------------------------
check('choice rename rewrites only its pair in the Choice line', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	next.nodes[5].text = 'Yes, take it.';
	const notes = makeNotes();
	const { plan } = runSync(previous, next, notes);

	assert.equal(plan.failures.length, 0);
	const updated = plan.noteUpdates.get(BRANCH_PATH);
	assert.ok(updated.includes('  Choice "Yes, take it." 1 "No." 2'), updated);
	assert.equal(plan.cardUpdates.get('c1'), 'Yes, take it.');
});

check('choice rename with quotes is rejected without writing', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	next.nodes[5].text = 'Say "hello"';
	const { plan } = runSync(previous, next, makeNotes());
	assert.equal(plan.noteUpdates.size, 0);
	assert.equal(plan.failures.length, 1);
});

// --- context derivation --------------------------------------------------------------
check('quest context comes from journal nodes', () => {
	const canvas = makeCanvas();
	const notes = makeNotes();
	const context = deriveQuestContext(canvas, (path) => notes.get(path) ?? null);
	assert.deepEqual(context.questIds, ['TestQuest']);
	assert.deepEqual(context.milestones.map((m) => m.index), [10, 20]);
});

// --- idempotence -----------------------------------------------------------------------
check('sync converges: echo produces no further edits and writes reach a fixed point', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	next.nodes[2].text = 'Disposition = 30\nJournal TestQuest=20\nDead kashtes ilabael > 0\nPCLevel > 5';
	const notes = makeNotes();
	const { plan } = runSync(previous, next, notes);
	for (const [path, content] of plan.noteUpdates) {
		notes.set(path, content);
	}
	applySyncPlanToCanvas(next, plan);

	// The canvas now shows canonical text; re-diffing against it yields nothing,
	// which is the loop guard that stops echo cascades.
	const rerun = runSync(next, clone(next), notes);
	assert.equal(rerun.edits.length, 0);

	// If the user re-submits the canonical text as a fresh edit, the write
	// reaches a fixed point: the note may compact filter slots into display
	// order once, after which repeated applications change nothing.
	const echoEdit = clone(next);
	echoEdit.nodes[2].text = `${plan.cardUpdates.get('g1')} `; // force a diff, same semantics
	const second = runSync(next, echoEdit, notes);
	for (const [path, content] of second.plan.noteUpdates) {
		notes.set(path, content);
	}
	assert.equal(second.plan.cardUpdates.get('g1'), plan.cardUpdates.get('g1'), 'echo text is stable');

	const echoEdit2 = clone(echoEdit);
	echoEdit2.nodes[2].text = `${plan.cardUpdates.get('g1')}  `;
	const third = runSync(echoEdit, echoEdit2, notes);
	assert.equal(third.plan.noteUpdates.size, 0, 'second application is byte-stable');
});

console.log(`sync-test: ${testCount} checks passed`);

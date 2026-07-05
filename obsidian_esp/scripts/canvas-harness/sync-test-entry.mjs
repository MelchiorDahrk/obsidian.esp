// Headless tests for the canvas→note sync core (quest-canvas/sync-core.ts).
// Mutates canvas JSON like a user edit would and asserts the exact note
// bytes the sync engine writes, plus the canonical echo texts.
import assert from 'node:assert/strict';
import {
	applySyncPlanToCanvas,
	deriveQuestContext,
	describeEdgeGesture,
	diffCanvasEdgeGestures,
	diffCanvasTextEdits,
	editableCardText,
	planEdgeGestures,
	planSyncFromEdits,
} from '../../obsidian_plugin/src/features/quest-canvas/sync-core.ts';
import { mergeCanvasPreservingLayout } from '../../obsidian_plugin/src/features/quest-canvas/refresh.ts';

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

// --- functional edges (Phase 4) --------------------------------------------------
function edgeGestureRun(previous, next, notes) {
	const readNote = (path) => notes.get(path) ?? null;
	const context = deriveQuestContext(next, readNote);
	const edits = diffCanvasEdgeGestures(previous, next, context);
	return { edits, planFor: (subset) => planEdgeGestures(subset, readNote, context, next) };
}

check('edge add: dialogue -> journal writes the Journal result line', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	next.edges.push({ id: 'e-adv', fromNode: 'd1', fromSide: 'right', toNode: 'j10', toSide: 'left' });
	const notes = makeNotes();
	const { edits, planFor } = edgeGestureRun(previous, next, notes);
	assert.equal(edits.length, 1);
	assert.deepEqual(edits[0].gesture, {
		type: 'journal-advance', sourceFile: BRANCH_PATH, questId: 'TestQuest', index: 10,
	});
	const plan = planFor(edits);
	const updated = plan.noteUpdates.get(BRANCH_PATH);
	// Replaces the existing Journal line for the same quest, in place.
	assert.ok(updated.includes('  Journal "TestQuest" 10'), updated);
	assert.ok(!updated.includes('Journal "TestQuest" 20'));
	// Result card echoes the change.
	assert.ok(plan.cardUpdates.get('r1').includes('Journal [[10|TestQuest 10]]'));
});

check('edge remove: dialogue -> journal deletes the Journal result line', () => {
	const previous = makeCanvas();
	previous.edges.push({ id: 'e-adv', fromNode: 'd1', fromSide: 'right', toNode: 'j20', toSide: 'left' });
	const next = clone(previous);
	next.edges = [];
	const notes = makeNotes();
	const { edits, planFor } = edgeGestureRun(previous, next, notes);
	assert.equal(edits.length, 1);
	assert.equal(edits[0].kind, 'remove');
	assert.equal(
		describeEdgeGesture(edits[0]),
		`${BRANCH_PATH}: remove result line 'Journal "TestQuest" 20'`,
	);
	const plan = planFor(edits);
	const updated = plan.noteUpdates.get(BRANCH_PATH);
	assert.ok(!updated.includes('Journal "TestQuest" 20'), updated);
	assert.ok(updated.includes('  Choice "Yes." 1 "No." 2'), 'other lines untouched');
});

check('edge add: dialogue -> choice card ensures the Choice pair', () => {
	const previous = makeCanvas();
	// A second dialogue node that does not yet offer choice 1.
	previous.nodes.push({
		id: 'd2', type: 'file', file: INLINE_PATH, x: 0, y: 600, width: 440, height: 120, color: '3',
		espCard: meta('dialogue', INLINE_PATH),
	});
	const next = clone(previous);
	next.edges.push({ id: 'e-offer', fromNode: 'd2', fromSide: 'right', toNode: 'c1', toSide: 'left' });
	const notes = makeNotes();
	const { edits, planFor } = edgeGestureRun(previous, next, notes);
	assert.equal(edits.length, 1);
	assert.deepEqual(edits[0].gesture, {
		type: 'offer-choice', sourceFile: INLINE_PATH, choiceValue: 1, prompt: 'Yes.',
	});
	const plan = planFor(edits);
	const updated = plan.noteUpdates.get(INLINE_PATH);
	assert.ok(updated.includes('Result: |'), 'inline scalar grows into a block');
	assert.ok(updated.includes('  Choice "Yes." 1'), updated);
});

check('edge remove: dialogue -> choice card removes only that pair', () => {
	const previous = makeCanvas();
	previous.edges.push({ id: 'e-offer', fromNode: 'd1', fromSide: 'right', toNode: 'c1', toSide: 'left' });
	const next = clone(previous);
	next.edges = [];
	const notes = makeNotes();
	const { edits, planFor } = edgeGestureRun(previous, next, notes);
	const plan = planFor(edits);
	const updated = plan.noteUpdates.get(BRANCH_PATH);
	assert.ok(updated.includes('Choice "No." 2'), 'sibling pair kept');
	assert.ok(!updated.includes('"Yes." 1'), updated);
});

check('edge add/remove: choice card -> gate toggles the Choice filter', () => {
	const previous = makeCanvas();
	previous.nodes.push({
		id: 'g2', type: 'text', text: 'Journal TestQuest = 10', x: 0, y: 600, width: 385, height: 60, color: '4',
		espCard: meta('gate', INLINE_PATH),
	});
	const next = clone(previous);
	next.edges.push({ id: 'e-cg', fromNode: 'c1', fromSide: 'right', toNode: 'g2', toSide: 'left' });
	const notes = makeNotes();
	const { edits, planFor } = edgeGestureRun(previous, next, notes);
	assert.deepEqual(edits[0].gesture, { type: 'choice-gate', targetFile: INLINE_PATH, choiceValue: 1 });
	const plan = planFor(edits);
	const updated = plan.noteUpdates.get(INLINE_PATH);
	assert.ok(updated.includes('Function1: Function'), updated);
	assert.ok(updated.includes('Variable1: Choice = 1'), updated);
	assert.equal(plan.cardUpdates.get('g2'), 'Disposition = 0\nChoice = 1\nJournal TestQuest = 10');

	// Removing the edge takes the filter back out.
	notes.set(INLINE_PATH, updated);
	const reverted = edgeGestureRun(next, previous, notes);
	assert.equal(reverted.edits[0].kind, 'remove');
	const removePlan = reverted.planFor(reverted.edits);
	const restored = removePlan.noteUpdates.get(INLINE_PATH);
	assert.ok(!restored.includes('Choice = 1'), restored);
	assert.ok(restored.includes('Variable0: TestQuest = 10'), 'journal filter kept');
});

check('edge add: journal -> gate adds the availability condition', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	next.edges.push({ id: 'e-avail', fromNode: 'j20', fromSide: 'right', toNode: 'g1', toSide: 'left' });
	const notes = makeNotes();
	const { edits, planFor } = edgeGestureRun(previous, next, notes);
	assert.deepEqual(edits[0].gesture, {
		type: 'availability-gate', targetFile: BRANCH_PATH, questId: 'TestQuest', index: 20,
	});
	const plan = planFor(edits);
	const updated = plan.noteUpdates.get(BRANCH_PATH);
	assert.ok(updated.includes('Variable2: TestQuest = 20'), updated);
});

check('ambiguous and derived edges are ignored', () => {
	const previous = makeCanvas();
	const next = clone(previous);
	next.edges.push(
		// derived marker
		{ id: 'e-derived', fromNode: 'd1', fromSide: 'right', toNode: 'j10', toSide: 'left', espCard: { role: 'derived', rev: 1 } },
		// user note endpoint
		{ id: 'e-user', fromNode: 'user-note', fromSide: 'right', toNode: 'g1', toSide: 'left' },
		// non-whitelisted role pair (gate -> journal)
		{ id: 'e-odd', fromNode: 'g1', fromSide: 'right', toNode: 'j10', toSide: 'left' },
		// journal -> dialogue is not a whitelisted gesture either
		{ id: 'e-jd', fromNode: 'j10', fromSide: 'right', toNode: 'd1', toSide: 'left' },
	);
	const notes = makeNotes();
	const { edits } = edgeGestureRun(previous, next, notes);
	assert.deepEqual(edits, []);
});

// --- provenance-matched refresh (Phase 5) ------------------------------------------
check('refresh keeps manual layout, remaps ids, and drops orphans', () => {
	// The user's tended canvas: nodes moved, one personal note + wire, plus a
	// stale generated gate whose note no longer produces one.
	const existing = makeCanvas();
	existing.nodes[2].x = 5000; // gate g1 moved
	existing.nodes[2].y = -300;
	existing.nodes[3].x = 5600; // dialogue d1 moved
	existing.nodes.push({
		id: 'orphan-gate', type: 'text', text: 'Dead someone > 0', x: 1, y: 1, width: 385, height: 60,
		espCard: meta('gate', 'TES3 Plugins/Test/Topic/gone/gone ~1.md'),
	});
	existing.edges.push({ id: 'user-wire', fromNode: 'user-note', fromSide: 'right', toNode: 'd1', toSide: 'left' });

	// Fresh regeneration: same provenance for g1/d1/j10/j20/r1, a renamed
	// choice card (same provenance, new node id), and a brand-new gate wired
	// to d1.
	const fresh = makeCanvas();
	fresh.nodes = fresh.nodes.filter((n) => n.id !== 'user-note');
	const renamedChoice = fresh.nodes.find((n) => n.id === 'c1');
	renamedChoice.id = 'c1-renamed';
	renamedChoice.text = 'Yes, absolutely.';
	const newGate = {
		id: 'g-new', type: 'text', text: 'Choice = 2', x: 900, y: 340, width: 385, height: 60,
		espCard: meta('gate', 'TES3 Plugins/Test/Topic/test topic/new.md'),
	};
	fresh.nodes.push(newGate);
	fresh.edges.push({ id: 'e-new', fromNode: 'd1', fromSide: 'right', toNode: 'g-new', toSide: 'left' });

	const { merged, stats } = mergeCanvasPreservingLayout(existing, fresh);

	// Matched nodes keep the user's positions.
	const gate = merged.nodes.find((n) => n.id === 'g1');
	assert.equal(gate.x, 5000);
	assert.equal(gate.y, -300);
	const dialogue = merged.nodes.find((n) => n.id === 'd1');
	assert.equal(dialogue.x, 5600);

	// The renamed choice card matched by provenance despite the new id.
	const choice = merged.nodes.find((n) => n.id === 'c1-renamed');
	assert.ok(choice, 'renamed choice card present');
	assert.equal(choice.text, 'Yes, absolutely.');
	assert.equal(choice.x, 700, 'kept the old choice card position');

	// New node placed relative to its (moved) neighbor, not at raw layout
	// coords: d1 sits at x=400 in the fresh layout but x=5600 on the canvas.
	const placed = merged.nodes.find((n) => n.id === 'g-new');
	assert.equal(placed.x, 5600 + (900 - 400));
	assert.equal(placed.y, 200 + (340 - 200));

	// Orphaned generated node removed; user assets survive.
	assert.ok(!merged.nodes.some((n) => n.id === 'orphan-gate'));
	assert.ok(merged.nodes.some((n) => n.id === 'user-note'));
	assert.ok(merged.edges.some((e) => e.id === 'user-wire'));
	assert.deepEqual(stats, { matched: 6, added: 1, removed: 1, userNodesKept: 1, userEdgesKept: 1 });
});

console.log(`sync-test: ${testCount} checks passed`);

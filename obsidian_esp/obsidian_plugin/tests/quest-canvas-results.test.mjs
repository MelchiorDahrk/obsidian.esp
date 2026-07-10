import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);
const { splitFrontmatter } = jiti(resolve(here, '../src/utils/obsidian-utils.ts'));
const { parseStructuredFrontmatter } = jiti(resolve(here, '../src/features/quest-canvas/frontmatter-surgeon.ts'));
const { parseResultActions } = jiti(resolve(here, '../src/features/quest-canvas/cards.ts'));
const { renderCardFromNote } = jiti(resolve(here, '../src/features/quest-canvas/sync-core.ts'));

const multilineResultNote = [
	'---',
	'Type: Topic',
	'Topic: egg mine',
	'Result: |',
	'  ; StartScript to Wait-One-Day which will give Journal ABcm_HH_MineReport 20',
	'  Journal ABcm_HH_Mine 55',
	'---',
	'Dialogue body.',
	'',
].join('\r\n');

const context = {
	questIds: ['ABcm_HH_Mine'],
	milestones: [
		{
			questId: 'ABcm_HH_Mine',
			index: 55,
			file: { path: 'Journal/ABcm_HH_Mine/ABcm_HH_Mine 55.md' },
		},
	],
};

test('quest canvas parses multi-line Result blocks from CRLF notes', () => {
	const { frontmatter, body } = splitFrontmatter(multilineResultNote);
	const parsed = parseStructuredFrontmatter(frontmatter);
	const actions = parseResultActions(parsed.Result ?? '', ['ABcm_HH_Mine']);

	assert.equal(body, 'Dialogue body.\r\n');
	assert.equal(
		parsed.Result,
		'; StartScript to Wait-One-Day which will give Journal ABcm_HH_MineReport 20\nJournal ABcm_HH_Mine 55',
	);
	assert.equal(actions.length, 2);
	assert.equal(actions[0].kind, 'comment');
	assert.equal(actions[1].kind, 'journal-set');
	assert.equal(actions[1].targetQuestId, 'ABcm_HH_Mine');
	assert.equal(actions[1].targetJournalIndex, 55);
});

test('quest canvas result cards render every CRLF Result line', () => {
	const cardText = renderCardFromNote(
		{ role: 'result' },
		multilineResultNote,
		context,
	);

	assert.equal(
		cardText,
		'; StartScript to Wait-One-Day which will give Journal ABcm_HH_MineReport 20\n'
			+ 'Journal [[ABcm_HH_Mine 55|ABcm_HH_Mine 55]]',
	);
});

test('quest canvas parses legacy Results aliases with escaped newlines', () => {
	const note = [
		'---',
		'Type: Topic',
		'Topic: egg mine',
		'Results: "; StartScript to Wait-One-Day which will give Journal ABcm_HH_MineReport 20\\r\\nJournal ABcm_HH_Mine 55\\nChoice \\"Continue\\" 1"',
		'---',
		'Dialogue body.',
		'',
	].join('\n');

	const cardText = renderCardFromNote({ role: 'result' }, note, context);
	const choiceText = renderCardFromNote({ role: 'choice', choiceValue: 1 }, note, context);

	assert.equal(
		cardText,
		'; StartScript to Wait-One-Day which will give Journal ABcm_HH_MineReport 20\n'
			+ 'Journal [[ABcm_HH_Mine 55|ABcm_HH_Mine 55]]',
	);
	assert.equal(choiceText, 'Continue');
});

test('quest canvas treats bare carriage returns as result line breaks', () => {
	const actions = parseResultActions(
		'; StartScript to Wait-One-Day which will give Journal ABcm_HH_MineReport 20\rJournal ABcm_HH_Mine 55',
		['ABcm_HH_Mine'],
	);

	assert.equal(actions.length, 2);
	assert.equal(actions[0].kind, 'comment');
	assert.equal(actions[1].kind, 'journal-set');
	assert.equal(actions[1].targetQuestId, 'ABcm_HH_Mine');
	assert.equal(actions[1].targetJournalIndex, 55);
});

test('quest canvas never compiles Journal text inside a semicolon comment', () => {
	const actions = parseResultActions(
		'Journal ABcm_HH_Mine 50\n; StartScript to Wait-One-Day which will give Journal ABcm_HH_MineReport 20',
		['ABcm_HH_Mine', 'ABcm_HH_MineReport'],
	);

	assert.deepEqual(actions.map((action) => action.kind), ['journal-set', 'comment']);
	assert.equal(actions[0].targetQuestId, 'ABcm_HH_Mine');
	assert.equal(actions[0].targetJournalIndex, 50);
});

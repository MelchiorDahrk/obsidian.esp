// Round-trip tests for the bidirectional card grammar in quest-canvas/cards.ts.
// Bundled and run by cards-test.mjs with 'obsidian' aliased to the stub.
import assert from 'node:assert/strict';
import {
	FILTER_KINDS,
	SPEAKER_FIELDS,
	filterSlotToGateLine,
	gateLineToFrontmatter,
	normalizeVariableExpression,
	parseConditions,
	parseGateCardText,
	parseGateLine,
	parseResultActions,
	parseResultCardLine,
	parseResultCardText,
	renderConditionBlock,
	renderGateLine,
	renderResultNoteLine,
} from '../../obsidian_plugin/src/features/quest-canvas/cards.ts';

const OPERATORS = ['=', '==', '!=', '<', '<=', '>', '>='];
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

// --- Gate lines: speaker fields ---------------------------------------------
for (const field of SPEAKER_FIELDS) {
	check(`speaker round-trip: ${field}`, () => {
		const line = { kind: 'speaker', field, value: field === 'Disposition' ? '30' : 'Wise Woman' };
		const rendered = renderGateLine(line);
		assert.deepEqual(parseGateLine(rendered), line);
		assert.equal(renderGateLine(parseGateLine(rendered)), rendered);
	});
}

// --- Gate lines: every filter kind x every operator --------------------------
for (const filterKind of FILTER_KINDS) {
	for (const operator of OPERATORS) {
		check(`filter round-trip: ${filterKind} ${operator}`, () => {
			const line = { kind: 'filter', filterKind, variable: `some_id ${operator} 10` };
			const rendered = renderGateLine(line);
			const parsed = parseGateLine(rendered);
			assert.deepEqual(parsed, line);
			// render(parse(x)) === x for canonical x
			assert.equal(renderGateLine(parsed), rendered);
		});
	}
}

// --- Gate lines: choice ------------------------------------------------------
check('choice round-trip', () => {
	for (const value of [0, 1, 2, 9, -1]) {
		const line = { kind: 'choice', choiceValue: value };
		assert.deepEqual(parseGateLine(renderGateLine(line)), line);
	}
});

// --- Gate lines: normalization of loose spacing ------------------------------
check('normalization: loose spacing becomes canonical', () => {
	assert.equal(renderGateLine(parseGateLine('Choice=2')), 'Choice = 2');
	assert.equal(renderGateLine(parseGateLine('Journal my_quest>=10')), 'Journal my_quest >= 10');
	assert.equal(renderGateLine(parseGateLine('Global ABtv_GalosRetired=2')), 'Global ABtv_GalosRetired = 2');
	assert.equal(normalizeVariableExpression('a  <=  5'), 'a <= 5');
});

// --- Gate lines: ids containing spaces ---------------------------------------
check('filter id with spaces round-trips', () => {
	const parsed = parseGateLine('Dead kashtes ilabael > 0');
	assert.deepEqual(parsed, { kind: 'filter', filterKind: 'Dead', variable: 'kashtes ilabael > 0' });
	assert.equal(renderGateLine(parsed), 'Dead kashtes ilabael > 0');
});

// --- Gate lines: Function-kind fallback ---------------------------------------
check('bare expression is a Function-kind filter', () => {
	const parsed = parseGateLine('PCLevel > 5');
	assert.deepEqual(parsed, { kind: 'filter', filterKind: 'Function', variable: 'PCLevel > 5' });
	assert.equal(renderGateLine(parsed), 'PCLevel > 5');
});

// --- Gate lines: errors -------------------------------------------------------
check('bare filter kind is an error', () => {
	assert.ok('error' in parseGateLine('Journal'));
	assert.ok('error' in parseGateLine('Dead'));
});
check('gate card text: blank lines skipped, errors propagate', () => {
	const ok = parseGateCardText('Class = Wise Woman\n\nJournal quest = 10\n');
	assert.equal(ok.ok, true);
	assert.equal(ok.lines.length, 2);
	const bad = parseGateCardText('Class = Wise Woman\nJournal\n');
	assert.equal(bad.ok, false);
});

// --- Gate lines <-> frontmatter slots -----------------------------------------
check('gateLineToFrontmatter/filterSlotToGateLine are inverse for filters', () => {
	for (const filterKind of FILTER_KINDS) {
		const line = { kind: 'filter', filterKind, variable: 'quest_id = 10' };
		const slot = gateLineToFrontmatter(line);
		assert.equal(slot.functionValue, filterKind);
		assert.deepEqual(filterSlotToGateLine(slot.functionValue, slot.variableValue), line);
	}
});
check('choice line maps to Function/Choice slot and back', () => {
	const slot = gateLineToFrontmatter({ kind: 'choice', choiceValue: 3 });
	assert.deepEqual(slot, { functionValue: 'Function', variableValue: 'Choice = 3' });
	assert.deepEqual(filterSlotToGateLine('Function', 'Choice = 3'), { kind: 'choice', choiceValue: 3 });
});
check('speaker line maps to a speaker key', () => {
	const slot = gateLineToFrontmatter({ kind: 'speaker', field: 'PC Faction', value: 'Mages Guild' });
	assert.deepEqual(slot, { speakerField: 'PC Faction', value: 'Mages Guild' });
});

// --- parseConditions produces the canonical (parseable) grammar ---------------
check('parseConditions display text parses back', () => {
	const frontmatter = {
		Disposition: '30',
		ID: 'athanden girith',
		Function0: 'Journal',
		Variable0: 'MV_Quest >= 10',
		Function1: 'Item',
		Variable1: 'ABgh_guarHides >= 1',
		Function2: 'Dead',
		Variable2: 'kashtes ilabael > 0',
		Function3: 'Function',
		Variable3: 'Choice = 2',
		Function4: 'Global',
		Variable4: 'Random100 >= 0',
	};
	const conditions = parseConditions(frontmatter, ['MV_Quest']);
	const text = renderConditionBlock(conditions);
	assert.ok(!text.includes(' - '), `no legacy separators in:\n${text}`);
	const parsed = parseGateCardText(text);
	assert.equal(parsed.ok, true, `gate text must parse:\n${text}`);
	assert.equal(parsed.lines.length, conditions.length);
	// Round-trip through the slot mapping keeps every line
	for (const line of parsed.lines) {
		const slotOrKey = gateLineToFrontmatter(line);
		if ('functionValue' in slotOrKey) {
			assert.deepEqual(filterSlotToGateLine(slotOrKey.functionValue, slotOrKey.variableValue), line);
		}
	}
});

// --- Result lines --------------------------------------------------------------
check('journal result: wikilink and raw forms parse identically', () => {
	const expected = { kind: 'journal', questId: 'MV_Quest', index: 20 };
	assert.deepEqual(parseResultCardLine('Journal [[MV_Quest 20]]'), expected);
	assert.deepEqual(parseResultCardLine('Journal [[Some Note#^block|MV_Quest 20]]'), expected);
	assert.deepEqual(parseResultCardLine('Journal MV_Quest 20'), expected);
	assert.deepEqual(parseResultCardLine('Journal "MV_Quest" 20'), expected);
	assert.equal(renderResultNoteLine(expected), 'Journal "MV_Quest" 20');
});

check('add-topic result forms', () => {
	const expected = { kind: 'add-topic', topic: 'latest rumors' };
	assert.deepEqual(parseResultCardLine('AddTopic "[[latest rumors]]"'), expected);
	assert.deepEqual(parseResultCardLine('AddTopic [[latest rumors]]'), expected);
	assert.deepEqual(parseResultCardLine('AddTopic "latest rumors"'), expected);
	assert.deepEqual(parseResultCardLine('AddTopic latest rumors'), expected);
	assert.equal(renderResultNoteLine(expected), 'AddTopic "latest rumors"');
});

check('choice result line', () => {
	const expected = { kind: 'choice', text: 'Hand over the hides.', choiceValue: 1 };
	assert.deepEqual(parseResultCardLine('Choice "Hand over the hides." 1'), expected);
	assert.equal(renderResultNoteLine(expected), 'Choice "Hand over the hides." 1');
});

check('unknown script lines are preserved verbatim', () => {
	for (const script of [
		'Player->RemoveItem "ABgh_guarHides" 1',
		'StartScript "MyScript"',
		'ModDisposition -30',
		'Goodbye',
		'PositionCell 0 0 0 0 "Balmora"',
	]) {
		const parsed = parseResultCardLine(script);
		assert.equal(renderResultNoteLine(parsed), script);
	}
});

check('result card text: multi-line', () => {
	const lines = parseResultCardText('Journal "MV_Quest" 100\nPlayer->RemoveItem "x" 1\n\nGoodbye\n');
	assert.equal(lines.length, 3);
	assert.equal(lines[0].kind, 'journal');
	assert.equal(lines[1].kind, 'script');
});

// --- parseResultActions display text parses back --------------------------------
check('parseResultActions display text parses back to the same semantics', () => {
	const actions = parseResultActions(
		'Journal "MV_Quest" 100\nAddTopic "latest rumors"\nChoice "Yes." 1 "No." 2\nGoodbye\nModDisposition -10\nStartScript "s"',
		['MV_Quest'],
	);
	for (const action of actions) {
		if (action.kind === 'choice-set') {
			continue; // choice-set renders as a choice card, not a result line
		}
		const parsed = parseResultCardLine(action.displayText);
		if (action.kind === 'journal-set') {
			assert.equal(parsed.kind, 'journal');
			assert.equal(parsed.questId, action.targetQuestId);
			assert.equal(parsed.index, action.targetJournalIndex);
		} else if (action.kind === 'add-topic') {
			assert.equal(parsed.kind, 'add-topic');
			assert.equal(parsed.topic, action.targetTopic);
		} else {
			assert.equal(renderResultNoteLine(parsed), action.displayText);
		}
	}
});

console.log(`cards-test: ${testCount} checks passed`);

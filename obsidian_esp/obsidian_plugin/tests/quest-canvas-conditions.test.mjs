import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);
const {
	hasSelectedQuestJournalFilter,
	numericConditionRangesAreCompatible,
	speakerConditionValuesAreCompatible,
} = jiti(resolve(here, '../src/features/quest-canvas/conditions.ts'));
const { conditionsCanFollowChoice } = jiti(resolve(here, '../src/features/quest-canvas/families.ts'));

test('speaker condition matching treats numeric disposition requirements as compatible thresholds', () => {
	assert.equal(speakerConditionValuesAreCompatible('Disposition', '50', '0'), true);
	assert.equal(speakerConditionValuesAreCompatible('Disposition', '50', '50'), true);
	assert.equal(speakerConditionValuesAreCompatible('Disposition', '0', '50'), true);
});

test('speaker condition matching keeps non-disposition filters exact', () => {
	assert.equal(speakerConditionValuesAreCompatible('ID', 'ABtv_TelMoraTrader', 'abtv_telmoratrader'), true);
	assert.equal(speakerConditionValuesAreCompatible('Journal', '50', '0'), false);
});

test('choice transition compatibility allows child disposition to exceed parent disposition', () => {
	const sourceRecord = {
		conditions: [],
		speakerConditions: [
			{ kind: 'speaker', displayText: 'Disposition: 0' },
		],
		resultActions: [],
	};
	const candidate = {
		conditions: [
			{ kind: 'choice', displayText: 'Choice = 1', choiceValue: 1 },
		],
		speakerConditions: [
			{ kind: 'speaker', displayText: 'Disposition: 90' },
		],
		resultActions: [],
	};

	assert.equal(conditionsCanFollowChoice(sourceRecord, candidate, 1), true);
});

test('numeric condition matching rejects incompatible exact journal stages', () => {
	assert.equal(
		numericConditionRangesAreCompatible(
			{ operator: '=', value: 101 },
			{ operator: '=', value: 102 },
		),
		false,
	);
});

test('numeric condition matching allows overlapping journal ranges', () => {
	assert.equal(
		numericConditionRangesAreCompatible(
			{ operator: '>=', value: 100 },
			{ operator: '=', value: 102 },
		),
		true,
	);
	assert.equal(
		numericConditionRangesAreCompatible(
			{ operator: '<', value: 102 },
			{ operator: '=', value: 102 },
		),
		false,
	);
});

test('selected quest journal filter matching rejects other quest filters', () => {
	assert.equal(
		hasSelectedQuestJournalFilter(
			[
				{ kind: 'speaker' },
				{ kind: 'journal', questId: 'HT_DahrkMezalf' },
			],
			['OAAB_TVos_SmokeskinWillpower'],
		),
		false,
	);
	assert.equal(
		hasSelectedQuestJournalFilter(
			[
				{ kind: 'journal', questId: 'OAAB_TVos_SmokeskinWillpower' },
			],
			['OAAB_TVos_SmokeskinWillpower'],
		),
		true,
	);
});

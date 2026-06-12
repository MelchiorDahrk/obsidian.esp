import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);
const {
	speakerConditionValuesAreCompatible,
} = jiti(resolve(here, '../src/features/quest-canvas-conditions.ts'));

test('speaker condition matching treats disposition as a minimum requirement', () => {
	assert.equal(speakerConditionValuesAreCompatible('Disposition', '50', '0'), true);
	assert.equal(speakerConditionValuesAreCompatible('Disposition', '50', '50'), true);
	assert.equal(speakerConditionValuesAreCompatible('Disposition', '0', '50'), false);
});

test('speaker condition matching keeps non-disposition filters exact', () => {
	assert.equal(speakerConditionValuesAreCompatible('ID', 'ABtv_TelMoraTrader', 'abtv_telmoratrader'), true);
	assert.equal(speakerConditionValuesAreCompatible('Journal', '50', '0'), false);
});

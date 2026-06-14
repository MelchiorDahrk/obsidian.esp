import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);
const { selectFirstQuestTreeAddTopicTargets } = jiti(resolve(here, '../src/features/quest-canvas-add-topic.ts'));

test('AddTopic target selection prefers the leftmost compatible quest-tree usage', () => {
	const targets = selectFirstQuestTreeAddTopicTargets([
		{ target: 'later same-topic quest branch', nodeId: 'later', x: -520, y: -447, score: 2 },
		{ target: 'first compatible topic intro', nodeId: 'intro', x: -520, y: -608, score: 3 },
		{ target: 'later terminal branch', nodeId: 'terminal', x: 6040, y: 22 },
	]);

	assert.deepEqual(targets, ['first compatible topic intro']);
});

test('AddTopic target selection keeps all compatible targets in the first quest-tree column', () => {
	const targets = selectFirstQuestTreeAddTopicTargets([
		{ target: 'first without book', nodeId: 'without-book', x: 7120, y: -435, score: 3 },
		{ target: 'later choice', nodeId: 'choice', x: 8700, y: -317 },
		{ target: 'first with book', nodeId: 'with-book', x: 7120, y: -153, score: 3 },
	]);

	assert.deepEqual(targets, ['first without book', 'first with book']);
});

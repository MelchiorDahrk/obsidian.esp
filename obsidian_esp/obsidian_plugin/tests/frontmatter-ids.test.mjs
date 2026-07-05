import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);
const {
	getFrontmatter,
	parseBasicFrontmatter,
} = jiti(resolve(here, '../src/utils/obsidian-utils.ts'));

test('parseBasicFrontmatter keeps DiagID and PrevID as exact strings', () => {
	const parsed = parseBasicFrontmatter(`---
Type: Greeting
Topic: Greeting 1
DiagID: 627526879390928526
PrevID: 20481194642735427051
---
`);

	assert.equal(parsed.DiagID, '627526879390928526');
	assert.equal(parsed.PrevID, '20481194642735427051');
});

test('getFrontmatter restores cached numeric DiagID and PrevID from raw frontmatter', async () => {
	const file = { path: 'Greeting/Greeting 1/Greeting 1 ~1.md' };
	const content = `---
Type: Greeting
Topic: Greeting 1
DiagID: 627526879390928526
PrevID: 20481194642735427051
Disposition: 0
---

Hello.
`;

	const app = {
		metadataCache: {
			getFileCache(candidate) {
				assert.equal(candidate, file);
				return {
					frontmatter: {
						Type: 'Greeting',
						Topic: 'Greeting 1',
						DiagID: 627526879390928500,
						PrevID: 20481194642735428000,
						Disposition: 0,
					},
				};
			},
		},
		vault: {
			async read(candidate) {
				assert.equal(candidate, file);
				return content;
			},
		},
	};

	const parsed = await getFrontmatter(app, file);

	assert.equal(parsed.DiagID, '627526879390928526');
	assert.equal(parsed.PrevID, '20481194642735427051');
	assert.equal(parsed.Type, 'Greeting');
	assert.equal(parsed.Disposition, 0);
});

/**
 * @file The shared Obsidian Bases definition for topic tables.
 *
 * Every project root gets one `base.base` file; each topic's index note
 * embeds a named view from it (`![[.../base.base#Topic View]]`) to show that
 * topic's responses as a sortable table. The file is plugin-owned: its
 * content is overwritten on every topic-link update, so user edits to it do
 * not survive. The Rust exporter's `is_generated_topic_index_file` recognizes
 * these embeds — keep the view names here in sync with that list.
 */
import { App, TFile, TFolder, normalizePath } from 'obsidian';

export const BASE_FILE_NAME = 'base.base';

/**
 * Canonical `base.base` content: shows sibling notes of the embedding index
 * file, with one identically-shaped table view per dialogue type.
 */
export const BASE_FILE_CONTENT = `filters:
  and:
    - file.inFolder(this.file.folder)
    - not:
        - file.path == this.file.path
properties:
  file.name:
    displayName: "File"
  DiagID:
    displayName: "Info ID"
  Disposition:
    displayName: "Disp"
  ID:
    displayName: "ID"
  Faction:
    displayName: "Faction"
  Cell:
    displayName: "Cell"
  Variable0:
    displayName: "Var 0"
  Variable1:
    displayName: "Var 1"
  Variable2:
    displayName: "Var 2"
  Variable3:
    displayName: "Var 3"
  Variable4:
    displayName: "Var 4"
  Variable5:
    displayName: "Var 5"
views:
  - type: table
    name: "Topic View"
    order:
      - file.name
      - DiagID
      - Disposition
      - ID
      - Faction
      - Cell
      - Variable0
      - Variable1
      - Variable2
      - Variable3
      - Variable4
      - Variable5
  - type: table
    name: "Greeting View"
    order:
      - file.name
      - DiagID
      - Disposition
      - ID
      - Faction
      - Cell
      - Variable0
      - Variable1
      - Variable2
      - Variable3
      - Variable4
      - Variable5
  - type: table
    name: "Journal View"
    order:
      - file.name
      - DiagID
      - Disposition
      - ID
      - Faction
      - Cell
      - Variable0
      - Variable1
      - Variable2
      - Variable3
      - Variable4
      - Variable5
  - type: table
    name: "Persuasion View"
    order:
      - file.name
      - DiagID
      - Disposition
      - ID
      - Faction
      - Cell
      - Variable0
      - Variable1
      - Variable2
      - Variable3
      - Variable4
      - Variable5
  - type: table
    name: "Voice View"
    order:
      - file.name
      - DiagID
      - Disposition
      - ID
      - Faction
      - Cell
      - Variable0
      - Variable1
      - Variable2
      - Variable3
      - Variable4
      - Variable5
`;

/**
 * Creates `base.base` in the folder, or rewrites it if its content has
 * drifted from the canonical definition above.
 */
export async function ensureBaseFileInFolder(
	app: App,
	folder: TFolder,
): Promise<void> {
	const path = normalizePath(`${folder.path}/${BASE_FILE_NAME}`);
	const existing = app.vault.getAbstractFileByPath(path);
	if (!existing) {
		await app.vault.create(path, BASE_FILE_CONTENT);
		return;
	}

	if (existing instanceof TFile) {
		const currentContent = await app.vault.read(existing);
		if (currentContent !== BASE_FILE_CONTENT) {
			await app.vault.modify(existing, BASE_FILE_CONTENT);
		}
	}
}

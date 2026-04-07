import { App, TFile, TFolder, normalizePath } from 'obsidian';

export const BASE_FILE_NAME = 'base.base';

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
`;

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

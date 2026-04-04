import { App, FuzzySuggestModal, TFolder } from 'obsidian';

export async function selectVaultFolder(app: App): Promise<TFolder | null> {
	return await new Promise((resolve) => {
		new FolderSuggestModal(app, resolve).open();
	});
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private resolved = false;
	private readonly folders: TFolder[];
	private readonly onResolve: (folder: TFolder | null) => void;

	constructor(app: App, onResolve: (folder: TFolder | null) => void) {
		super(app);
		this.onResolve = onResolve;
		this.folders = app.vault
			.getAllLoadedFiles()
			.filter(
				(file): file is TFolder =>
					file instanceof TFolder && file.path.length > 0,
			)
			.sort((left, right) => left.path.localeCompare(right.path));

		this.setTitle('Select a dialogue folder');
		this.setPlaceholder('Choose a folder to compile');
		this.setInstructions([
			{ command: 'Enter', purpose: 'Compile the selected folder' },
			{ command: 'Esc', purpose: 'Cancel' },
		]);
	}

	getItems(): TFolder[] {
		return this.folders;
	}

	getItemText(item: TFolder): string {
		return item.path;
	}

	onChooseItem(item: TFolder): void {
		this.resolved = true;
		this.onResolve(item);
	}

	onClose(): void {
		super.onClose();
		if (!this.resolved) {
			this.onResolve(null);
		}
	}
}

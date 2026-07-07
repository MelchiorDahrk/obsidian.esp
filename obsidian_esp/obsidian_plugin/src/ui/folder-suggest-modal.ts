/**
 * @file Vault folder picker modal.
 */
import { App, Modal, TFolder } from 'obsidian';

/**
 * Opens a searchable folder-picker modal and resolves with the chosen
 * folder, or `null` if the user dismisses the modal without picking.
 */
export async function selectVaultFolder(app: App): Promise<TFolder | null> {
	return await new Promise((resolve) => {
		new FolderSelectionModal(app, resolve).open();
	});
}

/**
 * Modal listing every folder in the vault with a text filter. Enter selects
 * the first match; results are capped at 200 rows to keep rendering fast in
 * large vaults.
 */
class FolderSelectionModal extends Modal {
	private resolved = false;
	private readonly folders: TFolder[];
	private readonly onResolve: (folder: TFolder | null) => void;
	private listEl!: HTMLDivElement;

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
	}

	onOpen(): void {
		this.setTitle('Select a dialogue folder');

		const searchInput = this.contentEl.createEl('input', {
			type: 'text',
			placeholder: 'Filter folders',
			attr: {
				'aria-label': 'Filter folders',
			},
		});
		searchInput.addClass('prompt-input');

		this.listEl = this.contentEl.createDiv();
		this.listEl.addClass('mod-community-modal-search-results');

		const renderFolders = (query: string) => {
			this.listEl.empty();

			const normalizedQuery = query.trim().toLowerCase();
			const matchingFolders = this.folders.filter((folder) =>
				normalizedQuery.length === 0
					? true
					: folder.path.toLowerCase().includes(normalizedQuery),
			);

			if (matchingFolders.length === 0) {
				this.listEl.createEl('p', {
					text: 'No folders match that filter.',
				});
				return;
			}

			for (const folder of matchingFolders.slice(0, 200)) {
				const button = this.listEl.createEl('button', {
					text: folder.path,
					cls: 'mod-community-modal-search-result',
					attr: {
						type: 'button',
						'aria-label': `Select folder ${folder.path}`,
					},
				});
				button.addEventListener('click', () => {
					this.chooseFolder(folder);
				});
			}
		};

		searchInput.addEventListener('input', () => {
			renderFolders(searchInput.value);
		});
		searchInput.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') {
				return;
			}

			const normalizedQuery = searchInput.value.trim().toLowerCase();
			const firstMatch = this.folders.find((folder) =>
				normalizedQuery.length === 0
					? true
					: folder.path.toLowerCase().includes(normalizedQuery),
			);

			if (!firstMatch) {
				return;
			}

			event.preventDefault();
			this.chooseFolder(firstMatch);
		});

		renderFolders('');
		searchInput.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.onResolve(null);
		}
	}

	private chooseFolder(folder: TFolder): void {
		this.resolved = true;
		this.close();
		this.onResolve(folder);
	}
}

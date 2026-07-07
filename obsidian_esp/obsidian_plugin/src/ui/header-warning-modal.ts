/**
 * @file Confirmation dialog for compiling without a `header.md`.
 */
import { App, Modal } from 'obsidian';

/**
 * Asks the user whether to compile a folder that has no `header.md`, falling
 * back to default header settings (Morrowind.esm master, ESP file type).
 * Resolves `true` to continue, `false` on cancel or dismissal.
 */
export async function confirmDefaultHeader(
	app: App,
	folderName: string,
): Promise<boolean> {
	return await new Promise((resolve) => {
		new HeaderWarningModal(app, folderName, resolve).open();
	});
}

/** Two-button (Continue/Cancel) modal backing {@link confirmDefaultHeader}. */
class HeaderWarningModal extends Modal {
	private resolved = false;
	private readonly folderName: string;
	private readonly onResolve: (confirmed: boolean) => void;

	constructor(
		app: App,
		folderName: string,
		onResolve: (confirmed: boolean) => void,
	) {
		super(app);
		this.folderName = folderName;
		this.onResolve = onResolve;
	}

	onOpen(): void {
		this.setTitle('Missing header.md');

		this.contentEl.createEl('p', {
			text: `No header.md file was found directly inside "${this.folderName}".`,
		});

		const details = this.contentEl.createEl('p');
		details.appendText('Continue with the default header settings. This uses ');
		details.createEl('code', { text: 'Morrowind.esm' });
		details.appendText(' as the master, ');
		details.createEl('code', { text: '.esp' });
		details.appendText(' as the file type, ');
		details.createEl('code', { text: '1.3' });
		details.appendText(' as the version, and blank header fields.');

		const buttonRow = this.contentEl.createDiv({
			cls: 'modal-button-container',
		});

		const continueButton = buttonRow.createEl('button', {
			text: 'Continue',
			cls: 'mod-cta',
			attr: {
				type: 'button',
				'aria-label': 'Continue with default header settings',
			},
		});
		continueButton.addEventListener('click', () => {
			this.resolved = true;
			this.onResolve(true);
			this.close();
		});

		const cancelButton = buttonRow.createEl('button', {
			text: 'Cancel',
			attr: {
				type: 'button',
				'aria-label': 'Cancel compiling this folder',
			},
		});
		cancelButton.addEventListener('click', () => {
			this.resolved = true;
			this.onResolve(false);
			this.close();
		});

		continueButton.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.onResolve(false);
		}
	}
}

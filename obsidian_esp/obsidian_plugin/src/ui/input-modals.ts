/**
 * @file Small reusable prompt modals for the dialogue-creation commands.
 *
 * `promptForText` collects a free-text name (new Topic / Journal). `promptFromList`
 * lets the user pick one entry from a fixed set (Greeting numbers, Voice types);
 * already-present choices can be marked disabled so the user still sees them but
 * cannot re-create them.
 */
import { App, Modal } from 'obsidian';

/**
 * Opens a single-line text prompt. Resolves with the trimmed value, or `null`
 * if the user cancels or submits an empty string.
 */
export async function promptForText(
	app: App,
	options: { title: string; placeholder?: string; initialValue?: string; cta?: string },
): Promise<string | null> {
	return await new Promise((resolve) => {
		new TextPromptModal(app, options, resolve).open();
	});
}

/** One selectable option in a {@link promptFromList} picker. */
export interface ListChoice {
	value: string;
	/** Optional display label; defaults to `value`. */
	label?: string;
	/** When true, the row is shown but cannot be chosen. */
	disabled?: boolean;
	/** Optional muted hint rendered after the label (e.g. "already exists"). */
	hint?: string;
}

/**
 * Opens a picker over a fixed list of choices. Resolves with the chosen
 * `value`, or `null` if the user dismisses the modal.
 */
export async function promptFromList(
	app: App,
	options: { title: string; choices: ListChoice[] },
): Promise<string | null> {
	return await new Promise((resolve) => {
		new ListPromptModal(app, options, resolve).open();
	});
}

class TextPromptModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly options: { title: string; placeholder?: string; initialValue?: string; cta?: string },
		private readonly onResolve: (value: string | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.options.title);

		const input = this.contentEl.createEl('input', {
			type: 'text',
			placeholder: this.options.placeholder ?? '',
			attr: { 'aria-label': this.options.title },
		});
		input.addClass('prompt-input');
		if (this.options.initialValue) {
			input.value = this.options.initialValue;
		}

		const buttonRow = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const submitButton = buttonRow.createEl('button', {
			text: this.options.cta ?? 'Create',
			cls: 'mod-cta',
			attr: { type: 'button' },
		});
		const cancelButton = buttonRow.createEl('button', {
			text: 'Cancel',
			attr: { type: 'button' },
		});

		const submit = () => {
			const value = input.value.trim();
			if (value.length === 0) {
				return;
			}
			this.finish(value);
		};

		submitButton.addEventListener('click', submit);
		cancelButton.addEventListener('click', () => this.close());
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				submit();
			}
		});

		input.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.onResolve(null);
		}
	}

	private finish(value: string): void {
		this.resolved = true;
		this.close();
		this.onResolve(value);
	}
}

class ListPromptModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly options: { title: string; choices: ListChoice[] },
		private readonly onResolve: (value: string | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.options.title);

		const listEl = this.contentEl.createDiv({ cls: 'mod-community-modal-search-results' });
		for (const choice of this.options.choices) {
			const button = listEl.createEl('button', {
				cls: 'mod-community-modal-search-result',
				attr: { type: 'button', 'aria-label': choice.label ?? choice.value },
			});
			button.createSpan({ text: choice.label ?? choice.value });
			if (choice.hint) {
				button.createSpan({ text: ` ${choice.hint}`, cls: 'esp-list-choice-hint' });
			}
			if (choice.disabled) {
				button.disabled = true;
				button.addClass('is-disabled');
				continue;
			}
			button.addEventListener('click', () => this.finish(choice.value));
		}
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.onResolve(null);
		}
	}

	private finish(value: string): void {
		this.resolved = true;
		this.close();
		this.onResolve(value);
	}
}

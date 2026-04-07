import { App, Modal, Notice } from 'obsidian';

export interface PropertyExtractionOptions {
	include_factions: boolean;
	include_races: boolean;
	include_classes: boolean;
	include_ids: boolean;
	include_cells: boolean;
}

export interface PropertyGenerationSelection {
	selectedMasters: string[];
	options: PropertyExtractionOptions;
}

const DEFAULT_OPTIONS: PropertyExtractionOptions = {
	include_factions: true,
	include_races: true,
	include_classes: true,
	include_ids: true,
	include_cells: true,
};

export async function selectPropertyGenerationOptions(
	app: App,
	masterNames: string[],
): Promise<PropertyGenerationSelection | null> {
	return await new Promise((resolve) => {
		new PropertyGenerationModal(app, masterNames, resolve).open();
	});
}

class PropertyGenerationModal extends Modal {
	private resolved = false;
	private readonly masterStates = new Map<string, boolean>();
	private readonly options: PropertyExtractionOptions = {
		...DEFAULT_OPTIONS,
	};
	private readonly onResolve: (
		selection: PropertyGenerationSelection | null,
	) => void;

	constructor(
		app: App,
		masterNames: string[],
		onResolve: (selection: PropertyGenerationSelection | null) => void,
	) {
		super(app);
		this.onResolve = onResolve;

		for (const masterName of masterNames) {
			this.masterStates.set(masterName, true);
		}
	}

	onOpen(): void {
		this.setTitle('Generate property files');

		this.contentEl.createEl('p', {
			text: 'Select which masters to read and which values to include in the generated property notes.',
		});

		this.renderMasterSection();
		this.renderOptionSection();

		const buttonRow = this.contentEl.createDiv({
			cls: 'modal-button-container',
		});

		const generateButton = buttonRow.createEl('button', {
			text: 'Generate files',
			cls: 'mod-cta',
			attr: {
				type: 'button',
				'aria-label': 'Generate property files',
			},
		});
		generateButton.addEventListener('click', () => {
			this.submit();
		});

		const cancelButton = buttonRow.createEl('button', {
			text: 'Cancel',
			attr: {
				type: 'button',
				'aria-label': 'Cancel generating property files',
			},
		});
		cancelButton.addEventListener('click', () => {
			this.resolved = true;
			this.onResolve(null);
			this.close();
		});

		generateButton.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.onResolve(null);
		}
	}

	private renderMasterSection(): void {
		const section = this.contentEl.createDiv({
			cls: 'esp-property-generation-section',
		});
		section.createEl('h3', { text: 'Masters' });

		const actions = section.createDiv({
			cls: 'esp-property-generation-actions',
		});
		this.createActionButton(actions, 'Select all', () => {
			for (const masterName of this.masterStates.keys()) {
				this.masterStates.set(masterName, true);
			}
			this.refresh();
		});
		this.createActionButton(actions, 'Clear all', () => {
			for (const masterName of this.masterStates.keys()) {
				this.masterStates.set(masterName, false);
			}
			this.refresh();
		});

		const list = section.createDiv({
			cls: 'esp-property-generation-list',
		});
		for (const masterName of this.masterStates.keys()) {
			this.createCheckboxRow(
				list,
				masterName,
				this.masterStates.get(masterName) ?? false,
				(checked) => {
					this.masterStates.set(masterName, checked);
				},
			);
		}
	}

	private renderOptionSection(): void {
		const section = this.contentEl.createDiv({
			cls: 'esp-property-generation-section',
		});
		section.createEl('h3', { text: 'Values from masters' });

		const list = section.createDiv({
			cls: 'esp-property-generation-list',
		});
		this.createCheckboxRow(
			list,
			'Factions',
			this.options.include_factions,
			(checked) => {
				this.options.include_factions = checked;
			},
		);
		this.createCheckboxRow(
			list,
			'Races',
			this.options.include_races,
			(checked) => {
				this.options.include_races = checked;
			},
		);
		this.createCheckboxRow(
			list,
			'Classes',
			this.options.include_classes,
			(checked) => {
				this.options.include_classes = checked;
			},
		);
		this.createCheckboxRow(
			list,
			'NPC and creature IDs',
			this.options.include_ids,
			(checked) => {
				this.options.include_ids = checked;
			},
		);
		this.createCheckboxRow(
			list,
			'Cells',
			this.options.include_cells,
			(checked) => {
				this.options.include_cells = checked;
			},
		);
	}

	private createActionButton(
		containerEl: HTMLDivElement,
		label: string,
		onClick: () => void,
	): void {
		const button = containerEl.createEl('button', {
			text: label,
			attr: {
				type: 'button',
			},
		});
		button.addClass('esp-property-generation-action');
		button.addEventListener('click', onClick);
	}

	private createCheckboxRow(
		containerEl: HTMLDivElement,
		label: string,
		checked: boolean,
		onChange: (checked: boolean) => void,
	): void {
		const row = containerEl.createEl('label', {
			cls: 'esp-property-generation-row',
		});

		const checkbox = row.createEl('input', {
			type: 'checkbox',
			attr: {
				'aria-label': label,
			},
		});
		checkbox.checked = checked;
		checkbox.addEventListener('change', () => {
			onChange(checkbox.checked);
		});

		row.createSpan({
			text: label,
			cls: 'esp-property-generation-label',
		});
	}

	private refresh(): void {
		this.contentEl.empty();
		this.onOpen();
	}

	private submit(): void {
		const selectedMasters = [...this.masterStates.entries()]
			.filter(([, checked]) => checked)
			.map(([masterName]) => masterName);

		if (selectedMasters.length === 0) {
			new Notice('Select at least one master file.');
			return;
		}

		this.resolved = true;
		this.onResolve({
			selectedMasters,
			options: { ...this.options },
		});
		this.close();
	}
}

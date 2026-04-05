/**
 * DatabaseView — an Obsidian ItemView that displays TES3 object data
 * in a virtualized table pane.
 *
 * Opened from the status bar context menu. Receives its data via the
 * plugin instance and renders it using VirtualTable.
 */
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { VirtualTable, type VirtualTableColumn } from './virtual-table';
import type { ActivatorRecord, GameDatabase } from '../database/game-database';

export const DATABASE_VIEW_TYPE = 'esp-database-view';

export class DatabaseView extends ItemView {
	private table: VirtualTable<ActivatorRecord> | null = null;
	private db: GameDatabase | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return DATABASE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Database explorer';
	}

	getIcon(): string {
		return 'database';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('esp-database-view');

		if (!this.db) {
			container.createEl('p', {
				text: 'No database loaded. Load a plugin file first.',
				cls: 'esp-vt-empty',
			});
			return;
		}

		this.renderActivators(container);
	}

	async onClose(): Promise<void> {
		this.table?.destroy();
		this.table = null;
	}

	/** Called by the plugin before the view opens. */
	setDatabase(db: GameDatabase): void {
		this.db = db;
	}

	// -------------------------------------------------------------------
	// Table rendering
	// -------------------------------------------------------------------

	private renderActivators(container: HTMLElement): void {
		if (!this.db) return;

		const activators = this.db.getActivators();

		// Toolbar showing the record count.
		const toolbar = container.createDiv({ cls: 'esp-vt-toolbar' });
		toolbar.createSpan({
			text: `Activators — ${activators.length.toLocaleString()} records`,
			cls: 'esp-vt-toolbar-title',
		});

		// Column definitions for Activator records.
		const columns: VirtualTableColumn<ActivatorRecord>[] = [
			{
				id: 'id',
				label: 'ID',
				flex: '2',
				getValue: (r) => r.id,
			},
			{
				id: 'name',
				label: 'Name',
				flex: '2',
				getValue: (r) => r.name,
			},
			{
				id: 'mesh',
				label: 'Mesh',
				flex: '3',
				getValue: (r) => r.mesh,
			},
			{
				id: 'script',
				label: 'Script',
				flex: '2',
				getValue: (r) => r.script,
			},
		];

		this.table = new VirtualTable(container, {
			columns,
			data: activators,
			rowHeight: 32,
		});
	}
}

/**
 * VirtualTable — a generic, high-performance virtualized table for Obsidian.
 *
 * Renders only the rows visible in the viewport plus a small overscan buffer.
 * Row DOM nodes are recycled on scroll: their content is updated in-place
 * rather than creating/destroying elements.
 *
 * Design borrows from a proven OpenMW virtual list implementation:
 *   - Fixed slot pool (visible rows + overscan), never added/removed on scroll
 *   - Range diffing: only slots whose data index changed are re-rendered
 *   - Normalized scroll math with consistent rounding
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Describes a single column in the table. */
export interface VirtualTableColumn<T> {
	/** Unique key for this column (used as a CSS class suffix). */
	id: string;
	/** Header label text. */
	label: string;
	/** CSS flex value for column width (e.g. "1", "2", "0 0 200px"). */
	flex?: string;
	/** Extracts the display string for this column from a data row. */
	getValue: (item: T) => string;
}

/** Everything the table needs to render. */
export interface VirtualTableConfig<T> {
	/** Column definitions. */
	columns: VirtualTableColumn<T>[];
	/** The full dataset (array of row objects). */
	data: T[];
	/** Height of each row in pixels. Must be constant. */
	rowHeight: number;
	/** Number of extra rows rendered above/below the viewport. */
	overscan?: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface VisibleRange {
	start: number;
	stop: number;
}

interface Slot {
	/** The root <div> for this row. */
	el: HTMLElement;
	/** Cell elements, one per column. */
	cells: HTMLElement[];
	/** The data index this slot currently displays (-1 = unassigned). */
	dataIndex: number;
}

// ---------------------------------------------------------------------------
// VirtualTable
// ---------------------------------------------------------------------------

export class VirtualTable<T> {
	// Config
	private columns: VirtualTableColumn<T>[];
	private data: T[];
	private readonly rowHeight: number;
	private readonly overscan: number;

	// DOM
	private root: HTMLElement;
	private body: HTMLElement;
	private content: HTMLElement;
	private slots: Slot[] = [];

	// State
	private visibleRange: VisibleRange = { start: 0, stop: -1 };
	private scrollHandler: () => void;

	constructor(container: HTMLElement, config: VirtualTableConfig<T>) {
		this.columns = config.columns;
		this.data = config.data;
		this.rowHeight = config.rowHeight;
		this.overscan = config.overscan ?? 5;

		// Build the DOM skeleton.
		this.root = container.createDiv({ cls: 'esp-vt' });
		this.body = this.root.createDiv({ cls: 'esp-vt-body' });
		this.content = this.body.createDiv({ cls: 'esp-vt-content' });
		this.buildHeader();

		// Scroll listener (kept as a bound reference for cleanup).
		this.scrollHandler = () => this.onScroll();
		this.body.addEventListener('scroll', this.scrollHandler, {
			passive: true,
		});

		// Initial render.
		this.rebuild();
	}

	// -------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------

	/** Replace the dataset and re-render from scratch. */
	setData(data: T[]): void {
		this.data = data;
		this.rebuild();
	}

	/** Remove event listeners and clear DOM. */
	destroy(): void {
		this.body.removeEventListener('scroll', this.scrollHandler);
		this.root.remove();
	}

	// -------------------------------------------------------------------
	// DOM construction
	// -------------------------------------------------------------------

	/** Creates the fixed header row. */
	private buildHeader(): void {
		const header = this.content.createDiv({ cls: 'esp-vt-header' });
		for (const col of this.columns) {
			const cell = header.createDiv({
				cls: `esp-vt-header-cell esp-vt-col-${col.id}`,
				text: col.label,
			});
			if (col.flex) cell.style.flex = col.flex;
		}
	}

	/** Creates a single row slot (a row div with one cell per column). */
	private createSlot(): Slot {
		const el = this.content.createDiv({ cls: 'esp-vt-row' });
		el.style.height = `${this.rowHeight}px`;
		el.style.position = 'absolute';
		el.style.top = '0';
		el.style.left = '0';
		el.style.right = '0';

		const cells: HTMLElement[] = [];
		for (const col of this.columns) {
			const cell = el.createDiv({
				cls: `esp-vt-cell esp-vt-col-${col.id}`,
			});
			if (col.flex) cell.style.flex = col.flex;
			cells.push(cell);
		}

		return { el, cells, dataIndex: -1 };
	}

	// -------------------------------------------------------------------
	// Data / slot management
	// -------------------------------------------------------------------

	/**
	 * Full rebuild: resize the content spacer, create/remove slots to match
	 * the viewport, and populate visible rows.
	 */
	private rebuild(): void {
		const totalHeight = (this.data.length + 1) * this.rowHeight;
		this.content.style.height = `${totalHeight}px`;

		// How many slots do we need?
		const viewportHeight = this.body.clientHeight || 600;
		const visibleCount = Math.ceil(viewportHeight / this.rowHeight);
		const needed = Math.min(
			visibleCount + 1 + this.overscan * 2,
			this.data.length,
		);

		// Add or remove slots to match.
		while (this.slots.length < needed) {
			this.slots.push(this.createSlot());
		}
		while (this.slots.length > needed) {
			const removed = this.slots.pop();
			removed?.el.remove();
		}

		// Reset all slot assignments and scroll to top.
		for (const slot of this.slots) {
			slot.dataIndex = -1;
		}
		this.visibleRange = { start: 0, stop: -1 };
		this.body.scrollTop = 0;
		this.syncVisibleItems();
	}

	// -------------------------------------------------------------------
	// Scroll handling
	// -------------------------------------------------------------------

	/** Respond to the scroll container's scroll event. */
	private onScroll(): void {
		this.syncVisibleItems();
	}

	/**
	 * Core virtualisation logic. Computes which data indices are visible,
	 * compares against the current range, and only re-renders changed slots.
	 *
	 * This mirrors the `syncVisibleItems` / `calcVisibleRange` pattern from
	 * the OpenMW virtual list — the range size stays constant, and we diff
	 * old vs. new to minimise DOM writes.
	 */
	private syncVisibleItems(): void {
		if (this.data.length === 0 || this.slots.length === 0) return;

		const newRange = this.calcVisibleRange();

		// Assign each slot a data index within the new range.
		for (let i = 0; i < this.slots.length; i++) {
			const slot = this.slots[i]!;
			const dataIndex = newRange.start + i;

			if (dataIndex > newRange.stop) {
				// More slots than data rows — hide extras.
				slot.el.style.display = 'none';
				slot.dataIndex = -1;
				continue;
			}

			slot.el.style.display = '';

			if (slot.dataIndex !== dataIndex) {
				this.renderSlot(slot, dataIndex);
			}
		}

		this.visibleRange = newRange;
	}

	/** Calculate which data indices should be visible right now. */
	private calcVisibleRange(): VisibleRange {
		const scrollTop = this.body.scrollTop;
		const viewportHeight = this.body.clientHeight;

		// Offset math by 1 row height to account for the sticky header in content.
		let start =
			Math.floor(Math.max(0, scrollTop - this.rowHeight) / this.rowHeight) -
			this.overscan;
		let stop =
			Math.ceil(Math.max(0, scrollTop + viewportHeight - this.rowHeight) / this.rowHeight) +
			this.overscan;

		// Clamp to data bounds.
		start = Math.max(0, start);
		stop = Math.min(this.data.length - 1, stop);

		// Keep range size consistent with slot count.
		const maxRange = this.slots.length - 1;
		if (stop - start > maxRange) {
			stop = start + maxRange;
		}

		return { start, stop };
	}

	/** Update a slot's DOM to reflect the data at `dataIndex`. */
	private renderSlot(slot: Slot, dataIndex: number): void {
		slot.dataIndex = dataIndex;
		slot.el.style.transform = `translateY(${(dataIndex + 1) * this.rowHeight}px)`;
		slot.el.dataset.index = String(dataIndex);

		const item = this.data[dataIndex]!;
		for (let c = 0; c < this.columns.length; c++) {
			slot.cells[c]!.textContent = this.columns[c]!.getValue(item);
		}
	}
}

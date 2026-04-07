import { Notice } from 'obsidian';

export class ProgressBar {
	private notice: Notice;
	private barInner: HTMLElement;
	private label: HTMLElement;

	constructor(title: string) {
		this.notice = new Notice('', 0);
		// Add a class for styling if needed, but we'll use inline styles for now as per main.ts pattern
		const progressEl = this.notice.noticeEl.createDiv();
		const titleEl = progressEl.createDiv();
		titleEl.style.fontWeight = 'var(--font-bold)';
		titleEl.setText(title);

		const barOuter = progressEl.createDiv();
		barOuter.style.cssText =
			'width:100%;height:6px;background:var(--background-modifier-border);border-radius:3px;margin-top:8px;';

		this.barInner = barOuter.createDiv();
		this.barInner.style.cssText =
			'width:0%;height:100%;background:var(--interactive-accent);border-radius:3px;transition:width 0.15s;';

		this.label = progressEl.createDiv();
		this.label.style.marginTop = '6px';
		this.label.style.fontSize = 'var(--font-ui-smaller)';
		this.label.style.color = 'var(--text-muted)';
	}

	update(percent: number, message: string) {
		const clampedPercent = Math.min(100, Math.max(0, percent));
		this.barInner.style.width = `${clampedPercent}%`;
		this.label.setText(message);
	}

	hide() {
		this.notice.hide();
	}
}

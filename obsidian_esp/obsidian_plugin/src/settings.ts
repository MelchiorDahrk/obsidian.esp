import { App, PluginSettingTab, Setting } from 'obsidian';
import ObsidianEsp from './main';

/**
 * Configuration options for the Obsidian.esp plugin.
 */
export interface ObsidianEspSettings {
	/** Vault folder where unpacked plugin files are written. */
	outputFolder: string;
	/** Hide the frontmatter properties table inside canvas file embeds. */
	hideCanvasProperties: boolean;
	/** Add a `canvas:` backlink to related notes when generating quest canvases. */
	writeCanvasBacklinks: boolean;
}

export const DEFAULT_SETTINGS: ObsidianEspSettings = {
	outputFolder: 'TES3 Plugins',
	hideCanvasProperties: true,
	writeCanvasBacklinks: false,
};

/**
 * UI tab in the Obsidian settings window for configuring the plugin.
 */
export class ObsidianEspSettingTab extends PluginSettingTab {
	plugin: ObsidianEsp;

	constructor(app: App, plugin: ObsidianEsp) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Output folder')
			.setDesc(
				'Vault folder where unpacked plugin files are written.',
			)
			.addText((text) =>
				text
					.setPlaceholder('TES3 Plugins')
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Hide properties in canvas cards')
			.setDesc(
				'Hide the frontmatter properties table inside canvas file embeds. Applies to all canvases while enabled.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideCanvasProperties)
					.onChange(async (value) => {
						this.plugin.settings.hideCanvasProperties = value;
						this.plugin.applyCanvasPropertyVisibility();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Write canvas backlinks')
			.setDesc(
				'Add a canvas link to the frontmatter of related notes when generating quest canvases. When off, generation never modifies notes.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.writeCanvasBacklinks)
					.onChange(async (value) => {
						this.plugin.settings.writeCanvasBacklinks = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}

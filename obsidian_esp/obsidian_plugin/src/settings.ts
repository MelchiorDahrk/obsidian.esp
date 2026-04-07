import { App, PluginSettingTab, Setting } from 'obsidian';
import ObsidianEsp from './main';

/**
 * Configuration options for the Obsidian.esp plugin.
 */
export interface ObsidianEspSettings {
	/** Vault folder where unpacked plugin files are written. */
	outputFolder: string;
}

export const DEFAULT_SETTINGS: ObsidianEspSettings = {
	outputFolder: 'TES3 Plugins',
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
	}
}

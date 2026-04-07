import { App, PluginSettingTab, Setting } from 'obsidian';
import ObsidianEsp from './main';

export interface ObsidianEspSettings {
	outputFolder: string;
}

export const DEFAULT_SETTINGS: ObsidianEspSettings = {
	outputFolder: 'TES3 Plugins',
};

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

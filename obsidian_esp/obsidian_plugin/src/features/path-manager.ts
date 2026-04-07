import { normalizePath, TFile, TFolder } from 'obsidian';

export enum MorrowindRecordType {
    Header = 'Header',
    Topic = 'Topic',
    Greeting = 'Greeting',
    Persuasion = 'Persuasion',
    Journal = 'Journal',
}

export class PathManager {
    constructor(private outputFolder: string) {}

    /**
     * Returns the root folder for a specific plugin export.
     */
    getPluginDir(pluginName: string): string {
        const baseName = pluginName.replace(/\.[^.]+$/, '');
        return normalizePath(`${this.outputFolder}/${baseName}`);
    }

    /**
     * Returns the path to a specific record type folder within a plugin.
     */
    getRecordTypeDir(pluginName: string, type: MorrowindRecordType): string {
        return normalizePath(`${this.getPluginDir(pluginName)}/${type}`);
    }

    /**
     * Returns the path to a specific topic folder.
     */
    getTopicDir(pluginName: string, topicName: string): string {
        return normalizePath(`${this.getRecordTypeDir(pluginName, MorrowindRecordType.Topic)}/${topicName}`);
    }

    /**
     * Returns the relative path for a file within the plugin directory.
     */
    getRelativePath(pluginName: string, file: TFile): string {
        const pluginDir = this.getPluginDir(pluginName);
        if (file.path.startsWith(pluginDir)) {
            return file.path.substring(pluginDir.length + 1);
        }
        return file.path;
    }

    /**
     * Determines if a folder is a plugin root by checking for header.md.
     */
    static isPluginRoot(folder: TFolder): boolean {
        const headerPath = normalizePath(`${folder.path}/header.md`);
        return folder.vault.getAbstractFileByPath(headerPath) instanceof TFile;
    }

    /**
     * Navigates up the folder hierarchy to find the plugin root.
     */
    static findPluginRoot(folder: TFolder): TFolder | null {
        let current: TFolder | null = folder;
        while (current) {
            if (this.isPluginRoot(current)) return current;
            current = current.parent;
        }
        return null;
    }

    /**
     * Resolves a list of relative project paths to absolute vault paths for a specific plugin.
     */
    resolveAbsolutePaths(pluginName: string, files: [string, string][]): [string, string][] {
        const root = this.getPluginDir(pluginName);
        return files.map(([relativePath, content]) => [
            normalizePath(`${root}/${relativePath}`),
            content
        ]);
    }
}

import { App, Notice, normalizePath, TFolder } from 'obsidian';
import { GameDatabase, extractMasterNames } from './game-database';
import { loadValidationMasters } from '../features/master-files';
import { parseMastersInParallel } from './parallel-loader';
import { ProgressBar } from '../ui/progress-bar';

export interface LoadResult {
    db: GameDatabase;
    messages: string[];
}

/**
 * Orchestrates the loading of a TES3 plugin file, including master resolution and parallel parsing.
 */
export class DatabaseLoader {
    constructor(
        private app: App,
        private manifestDir: string
    ) {}

    /**
     * Loads a plugin file from the disk. 
     * If the file specifies masters (Morrowind.esm, etc), it attempts to locate and parse them 
     * in parallel to provide a fully resolved view of the game data.
     * 
     * @param file The ESP/ESM file to load.
     * @returns A Promise resolving to the loaded GameDatabase and any status messages.
     */
    async load(file: File): Promise<LoadResult> {
        const progress = new ProgressBar(`Loading database: ${file.name}`);
        progress.update(0, 'Reading file...');

        try {
            // Step 1: Read the binary content of the plugin
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            progress.update(20, 'Scanning for masters...');

            // Step 2: Extract master names from the binary header
            let masterNames: string[];
            try {
                masterNames = extractMasterNames(bytes);
            } catch {
                masterNames = [];
            }

            const messages: string[] = [];
            let db: GameDatabase | null = null;

            // Step 3: If masters are found, resolve and parse them
            if (masterNames.length > 0) {
                progress.update(30, 'Loading masters...');
                
                // Locate and read master files from the configured OpenMW directories
                const { masters, messages: masterMessages } = await loadValidationMasters(
                    masterNames,
                    (current, total, name) => {
                        const masterPct = 30 + (current / total) * 50; // 30% to 80%
                        progress.update(masterPct, `Loading master: ${name}`);
                    },
                );
                messages.push(...masterMessages);

                if (masters.length > 0) {
                    progress.update(80, 'Parsing masters in parallel...');
                    const wasmPath = normalizePath(`${this.manifestDir}/pkg/obsidian_esp_bg.wasm`);
                    const workerPath = normalizePath(`${this.manifestDir}/worker.js`);
                    
                    // Use Web Workers to parse large master files (like Morrowind.esm) concurrently
                    const preparsed = await parseMastersInParallel(
                        this.app,
                        wasmPath,
                        workerPath,
                        masters,
                        (current, total, active) => {
                            const pct = 80 + (current / total) * 10; // 80% to 90%
                            const activeLabel = active.length > 0 ? ` (Parsing: ${active.join(', ')})` : '';
                            progress.update(pct, `Parsed ${current} / ${total} masters${activeLabel}`);
                        },
                    );

                    progress.update(90, 'Merging database...');
                    // Merge the preparsed master records with the target plugin data in WASM
                    db = GameDatabase.loadWithPreparsedMasters(bytes, file.name, preparsed);
                }
            }

            // Step 4: Fallback to standalone load if no masters or resolution failed
            if (!db) {
                progress.update(90, 'Parsing database...');
                db = GameDatabase.load(bytes, file.name);
            }

            progress.update(100, 'Done!');
            return { db, messages };
        } catch (error) {
            progress.update(100, 'Failed');
            throw error;
        }
    }
}

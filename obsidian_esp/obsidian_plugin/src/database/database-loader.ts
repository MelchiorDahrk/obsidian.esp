/**
 * @file High-level database loading workflow with progress reporting.
 *
 * Sits between the UI (`DatabaseManager`) and the lower layers: reads the
 * picked file, sniffs its master list from the raw header, locates the
 * masters on disk via the OpenMW configuration, and drives
 * {@link GameDatabase.load} while updating a {@link ProgressBar}.
 */
import { App } from 'obsidian';
import { GameDatabase } from './game-database';
import { loadValidationMasters } from '../features/master-files';
import { ProgressBar } from '../ui/progress-bar';
import { extractMasterNamesFromPluginBytes } from './header-parser';

/** Outcome of a load: the database handle plus user-facing status messages. */
export interface LoadResult {
    db: GameDatabase;
    /** Warnings collected along the way (missing masters, ingress anomalies). */
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

            // Step 2: Extract master names from the binary header without crossing into WASM
            let masterNames: string[];
            try {
                masterNames = extractMasterNamesFromPluginBytes(bytes);
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
                        const masterPct = 30 + (current / total) * 35; // 30% to 65%
                        progress.update(masterPct, `Loading master: ${name}`);
                    },
                );
                messages.push(...masterMessages);

                if (masters.length > 0) {
                    progress.update(65, 'Parsing masters in parallel...');
                    const { db: loadedDb } = await GameDatabase.load(
                        this.app,
                        this.manifestDir,
                        bytes,
                        file.name,
                        masters,
                        (completed, total) => {
                            const pct = 65 + (completed / total) * 20; // 65% to 85%
                            progress.update(pct, `Parsing masters: ${completed}/${total}`);
                        },
                    );
                    db = loadedDb;
                    progress.update(85, 'Loading database in worker...');
                }
            }

            // Step 4: Fallback to standalone load if no masters or resolution failed
            if (!db) {
                progress.update(90, 'Loading database in worker...');
                const { db: loadedDb, ingressCount } = await GameDatabase.load(
                    this.app,
                    this.manifestDir,
                    bytes,
                    file.name,
                    [],
                );
                db = loadedDb;

                if (ingressCount !== 1) {
                    messages.push(
                        `Expected 1 JS->WASM byte ingress operation during database load, but observed ${ingressCount}.`,
                    );
                }
            }

            progress.update(100, 'Done!');
            return { db, messages };
        } catch (error) {
            progress.update(100, 'Failed');
            throw error;
        } finally {
            try {
                progress.hide();
            } catch {
                // best-effort: ignore hide failures
            }
        }
    }
}

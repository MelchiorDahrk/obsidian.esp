/**
 * @file Parallel master-file parsing.
 *
 * Coordinates a pool of short-lived Web Workers (one per master, see
 * `worker.ts`'s `parseMaster` role) so that large masters like Morrowind.esm
 * parse concurrently instead of serially in the merge worker.
 */
import { App, normalizePath } from 'obsidian';
import { MasterFile } from '../features/master-files';

/**
 * Parses each master file into a TES3 record array using one worker per
 * master, all running concurrently.
 *
 * Each worker gets its own copy of the WASM binary (`wasmBuffer.slice(0)`)
 * because transferring would detach the buffer needed by the next worker;
 * the master bytes themselves *are* transferred since each is used once.
 *
 * @param wasmPath Vault-relative path to the compiled WASM binary.
 * @param workerPath Vault-relative path to the bundled worker script.
 * @param onProgress Reports completed count and which masters are in flight.
 * @returns Parsed record arrays in the same order as `masters`, ready for
 *   `GameDatabase.loadWithPreparsedMasters` on the merge worker.
 */
export async function parseMastersInParallel(
	app: App,
	wasmPath: string,
	workerPath: string,
	masters: MasterFile[],
	onProgress?: (completed: number, total: number, activeNames: string[]) => void,
): Promise<any[]> {
	if (masters.length === 0) return [];

	const wasmBuffer = await app.vault.adapter.readBinary(wasmPath);
	const workerScript = await app.vault.adapter.read(workerPath);
	const workerBlob = new Blob([workerScript], {
		type: 'application/javascript',
	});
	const workerUrl = URL.createObjectURL(workerBlob);

	let completed = 0;
	const total = masters.length;
	const active = new Set<string>();

	try {
		const results = await Promise.all(
			masters.map(([name, masterBytes]) => {
				active.add(name);
				if (onProgress) onProgress(completed, total, [...active]);

				return new Promise<any>((resolve, reject) => {
					const worker = new Worker(workerUrl);
					worker.onmessage = (e) => {
						active.delete(name);
						if (e.data.ok) {
							completed++;
							if (onProgress) onProgress(completed, total, [...active]);
							resolve(e.data.result);
						} else {
							if (onProgress) onProgress(completed, total, [...active]);
							reject(new Error(`Worker failed for ${name}: ${e.data.error}`));
						}
						worker.terminate();
					};
					worker.onerror = (e) => {
						active.delete(name);
						if (onProgress) onProgress(completed, total, [...active]);
						reject(new Error(`Worker error for ${name}: ${e.message}`));
						worker.terminate();
					};
					worker.postMessage(
						{
							id: 1,
							method: 'parseMaster',
							params: { wasmBuffer, masterBytes },
						},
						[wasmBuffer.slice(0), masterBytes.buffer as ArrayBuffer],
					);
				});
			}),
		);
		return results;
	} finally {
		URL.revokeObjectURL(workerUrl);
	}
}

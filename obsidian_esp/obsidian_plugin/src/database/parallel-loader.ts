import { App, normalizePath } from 'obsidian';
import { MasterFile } from '../features/master-files';

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
						if (e.data.success) {
							completed++;
							if (onProgress) onProgress(completed, total, [...active]);
							resolve(e.data.objects);
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
							wasmBuffer,
							masterBytes,
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

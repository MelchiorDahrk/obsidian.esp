/**
 * @file Main-thread handle to the in-memory game database.
 *
 * The actual `PluginData` lives inside a WASM instance hosted in a dedicated
 * Web Worker (see `worker.ts`) so that multi-second ESP/ESM parsing never
 * blocks the UI. This class is a thin RPC client: every query method posts a
 * `{id, method, params}` request to the worker and resolves when the matching
 * `{id, ok, ...}` response arrives.
 *
 * Add new database queries here (typed wrapper) *and* in `worker.ts`
 * (dispatch) *and* on the Rust `GameDatabase` impl in `src/lib.rs`.
 */
import { App, normalizePath } from 'obsidian';
import type { MasterFile } from '../features/master-files';
import { parseMastersInParallel } from './parallel-loader';

/** A TES3 Activator record as serialized by the Rust `getActivators` query. */
export interface ActivatorRecord {
	id: string;
	name: string;
	mesh: string;
	script: string;
}

/** Summary of the loaded database shown in the status bar. */
export interface GameDatabaseInfo {
	/** Name of the ESP/ESM file the user picked. */
	fileName: string;
	/** Total number of records in the (merged) database. */
	objectCount: number;
	/** Whether master files were merged in during loading. */
	isMerged: boolean;
}

/** RPC request sent to the database worker. */
interface WorkerRequest {
	id: number;
	method: string;
	params?: unknown;
}

interface WorkerSuccessResponse {
	id: number;
	ok: true;
	result: unknown;
}

interface WorkerErrorResponse {
	id: number;
	ok: false;
	error: string;
}

/** RPC response received from the database worker, keyed back by `id`. */
type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

/** Result payload of the worker's `loadDatabase` method. */
interface LoadDatabaseResult {
	info: GameDatabaseInfo;
	/** How many byte copies crossed the JS->WASM boundary (test telemetry). */
	ingressCount: number;
}

/**
 * Returns an ArrayBuffer that can be transferred (zero-copy) to the worker.
 * Views that don't span their whole buffer are copied first, since
 * transferring the underlying buffer would detach unrelated data.
 */
function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
	if (
		bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength
	) {
		return bytes.buffer as ArrayBuffer;
	}

	return bytes.slice().buffer;
}

/**
 * Handle to a game database loaded in a worker-hosted WASM instance.
 *
 * Create instances via {@link GameDatabase.load}; call {@link free} when the
 * database is unloaded so the worker and its WASM memory are released.
 */
export class GameDatabase {
	readonly info: GameDatabaseInfo;

	private nextRequestId = 1;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
		}
	>();
	private topicNamesCache: string[] | null = null;
	private disposed = false;

	private constructor(
		private readonly worker: Worker,
		private readonly workerUrl: string,
		info: GameDatabaseInfo,
	) {
		this.info = info;
		this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
			const message = event.data;
			const pending = this.pending.get(message.id);
			if (!pending) {
				return;
			}

			this.pending.delete(message.id);
			if (message.ok) {
				pending.resolve(message.result);
				return;
			}

			pending.reject(new Error(message.error));
		};

		this.worker.onerror = (event) => {
			const error = new Error(event.message || 'Database worker failed.');
			for (const pending of this.pending.values()) {
				pending.reject(error);
			}
			this.pending.clear();
		};
	}

	/**
	 * Loads an ESP/ESM into a fresh worker-hosted database.
	 *
	 * Master files are first parsed concurrently in a pool of short-lived
	 * workers ({@link parseMastersInParallel}), then the merge worker combines
	 * the pre-parsed records with the plugin. The worker script is read from
	 * the plugin folder and booted through a blob URL because Obsidian does
	 * not serve plugin files over HTTP.
	 *
	 * @param manifestDir Plugin folder (source of `worker.js` and the WASM binary).
	 * @param pluginBytes Raw bytes of the ESP/ESM the user picked.
	 * @param masters Master files to merge beneath the plugin (may be empty).
	 * @param onParseProgress Progress callback for the parallel master-parsing phase.
	 */
	static async load(
		app: App,
		manifestDir: string,
		pluginBytes: Uint8Array,
		fileName: string,
		masters: MasterFile[],
		onParseProgress?: (completed: number, total: number, activeNames: string[]) => void,
	): Promise<{ db: GameDatabase; ingressCount: number }> {
		const wasmPath = normalizePath(`${manifestDir}/pkg/obsidian_esp_bg.wasm`);
		const workerPath = normalizePath(`${manifestDir}/worker.js`);

		// Parse masters in parallel workers before spawning the main merge worker.
		const parsedMasters =
			masters.length > 0
				? await parseMastersInParallel(app, wasmPath, workerPath, masters, onParseProgress)
				: [];

		const wasmBuffer = await app.vault.adapter.readBinary(wasmPath);
		const workerScript = await app.vault.adapter.read(workerPath);
		const workerBlob = new Blob([workerScript], {
			type: 'application/javascript',
		});
		const workerUrl = URL.createObjectURL(workerBlob);
		const worker = new Worker(workerUrl);

		const client = new GameDatabase(worker, workerUrl, {
			fileName,
			objectCount: 0,
			isMerged: masters.length > 0,
		});

		try {
			await client.invoke('init', { wasmBuffer }, [wasmBuffer]);

			const pluginBuffer = toTransferableBuffer(pluginBytes);
			const loadResult = (await client.invoke(
				'loadDatabase',
				{
					fileName,
					pluginBytes: pluginBuffer,
					masters: [],
					parsedMasters,
				},
				[pluginBuffer],
			)) as LoadDatabaseResult;

			client.info.fileName = loadResult.info.fileName;
			client.info.objectCount = loadResult.info.objectCount;
			client.info.isMerged = loadResult.info.isMerged;

			return { db: client, ingressCount: loadResult.ingressCount };
		} catch (error) {
			await client.free();
			throw error;
		}
	}

	/** Returns all Activator records (used by the Database Explorer view). */
	async getActivators(): Promise<ActivatorRecord[]> {
		return (await this.invoke('getActivators')) as ActivatorRecord[];
	}

	/** Unpacks the entire database into `[relativePath, content]` Markdown pairs. */
	async unpack(): Promise<[string, string][]> {
		return (await this.invoke('unpack')) as [string, string][];
	}

	/**
	 * Unpacks only plugin-owned (modified) dialogue into Markdown pairs,
	 * skipping records whose only change is link-pointer reordering.
	 */
	async unpackModified(): Promise<[string, string][]> {
		return (await this.invoke('unpackModified')) as [string, string][];
	}

	/**
	 * Returns every topic name in the database, sorted. Cached after the
	 * first call — topic names never change for a loaded database.
	 */
	async getAllTopicNames(): Promise<string[]> {
		if (this.topicNamesCache) {
			return this.topicNamesCache;
		}

		const names = (await this.invoke('getAllTopicNames')) as string[];
		this.topicNamesCache = names;
		return names;
	}

	/** Unpacks a single topic (case-insensitive lookup) for lazy loading. */
	async unpackTopic(topicName: string): Promise<[string, string][]> {
		return (await this.invoke('unpackTopic', { topicName })) as [string, string][];
	}

	/**
	 * Given `[relativePath, content]` pairs, returns the paths whose content
	 * is functionally identical to the master database (safe to clean up).
	 */
	async findIncidentalEdits(files: [string, string][]): Promise<string[]> {
		return (await this.invoke('findIncidentalEdits', { files })) as string[];
	}

	/**
	 * Releases the database: frees the WASM memory, rejects any in-flight
	 * requests, terminates the worker, and revokes its blob URL. Idempotent.
	 */
	async free(): Promise<void> {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		try {
			await this.invoke('freeDatabase');
		} catch {
			// Ignore termination-time worker failures.
		} finally {
			for (const pending of this.pending.values()) {
				pending.reject(new Error('Database worker was disposed.'));
			}
			this.pending.clear();
			this.worker.terminate();
			URL.revokeObjectURL(this.workerUrl);
		}
	}

	/**
	 * Sends one RPC request to the worker and resolves with its result.
	 * `transfer` moves buffers instead of copying them (they become unusable
	 * on this thread afterwards).
	 */
	private invoke(
		method: string,
		params?: unknown,
		transfer?: Transferable[],
	): Promise<unknown> {
		if (this.disposed) {
			return Promise.reject(new Error('Database worker is disposed.'));
		}

		const id = this.nextRequestId++;
		const request: WorkerRequest = { id, method, params };
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.worker.postMessage(request, transfer ?? []);
		});
	}
}

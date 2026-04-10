import { App, normalizePath } from 'obsidian';
import type { MasterFile } from '../features/master-files';
import { parseMastersInParallel } from './parallel-loader';

export interface ActivatorRecord {
	id: string;
	name: string;
	mesh: string;
	script: string;
}

export interface GameDatabaseInfo {
	fileName: string;
	objectCount: number;
	isMerged: boolean;
}

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

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

interface LoadDatabaseResult {
	info: GameDatabaseInfo;
	ingressCount: number;
}

function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
	if (
		bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength
	) {
		return bytes.buffer as ArrayBuffer;
	}

	return bytes.slice().buffer;
}

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

	async getActivators(): Promise<ActivatorRecord[]> {
		return (await this.invoke('getActivators')) as ActivatorRecord[];
	}

	async unpack(): Promise<[string, string][]> {
		return (await this.invoke('unpack')) as [string, string][];
	}

	async unpackModified(): Promise<[string, string][]> {
		return (await this.invoke('unpackModified')) as [string, string][];
	}

	async getAllTopicNames(): Promise<string[]> {
		if (this.topicNamesCache) {
			return this.topicNamesCache;
		}

		const names = (await this.invoke('getAllTopicNames')) as string[];
		this.topicNamesCache = names;
		return names;
	}

	async unpackTopic(topicName: string): Promise<[string, string][]> {
		return (await this.invoke('unpackTopic', { topicName })) as [string, string][];
	}

	async findIncidentalEdits(files: [string, string][]): Promise<string[]> {
		return (await this.invoke('findIncidentalEdits', { files })) as string[];
	}

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

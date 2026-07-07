/**
 * @file Web Worker that hosts a WASM instance of the Rust crate.
 *
 * Two roles, selected by the incoming RPC method:
 *
 * - **Parse worker** (`parseMaster`): initializes WASM, parses one master file
 *   into a record array, and returns it. Spawned in a pool by
 *   `parallel-loader.ts` so large masters parse concurrently.
 * - **Merge worker** (`init` + `loadDatabase` + queries): owns the long-lived
 *   `GameDatabase` for the session and answers the queries proxied by
 *   `game-database.ts`.
 *
 * The protocol is a minimal request/response pair matched by `id`; errors are
 * caught and returned as `{ok: false, error}` so the main thread can reject
 * the corresponding promise.
 */
import * as obsidianEsp from '../../pkg/obsidian_esp.js';

/** RPC request shape (mirror of `WorkerRequest` in game-database.ts). */
interface WorkerRequest {
	id: number;
	method: string;
	params?: any;
}

type WorkerResult = {
	id: number;
	ok: true;
	result: unknown;
} | {
	id: number;
	ok: false;
	error: string;
};

/**
 * Hand-written typings for the wasm-bindgen exports this worker uses.
 * The generated `obsidian_esp.js` module is untyped in the worker bundle, so
 * the shapes of `PluginBytes`/`GameDatabase` are declared here — keep them in
 * sync with the `#[wasm_bindgen]` items in `src/lib.rs`.
 */
type WasmExports = typeof obsidianEsp & {
	PluginBytes: new (bytes: Uint8Array) => {
		free(): void;
		len: number;
	};
	GameDatabase: {
		loadFromBytes(bytes: InstanceType<WasmExports['PluginBytes']>): any;
		loadWithMasterBuffers(
			pluginBytes: InstanceType<WasmExports['PluginBytes']>,
			masters: [string, Uint8Array][],
		): any;
		loadWithPreparsedMasters(pluginBytes: Uint8Array, parsedMasters: any[]): any;
	};
	load_objects(bytes: Uint8Array): any;
	resetByteIngressCounter(): void;
	getByteIngressCounter(): number;
};

const wasm = obsidianEsp as WasmExports;

/** The worker's single long-lived WASM `GameDatabase` handle (merge role). */
let database: any = null;

/** Frees the current database's WASM memory, if any. Safe to call twice. */
function freeDatabase(): void {
	if (!database) {
		return;
	}

	database.free();
	database = null;
}

/**
 * Builds the session database, choosing the cheapest available path:
 * pre-parsed master records when the parallel loader supplied them, raw
 * master buffers otherwise, or a plain single-plugin load with no masters.
 * Replaces (and frees) any previously loaded database.
 */
function handleLoadDatabase(params: {
	fileName: string;
	pluginBytes: ArrayBuffer;
	masters: [string, ArrayBuffer][];
	parsedMasters?: any[];
}): { info: { fileName: string; objectCount: number; isMerged: boolean }; ingressCount: number } {
	freeDatabase();
	wasm.resetByteIngressCounter();

	if (params.parsedMasters && params.parsedMasters.length > 0) {
		const pluginBytes = new Uint8Array(params.pluginBytes);
		database = wasm.GameDatabase.loadWithPreparsedMasters(pluginBytes, params.parsedMasters);
		return {
			info: {
				fileName: params.fileName,
				objectCount: database.objectCount(),
				isMerged: true,
			},
			ingressCount: wasm.getByteIngressCounter(),
		};
	}

	const pluginBuffer = new wasm.PluginBytes(new Uint8Array(params.pluginBytes));
	const masterBuffers = params.masters.map(
		([name, bytes]) => [name, new Uint8Array(bytes)] as [string, Uint8Array],
	);

	try {
		database =
			masterBuffers.length > 0
				? wasm.GameDatabase.loadWithMasterBuffers(pluginBuffer, masterBuffers)
				: wasm.GameDatabase.loadFromBytes(pluginBuffer);

		return {
			info: {
				fileName: params.fileName,
				objectCount: database.objectCount(),
				isMerged: masterBuffers.length > 0,
			},
			ingressCount: wasm.getByteIngressCounter(),
		};
	} finally {
		pluginBuffer.free();
	}
}

/** Returns the loaded database or throws a descriptive error for the caller. */
function requireDatabase(): any {
	if (!database) {
		throw new Error('No database is currently loaded.');
	}

	return database;
}

/** Dispatches one RPC request to its implementation. */
function handleRequest(request: WorkerRequest): unknown {
	switch (request.method) {
		case 'init':
			wasm.initSync({ module: request.params.wasmBuffer });
			return null;
		case 'parseMaster': {
			wasm.initSync({ module: request.params.wasmBuffer });
			const masterBytes = new Uint8Array(request.params.masterBytes);
			return wasm.load_objects(masterBytes);
		}
		case 'loadDatabase':
			return handleLoadDatabase(request.params);
		case 'getActivators':
			return requireDatabase().getActivators();
		case 'unpack':
			return requireDatabase().unpack();
		case 'unpackModified':
			return requireDatabase().unpackModified();
		case 'getAllTopicNames':
			return requireDatabase().getAllTopicNames();
		case 'unpackTopic':
			return requireDatabase().unpackTopic(request.params.topicName);
		case 'findIncidentalEdits':
			return requireDatabase().findIncidentalEdits(request.params.files);
		case 'freeDatabase':
			freeDatabase();
			return null;
		default:
			throw new Error(`Unknown database worker method '${request.method}'.`);
	}
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const request = event.data;
	let response: WorkerResult;

	try {
		response = {
			id: request.id,
			ok: true,
			result: handleRequest(request),
		};
	} catch (error) {
		response = {
			id: request.id,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	(self as unknown as { postMessage: (message: WorkerResult) => void }).postMessage(response);
};

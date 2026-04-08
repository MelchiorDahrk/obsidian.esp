import * as obsidianEsp from '../../pkg/obsidian_esp.js';

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
	};
	resetByteIngressCounter(): void;
	getByteIngressCounter(): number;
};

const wasm = obsidianEsp as WasmExports;
let database: any = null;

function freeDatabase(): void {
	if (!database) {
		return;
	}

	database.free();
	database = null;
}

function handleLoadDatabase(params: {
	fileName: string;
	pluginBytes: ArrayBuffer;
	masters: [string, ArrayBuffer][];
}): { info: { fileName: string; objectCount: number; isMerged: boolean }; ingressCount: number } {
	freeDatabase();
	wasm.resetByteIngressCounter();

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

function requireDatabase(): any {
	if (!database) {
		throw new Error('No database is currently loaded.');
	}

	return database;
}

function handleRequest(request: WorkerRequest): unknown {
	switch (request.method) {
		case 'init':
			wasm.initSync({ module: request.params.wasmBuffer });
			return null;
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

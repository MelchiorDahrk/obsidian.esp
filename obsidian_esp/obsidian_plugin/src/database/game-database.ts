import {
	GameDatabase as WasmGameDatabase,
	extractMasterNames as wasmExtractMasterNames,
} from '../../pkg/obsidian_esp.js';

/**
 * Represents a basic game record (Activator) for display in the explorer.
 */
export interface ActivatorRecord {
	id: string;
	name: string;
	mesh: string;
	script: string;
}

/**
 * Summary information about a loaded game database.
 */
export interface GameDatabaseInfo {
	fileName: string;
	objectCount: number;
	isMerged: boolean;
}

/**
 * Parse raw plugin bytes and return the master names from the header.
 * Lightweight — does not create a full GameDatabase.
 */
export function extractMasterNames(bytes: Uint8Array): string[] {
	return wasmExtractMasterNames(bytes) as string[];
}

/**
 * Wrapper for the WASM-backed game database.
 * Manages the lifecycle of the in-memory plugin data and provides typed access to its contents.
 */
export class GameDatabase {
	private handle: WasmGameDatabase;
	readonly info: GameDatabaseInfo;

	private constructor(handle: WasmGameDatabase, info: GameDatabaseInfo) {
		this.handle = handle;
		this.info = info;
	}

	/**
	 * Loads a single plugin file (ESP/ESM) from raw bytes.
	 * This does not resolve master dependencies.
	 */
	static load(bytes: Uint8Array, fileName: string): GameDatabase {
		const handle = new WasmGameDatabase(bytes);
		return new GameDatabase(handle, {
			fileName,
			objectCount: handle.objectCount(),
			isMerged: false,
		});
	}

	/**
	 * Load a plugin merged with its masters into a single resolved database.
	 * Masters is an array of [name, bytes] pairs.
	 */
	static loadWithMasters(
		pluginBytes: Uint8Array,
		fileName: string,
		masters: [string, Uint8Array][],
	): GameDatabase {
		const handle = WasmGameDatabase.loadWithMasters(pluginBytes, masters);
		return new GameDatabase(handle, {
			fileName,
			objectCount: handle.objectCount(),
			isMerged: true,
		});
	}

	/**
	 * Load a plugin merged with pre-parsed masters.
	 * Masters is an array of parsed object arrays.
	 */
	static loadWithPreparsedMasters(
		pluginBytes: Uint8Array,
		fileName: string,
		masters: any[],
	): GameDatabase {
		const handle = (WasmGameDatabase as any).loadWithPreparsedMasters(
			pluginBytes,
			masters,
		);
		return new GameDatabase(handle, {
			fileName,
			objectCount: handle.objectCount(),
			isMerged: true,
		});
	}

	/**
	 * Returns all Activator records in the database.
	 */
	getActivators(): ActivatorRecord[] {
		return this.handle.getActivators() as ActivatorRecord[];
	}

	/**
	 * Unpacks the entire database into a list of [filePath, content] pairs.
	 */
	unpack(): [string, string][] {
		const unpacked = this.handle.unpack() as unknown;
		if (!Array.isArray(unpacked)) {
			throw new Error('Unexpected unpacked plugin output.');
		}
		return unpacked as [string, string][];
	}

	/** Unpack only the plugin's own modified dialogues. */
	unpackModified(): [string, string][] {
		const unpacked = this.handle.unpackModified() as unknown;
		if (!Array.isArray(unpacked)) {
			throw new Error('Unexpected unpacked plugin output.');
		}
		return unpacked as [string, string][];
	}

	/** Returns a sorted list of all topic names in the full database. */
	getAllTopicNames(): string[] {
		return this.handle.getAllTopicNames() as string[];
	}

	/** Unpack a single topic's info files (for lazy loading). */
	unpackTopic(topicName: string): [string, string][] {
		const unpacked = this.handle.unpackTopic(topicName) as unknown;
		if (!Array.isArray(unpacked)) {
			throw new Error('Unexpected unpacked topic output.');
		}
		return unpacked as [string, string][];
	}

	/**
	 * Releases the memory held by the WASM object.
	 * MUST be called when the database is no longer needed to prevent memory leaks.
	 */
	free(): void {
		this.handle.free();
	}
}

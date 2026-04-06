import {
	GameDatabase as WasmGameDatabase,
	extractMasterNames as wasmExtractMasterNames,
} from '../../pkg/obsidian_esp.js';

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

/**
 * Parse raw plugin bytes and return the master names from the header.
 * Lightweight — does not create a full GameDatabase.
 */
export function extractMasterNames(bytes: Uint8Array): string[] {
	return wasmExtractMasterNames(bytes) as string[];
}

export class GameDatabase {
	private handle: WasmGameDatabase;
	readonly info: GameDatabaseInfo;

	private constructor(handle: WasmGameDatabase, info: GameDatabaseInfo) {
		this.handle = handle;
		this.info = info;
	}

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

	getActivators(): ActivatorRecord[] {
		return this.handle.getActivators() as ActivatorRecord[];
	}

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

	free(): void {
		this.handle.free();
	}
}

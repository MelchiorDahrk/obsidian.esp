import {
	GameDatabase as WasmGameDatabase,
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

	free(): void {
		this.handle.free();
	}
}

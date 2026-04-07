import { initSync, load_objects } from '../../pkg/obsidian_esp.js';

self.onmessage = (e: MessageEvent) => {
	const { wasmBuffer, masterBytes } = e.data;
	try {
		initSync({ module: wasmBuffer });
		const objects = load_objects(masterBytes);
		(self as any).postMessage({ success: true, objects });
	} catch (error) {
		(self as any).postMessage({ success: false, error: String(error) });
	}
};

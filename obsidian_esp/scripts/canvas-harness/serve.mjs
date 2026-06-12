// Tiny static file server for visually inspecting rendered canvas SVGs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const types = {
	'.html': 'text/html',
	'.svg': 'image/svg+xml',
	'.json': 'application/json',
	'.canvas': 'application/json',
};

createServer(async (request, response) => {
	const urlPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
	const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
	const filePath = path.join(here, relative);
	try {
		const body = await readFile(filePath);
		response.writeHead(200, { 'content-type': types[path.extname(filePath)] ?? 'application/octet-stream' });
		response.end(body);
	} catch {
		response.writeHead(404);
		response.end('not found');
	}
}).listen(4173, () => {
	console.log('canvas harness viewer on http://localhost:4173');
});

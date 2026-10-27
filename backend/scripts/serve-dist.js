import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function createDistServer({ directory, basePath = '/', publicConfig } = {}) {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) throw new Error('INVALID_FRONTEND_BASE');
  const root = await realpath(directory ?? fileURLToPath(new URL('../../dist/', import.meta.url)));
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (manifest.generator !== 'naufragio-public-frontend-v1') throw new Error('INVALID_DIST');
  const allowed = new Set(manifest.files.map(file => file.path));
  const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', txt: 'text/plain' };
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method !== 'GET' || !url.pathname.startsWith(basePath)) throw new Error();
      const name = decodeURIComponent(url.pathname.slice(basePath.length)) || 'index.html';
      if (name === 'site.config.json' && publicConfig) {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(publicConfig)); return;
      }
      if (!allowed.has(name) || name.startsWith('/') || name.split('/').some(part => part === '..') || name.includes('\\')) throw new Error();
      const bytes = await readFile(join(root, name));
      response.writeHead(200, { 'Content-Type': `${types[name.split('.').at(-1)] ?? 'application/octet-stream'}; charset=utf-8` });
      response.end(bytes);
    } catch { response.writeHead(404); response.end('NOT_FOUND'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.FRONTEND_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_FRONTEND_PORT');
  const server = await createDistServer({ basePath: process.env.FRONTEND_BASE_PATH ?? '/' });
  server.listen(port, '127.0.0.1', () => console.log(`dist local listo en puerto ${port}.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
}

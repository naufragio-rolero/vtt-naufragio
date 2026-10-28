import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const allowed = /^(?:index\.html|app\.js|styles\.css|site\.config\.json|frontend\/(?:board-model|multiplayer|room-media-store)\.js|frontend\/vendor\/socket\.io-4\.8\.4\.esm\.min\.js|backend\/client\/(?:token-client|asset-client|indexeddb-store)\.js|backend\/shared\/token-state\.js|backend\/public\/(?:settings\.html|settings\.js|settings\.css|site-config\.js|site\.config\.example\.json|site\.config\.schema\.json))$/;
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };
export function createFrontendServer({ basePath = '/', publicConfig } = {}) {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) throw new Error('INVALID_FRONTEND_BASE');
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method !== 'GET' || !url.pathname.startsWith(basePath)) throw new Error();
      const file = decodeURIComponent(url.pathname.slice(basePath.length)) || 'index.html';
      if (!allowed.test(file)) throw new Error();
      if (file === 'site.config.json' && publicConfig) {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(publicConfig)); return;
      }
      const path = resolve(root, file);
      if (!path.startsWith(resolve(root) + sep) || !(await stat(path)).isFile()) throw new Error();
      response.writeHead(200, { 'Content-Type': `${types[file.split('.').at(-1)]}; charset=utf-8` }); response.end(await readFile(path));
    } catch { response.writeHead(404); response.end('NOT_FOUND'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.FRONTEND_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_FRONTEND_PORT');
  const server = createFrontendServer({ basePath: process.env.FRONTEND_BASE_PATH ?? '/' });
  server.listen(port, '127.0.0.1', () => console.log(`Frontend local listo en puerto ${port}.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
}

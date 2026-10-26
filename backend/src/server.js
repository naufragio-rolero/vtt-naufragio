import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { attachRealtime } from './realtime.js';
import { createLimiter } from './limits.js';
import { HttpError, sendError, sendJson } from './errors.js';
import { validateSiteConfig } from '../public/site-config.js';

const assets = new Map([
  ['/settings/', ['settings.html', 'text/html']],
  ['/settings/settings.js', ['settings.js', 'text/javascript']],
  ['/settings/settings.css', ['settings.css', 'text/css']],
  ['/settings/site-config.js', ['site-config.js', 'text/javascript']],
  ['/settings/site.config.example.json', ['site.config.example.json', 'application/json']],
  ['/settings/site.config.schema.json', ['site.config.schema.json', 'application/schema+json']]
]);
const reserved = new Map([
  ['/auth/login', 'POST'], ['/auth/logout', 'POST'], ['/invitations', 'POST'],
  ['/auth/register', 'POST'], ['/rooms', 'GET, POST'], ['/rooms/join', 'POST']
]);

async function readJson(request, limit) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new HttpError(415, 'JSON_REQUIRED');
  }
  if (Number(request.headers['content-length']) > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, 'INVALID_JSON'); }
}

export function createBackend(config, { reportError = () => {}, publicConfigFile = new URL('../public/site.config.json', import.meta.url) } = {}) {
  const acceptRequest = createLimiter(config.httpRateLimit, config.rateWindowMs);
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000, keepAliveTimeout: 5000 }, (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src http: https:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    response.setHeader('Vary', 'Origin');
    handle(request, response).catch(error => sendError(response, error, reportError));
  });
  const io = attachRealtime(server, config);

  async function handle(request, response) {
    const origin = request.headers.origin;
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) throw new HttpError(403, 'ORIGIN_DENIED');
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    if (!acceptRequest(request.socket.remoteAddress)) {
      response.setHeader('Retry-After', String(Math.ceil(config.rateWindowMs / 1000)));
      throw new HttpError(429, 'RATE_LIMITED');
    }
    if (request.method === 'OPTIONS') {
      const headers = (request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      if (headers.some(header => !['content-type', 'authorization'].includes(header))) throw new HttpError(403, 'HEADERS_DENIED');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.writeHead(204);
      response.end();
      return;
    }
    const { pathname, search } = new URL(request.url, 'http://localhost');
    if (search) throw new HttpError(400, 'QUERY_NOT_ALLOWED');
    const methods = pathname === '/health' || pathname === '/settings' || pathname === '/settings/site.config.json' || assets.has(pathname) ? 'GET' : reserved.get(pathname);
    if (!methods) throw new HttpError(404, 'NOT_FOUND');
    if (!methods.split(', ').includes(request.method)) {
      response.setHeader('Allow', methods);
      throw new HttpError(405, 'METHOD_NOT_ALLOWED');
    }
    if (pathname === '/health') {
      sendJson(response, 200, { status: 'ok', service: 'naufragio-vtt', protocolVersion: 1, phase: 1,
        capabilities: { authentication: false, rooms: false, gameEvents: false } });
      return;
    }
    if (pathname === '/settings') {
      response.writeHead(308, { Location: './settings/' });
      response.end();
      return;
    }
    if (pathname === '/settings/site.config.json') {
      let data;
      try { data = await readFile(publicConfigFile, 'utf8'); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        data = await readFile(new URL('../public/site.config.example.json', import.meta.url), 'utf8');
      }
      sendJson(response, 200, validateSiteConfig(JSON.parse(data), { development: config.mode !== 'production' }));
      return;
    }
    if (assets.has(pathname)) {
      const [file, type] = assets.get(pathname);
      const data = await readFile(new URL(`../public/${file}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      response.end(data);
      return;
    }
    // API contracts only. No account creation, fake sessions or anonymous rooms.
    if (request.method === 'POST') await readJson(request, config.maxBodyBytes);
    throw new HttpError(501, 'FEATURE_NOT_AVAILABLE');
  }

  let closing;
  return {
    server, io,
    listen(port = config.port) {
      return new Promise((resolve, reject) => {
        const failed = error => reject(error);
        server.once('error', failed);
        server.listen(port, config.host, () => {
          server.off('error', failed);
          resolve(server.address());
        });
      });
    },
    close() {
      closing ??= new Promise(resolve => {
        io.close(() => resolve());
        server.closeIdleConnections();
      });
      return closing;
    }
  };
}

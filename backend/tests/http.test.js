import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { fixture, origin } from './helpers.js';
import { sendError } from '../src/errors.js';
import { createBackend } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('health, methods and error responses reveal no environment or stack', async t => {
  const { url } = await fixture(t);
  const response = await fetch(`${url}/health`, { headers: { Origin: origin } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { status: 'ok', service: 'naufragio-vtt', protocolVersion: 1,
    phase: 1, capabilities: { authentication: false, rooms: false, gameEvents: false } });
  const method = await fetch(`${url}/health`, { method: 'POST' });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET');
  const missing = await fetch(`${url}/.env`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: { code: 'NOT_FOUND' } });
  assert.equal((await fetch(`${url}/health?token=not-a-secret`)).status, 400);
});

test('HTTP rejects unauthorized origins and supports explicit preflight', async t => {
  const { url } = await fixture(t);
  for (const Origin of ['https://evil.invalid', 'null', `${origin}.evil.invalid`]) {
    const response = await fetch(`${url}/health`, { headers: { Origin } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const response = await fetch(`${url}/rooms`, { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type'
  } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal((await fetch(`${url}/rooms`, { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Headers': 'X-User-Role'
  } })).status, 403);
});

test('accounts, invitations and rooms are explicit unavailable contracts', async t => {
  const { url } = await fixture(t);
  for (const path of ['/auth/login', '/auth/logout', '/auth/register', '/invitations', '/rooms', '/rooms/join']) {
    const response = await fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', roomId: 'invented' }) });
    assert.equal(response.status, 501, path);
    assert.deepEqual(await response.json(), { error: { code: 'FEATURE_NOT_AVAILABLE' } });
  }
  assert.equal((await fetch(`${url}/rooms`)).status, 501);
});

test('body limits reject invalid JSON, excessive declared and chunked sizes', async t => {
  const { url } = await fixture(t, { MAX_BODY_BYTES: '256' });
  const post = body => fetch(`${url}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal((await post('{bad')).status, 400);
  assert.equal((await post('[]')).status, 400);
  assert.equal((await fetch(`${url}/auth/login`, { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await post(JSON.stringify({ data: 'x'.repeat(300) }))).status, 413);
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(`${url}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
    request.write('{"data":"');
    request.write('x'.repeat(300));
    request.end('"}');
  });
  assert.equal(status, 413);
});

test('HTTP rate limits cannot be bypassed with forwarded IP headers', async t => {
  const { url } = await fixture(t, { HTTP_RATE_LIMIT: '1' });
  assert.equal((await fetch(`${url}/health`)).status, 200);
  const response = await fetch(`${url}/health`, { headers: { 'X-Forwarded-For': '192.0.2.1' } });
  assert.equal(response.status, 429);
  assert.ok(response.headers.has('retry-after'));
});

test('settings are isolated, assets are explicit and traversal cannot expose files', async t => {
  const { url } = await fixture(t);
  const response = await fetch(`${url}/settings`, { redirect: 'manual' });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), './settings/');
  const page = await fetch(`${url}/settings/`);
  assert.match(await page.text(), /Configuración del sitio/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const file of ['settings.js', 'settings.css', 'site-config.js', 'site.config.json', 'site.config.example.json', 'site.config.schema.json']) {
    assert.equal((await fetch(`${url}/settings/${file}`)).status, 200);
  }
  for (const path of ['/settings/.env', '/src/config.js', '/settings/%2e%2e%2f.env']) {
    assert.equal((await fetch(`${url}${path}`)).status, 404);
  }
});

test('public config loader refuses files with extra secret fields', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'naufragio-public-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'site.config.json');
  const app = createBackend(loadConfig({ NODE_ENV: 'test' }), { publicConfigFile: file });
  const address = await app.listen(0);
  t.after(() => app.close());
  const url = `http://127.0.0.1:${address.port}/settings/site.config.json`;
  const base = await (await fetch(url)).json();
  await writeFile(file, JSON.stringify({ ...base, siteName: 'Mi mesa' }));
  assert.equal((await (await fetch(url)).json()).siteName, 'Mi mesa');
  await writeFile(file, JSON.stringify({ ...base, secret: 'not-a-real-secret' }));
  const response = await fetch(url);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR' } });
});

test('unexpected internal failures log only a fixed code', () => {
  const output = [];
  const response = { headersSent: false, setHeader() {}, writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  sendError(response, new Error('sensitive-value'), entry => output.push(entry));
  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.body), { error: { code: 'INTERNAL_ERROR' } });
  assert.deepEqual(output, [{ code: 'INTERNAL_ERROR' }]);
});

test('shutdown closes HTTP and is idempotent', async t => {
  const { app, url } = await fixture(t);
  await fetch(`${url}/health`);
  await app.close();
  await app.close();
  await assert.rejects(fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) }));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSiteConfig } from '../public/site-config.js';

const example = JSON.parse(await readFile(new URL('../public/site.config.example.json', import.meta.url), 'utf8'));
test('public configuration supports a portable deployment and independent role labels', () => {
  const value = { ...example, apiBaseUrl: 'https://example.invalid/vtt/api', realtimeBaseUrl: 'wss://example.invalid', socketPath: '/vtt/socket.io' };
  assert.deepEqual(validateSiteConfig(value), value);
  assert.equal(validateSiteConfig({ ...value, roleLabels: { admin: 'Operación', director: 'Dirección', user: 'Participante' } }).roleLabels.director, 'Dirección');
});
test('public config refuses secrets, unknown keys, invalid versions and unsafe endpoints', () => {
  for (const change of [
    { secret: 'not-a-real-secret' }, { schemaVersion: 2 }, { siteName: '' }, { roleLabels: { admin: 'Admin' } },
    { roleLabels: { ...example.roleLabels, role: 'admin' } }, { roleLabels: { ...example.roleLabels, admin: ' ' } },
    { apiBaseUrl: 'http://example.invalid' }, { apiBaseUrl: 'https://user:pass@example.invalid' },
    { apiBaseUrl: 'https://example.invalid?token=x' }, { apiBaseUrl: 'https://example.invalid#x' },
    { apiBaseUrl: 'javascript:alert(1)' }, { realtimeBaseUrl: 'ws://example.invalid' },
    { apiBaseUrl: 'https:example.invalid' }, { apiBaseUrl: 'https:////example.invalid' },
    { apiBaseUrl: 'https://example.invalid?' }, { socketPath: '/health' },
    { socketPath: '/socket/../rooms' }, { socketPath: '//socket.io' }, { socketPath: '/socket.io?x=y' }
  ]) assert.throws(() => validateSiteConfig({ ...example, ...change }));
});
test('insecure localhost is explicitly development-only', () => {
  const local = { ...example, apiBaseUrl: 'http://127.0.0.1:3400', realtimeBaseUrl: 'ws://localhost:3400' };
  assert.throws(() => validateSiteConfig(local));
  assert.deepEqual(validateSiteConfig(local, { development: true }), local);
  assert.throws(() => validateSiteConfig({ ...local, apiBaseUrl: 'http://localhost.evil.invalid' }, { development: true }));
});

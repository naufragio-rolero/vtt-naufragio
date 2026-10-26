import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createLimiter } from '../src/limits.js';

test('configuration defaults bind to loopback and are immutable', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.diagnostics, false);
  assert.equal(config.port, 3400);
  assert.throws(() => config.allowedOrigins.push('https://evil.invalid'));
});

test('environment overrides are portable and production requires exact HTTPS origins', () => {
  const config = loadConfig({ NODE_ENV: 'production', HOST: '::1', PORT: '8400',
    ALLOWED_ORIGINS: 'https://vtt.example.invalid,https://other.example.invalid', SOCKET_PATH: '/vtt/socket.io' });
  assert.equal(config.port, 8400);
  assert.equal(config.socketPath, '/vtt/socket.io');
  assert.equal(config.allowedOrigins.length, 2);
  for (const env of [
    { NODE_ENV: 'invalid' }, { NODE_ENV: 'production' }, { NODE_ENV: 'production', ENABLE_DIAGNOSTICS: 'true' },
    { PORT: '0' }, { PORT: '65536' }, { PORT: '1e3' }, { PORT: '' },
    { ALLOWED_ORIGINS: '*' }, { ALLOWED_ORIGINS: 'null' }, { ALLOWED_ORIGINS: 'https://example.invalid/path' },
    { ALLOWED_ORIGINS: 'http://example.invalid' }, { ALLOWED_ORIGINS: 'https://user:pass@example.invalid' },
    { NODE_ENV: 'production', ALLOWED_ORIGINS: 'http://localhost:8080' },
    { MAX_BODY_BYTES: '0' }, { MAX_MESSAGE_BYTES: '99999999' }, { RATE_WINDOW_MS: '0' },
    { SOCKET_PATH: '/' }, { SOCKET_PATH: '/health' }, { SOCKET_PATH: '/socket/../rooms' },
    { ENABLE_DIAGNOSTICS: 'yes' }
  ]) assert.throws(() => loadConfig(env), JSON.stringify(env));
});

test('rate limiter expires state, rejects excess peers, and resets budget', () => {
  let now = 0;
  const allow = createLimiter(2, 100, { maxKeys: 1, clock: () => now });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
  assert.equal(allow('b'), false);
  now = 100;
  assert.equal(allow('b'), true);
  assert.equal(allow('b'), true);
  assert.equal(allow('b'), false);
});

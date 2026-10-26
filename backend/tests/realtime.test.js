import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { once } from 'node:events';
import { fixture, origin } from './helpers.js';

function client(t, url, options = {}) {
  const socket = io(url, { autoConnect: false, forceNew: true, reconnection: false, timeout: 2000,
    extraHeaders: { Origin: origin }, ...options });
  t.after(() => socket.disconnect());
  return socket;
}
async function connect(socket) {
  const ready = once(socket, 'connect', { signal: AbortSignal.timeout(3000) });
  socket.connect();
  await ready;
}
const event = (socket, name, payload) => socket.timeout(1500).emitWithAck(name, payload);

for (const transport of ['polling', 'websocket']) {
  test(`Socket.IO ${transport}: diagnostic connection and versioned acknowledgment`, { timeout: 10000 }, async t => {
    const { url } = await fixture(t, { ENABLE_DIAGNOSTICS: 'true', SOCKET_PATH: '/realtime/socket.io' });
    const socket = client(t, `${url}/diagnostics`, { transports: [transport], path: '/realtime/socket.io' });
    await connect(socket);
    assert.deepEqual(await event(socket, 'system:ping', { version: 1, id: 'check-1' }), { ok: true, version: 1, id: 'check-1' });
    assert.deepEqual(await event(socket, 'system:ping', { version: 2, id: 'x' }), { ok: false, error: { code: 'INVALID_MESSAGE' } });
    assert.deepEqual(await event(socket, 'system:ping', { version: 1, id: 'x', role: 'admin' }), { ok: false, error: { code: 'INVALID_MESSAGE' } });
    assert.deepEqual(await event(socket, 'room:join', { roomId: 'other' }), { ok: false, error: { code: 'EVENT_NOT_AVAILABLE' } });
  });
  test(`Socket.IO ${transport}: rejects forbidden origin`, { timeout: 10000 }, async t => {
    const { url } = await fixture(t, { ENABLE_DIAGNOSTICS: 'true' });
    const socket = client(t, `${url}/diagnostics`, { transports: [transport], extraHeaders: { Origin: 'https://evil.invalid' } });
    const failed = once(socket, 'connect_error', { signal: AbortSignal.timeout(3000) });
    socket.connect();
    await failed;
    assert.equal(socket.connected, false);
  });
}

test('game namespace fails closed even with a forged role or token', { timeout: 10000 }, async t => {
  const { url } = await fixture(t);
  const socket = client(t, url, { transports: ['websocket'], auth: { role: 'admin', token: 'invented' } });
  const failed = once(socket, 'connect_error', { signal: AbortSignal.timeout(3000) });
  socket.connect();
  const [error] = await failed;
  assert.equal(error.data.code, 'AUTH_UNAVAILABLE');
  assert.equal(socket.connected, false);
});

test('diagnostic namespace is disabled by default', { timeout: 10000 }, async t => {
  const { url } = await fixture(t);
  const socket = client(t, `${url}/diagnostics`);
  const failed = once(socket, 'connect_error', { signal: AbortSignal.timeout(3000) });
  socket.connect();
  await failed;
  assert.equal(socket.connected, false);
});

test('diagnostic events are rate limited and oversized frames disconnect', { timeout: 10000 }, async t => {
  const { url } = await fixture(t, { ENABLE_DIAGNOSTICS: 'true', EVENT_RATE_LIMIT: '1', MAX_MESSAGE_BYTES: '256' });
  const socket = client(t, `${url}/diagnostics`, { transports: ['websocket'] });
  await connect(socket);
  assert.equal((await event(socket, 'system:ping', { version: 1, id: 'a' })).ok, true);
  const disconnected = once(socket, 'disconnect', { signal: AbortSignal.timeout(3000) });
  assert.deepEqual(await event(socket, 'system:ping', { version: 1, id: 'b' }), { ok: false, error: { code: 'RATE_LIMITED' } });
  await disconnected;
  const second = client(t, `${url}/diagnostics`, { transports: ['websocket'] });
  await connect(second);
  const oversized = once(second, 'disconnect', { signal: AbortSignal.timeout(3000) });
  second.emit('system:ping', { version: 1, id: 'x'.repeat(1000) });
  await oversized;
});

test('Engine.IO caps concurrent transports and limits handshake attempts', async t => {
  const { url } = await fixture(t, { ENABLE_DIAGNOSTICS: 'true', CONNECTION_LIMIT: '1', HANDSHAKE_RATE_LIMIT: '1' });
  const first = client(t, `${url}/diagnostics`, { transports: ['websocket'] });
  await connect(first);
  const denied = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } });
  assert.equal(denied.status, 403);
  first.disconnect();
  // The attempted second connection was rejected by the cap. The first handshake exhausted the budget.
  const second = client(t, `${url}/diagnostics`, { transports: ['websocket'] });
  const failed = once(second, 'connect_error', { signal: AbortSignal.timeout(3000) });
  second.connect();
  await failed;
  assert.equal(second.connected, false);
});

test('missing Origin is denied and Socket.IO client bundle is not exposed', async t => {
  const { url } = await fixture(t);
  assert.ok((await fetch(`${url}/socket.io/?EIO=4&transport=polling`)).status >= 400);
  assert.ok((await fetch(`${url}/socket.io/socket.io.js`)).status >= 400);
});

test('parallel handshakes cannot exceed the connection cap', async t => {
  const { url, app } = await fixture(t, { CONNECTION_LIMIT: '1' });
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } })));
  assert.equal(results.filter(response => response.status === 200).length, 1);
  assert.equal(app.io.engine.clientsCount, 1);
});

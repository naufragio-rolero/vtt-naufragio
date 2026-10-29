import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createAssetClient } from '../client/asset-client.js';

// Regression for the original F6-03 leak: the 600-second receiver timer
// stayed active even after the blob was verified and the client was closed.
function fakeSocket() {
  const socket = new EventEmitter();
  socket.requests = [];
  socket.timeout = () => ({ emitWithAck: async (event, value) => {
    assert.equal(event, 'assets:request');
    const transferId = randomUUID();
    socket.requests.push({ ...value, transferId });
    return { ok: true, transferId };
  } });
  return socket;
}
async function until(check, description, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (check()) return;
  assert.fail('Timed out: ' + description);
}
function join(socket, roomId, epoch, bytes, revision = 1) {
  socket.emit('room:authority', { version: 1, roomId, state: 'active', epoch });
  socket.emit('assets:manifest', { version: 1, roomId, epoch, revision,
    assets: [{ id: 'map', sha256: createHash('sha256').update(bytes).digest('hex'),
      mime: 'image/png', bytes: bytes.length }], tokens: [], map: null });
}

test('receiver deadlines are cleared on success, failure, authority change, manifest replacement and close', async () => {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const outstanding = new Set();
  globalThis.setTimeout = function (work, delay, ...args) {
    const handle = originalSet(work, delay, ...args);
    if (delay === 600000) outstanding.add(handle);
    return handle;
  };
  globalThis.clearTimeout = function (handle) {
    outstanding.delete(handle);
    return originalClear(handle);
  };
  const clients = [];
  const roomId = randomUUID(), epoch = randomUUID();
  const bytes = Buffer.from('Verified public image content');
  function receiver() {
    const socket = fakeSocket();
    const events = [], errors = [];
    const client = createAssetClient(socket, { roomId,
      onUpdate: value => events.push(value),
      onError: error => errors.push(error) });
    clients.push(client);
    join(socket, roomId, epoch, bytes);
    return { socket, client, events, errors };
  }
  try {
    // Download success must clear the pending deadline without requiring close.
    const complete = receiver();
    await until(() => complete.socket.requests.length === 1 && outstanding.size === 1, 'request registered');
    const transferId = complete.socket.requests[0].transferId;
    let ack;
    complete.socket.emit('assets:chunk', { version: 1, roomId, transferId, offset: 0,
      data: bytes.toString('base64') }, value => { ack = value; });
    assert.deepEqual(ack, { ok: true });
    complete.socket.emit('assets:finished', { version: 1, roomId, transferId,
      assetId: 'map', sha256: createHash('sha256').update(bytes).digest('hex') });
    await until(() => complete.events.some(value => value.blobs.has('map')), 'verified image published');
    assert.equal(outstanding.size, 0, 'successful transfer must release timer');
    complete.client.close();
    assert.equal(outstanding.size, 0);

    // A relay failure must cancel the deadline and produce an ordinary error.
    const failed = receiver();
    await until(() => failed.socket.requests.length === 1 && outstanding.size === 1, 'failed transfer registered');
    failed.socket.emit('assets:failed', { version: 1, roomId,
      transferId: failed.socket.requests[0].transferId, code: 'TRANSFER_INTERRUPTED' });
    await until(() => failed.errors.length === 1, 'relay error propagated');
    assert.equal(outstanding.size, 0, 'failed transfer must release timer');
    failed.client.close();

    // Closing with an outstanding download must immediately release the timer.
    const closed = receiver();
    await until(() => closed.socket.requests.length === 1 && outstanding.size === 1, 'close transfer registered');
    closed.client.close();
    assert.equal(outstanding.size, 0, 'close must release timer');

    // A replaced public manifest must release the old timer, then close the new one.
    const replaced = receiver();
    await until(() => replaced.socket.requests.length === 1 && outstanding.size === 1, 'old manifest registered');
    const previousDeadline = [...outstanding][0];
    join(replaced.socket, roomId, epoch, bytes, 2);
    // Superseding the manifest must cancel the old deadline synchronously.
    assert.equal(outstanding.has(previousDeadline), false, 'previous manifest timer must be cleared');
    // The fake transport records a request BEFORE its async acknowledgement
    // resumes downloadAll(). Wait for the replacement deadline itself.
    await until(() => replaced.socket.requests.length === 2 &&
      outstanding.size === 1 && !outstanding.has(previousDeadline), 'replacement timer registered');
    assert.equal(outstanding.size, 1, 'only the replacement timer may survive');
    replaced.client.close();
    assert.equal(outstanding.size, 0);

    // Loss of the director's epoch suspends all pending receiver requests.
    const waiting = receiver();
    await until(() => waiting.socket.requests.length === 1 && outstanding.size === 1, 'authority transfer registered');
    waiting.socket.emit('room:authority', { version: 1, roomId, state: 'waiting', epoch: null });
    assert.equal(outstanding.size, 0, 'suspension must release timer');
    waiting.client.close();
  } finally {
    for (const client of clients) client.close();
    for (const handle of outstanding) originalClear(handle);
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});

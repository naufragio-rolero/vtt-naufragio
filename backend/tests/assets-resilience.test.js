import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createAssetClient } from '../client/asset-client.js';
import { roomFixture } from './room-helpers.js';
import { rawSocket, connect, prove, localAuthority, waitFor } from './token-helpers.js';

const sha256 = data => createHash('sha256').update(data).digest('hex');

test('a 12 MiB map reaches two members without exhausting director event budget', { timeout: 120000 }, async t => {
  const f = await roomFixture(t, { EVENT_RATE_LIMIT: '200' });
  const second = await f.account('media-recipient-two', 'user');
  f.admit(f.member);
  f.admit(second);
  const roomId = f.created.room.id;
  const bytes = Buffer.alloc(12 * 1024 * 1024, 0x5a);
  // Relay-level fixture: tests exact byte budget and SHA-256 independently of PNG decoding.
  const image = new Blob([bytes], { type: 'image/png' });
  const director = rawSocket(t, f, f.director);
  const failures = [];
  const publisher = createAssetClient(director, {
    roomId, director: true, getSource: async id => id === 'map' ? image : null,
    onError: error => failures.push(error)
  });
  t.after(() => publisher.close());
  await connect(director);
  const authority = await prove(director, localAuthority());
  await waitFor(() => publisher.epoch === authority.epoch, 'asset director epoch');
  const files = [{ id: 'map', sha256: sha256(bytes), mime: 'image/png', bytes: bytes.length }];
  const source = { map: { name: 'Large synthetic public map', widthPx: 2000, heightPx: 2000,
    widthCells: 20, heightCells: 20, xCells: -10, yCells: -10, imageId: 'map' },
    tokens: [{ id: authority.record.current.tokens[0].id, name: 'Public token',
      color: '#85dcd2', size: 1, imageId: null }], files: { map: image } };
  const completed = [];
  for (const member of [f.member, second]) {
    const socket = rawSocket(t, f, member);
    const client = createAssetClient(socket, { roomId,
      onUpdate: ({ blobs }) => { if (blobs.has('map')) completed.push({ member: member.user.id, blob: blobs.get('map') }); },
      onError: error => failures.push(error) });
    t.after(() => client.close());
    await connect(socket);
  }
  await publisher.publish(source);
  await waitFor(() => completed.length === 2, 'both complete 12 MiB media transfers', 90000);
  assert.equal(director.connected, true);
  assert.deepEqual(failures, []);
  assert.equal(completed.length, 2);
  for (const { blob } of completed) {
    assert.equal(blob.size, bytes.length);
    assert.equal(sha256(Buffer.from(await blob.arrayBuffer())), files[0].sha256);
  }
});

test('a sender chunk rejection reports the original error without a detached rejected promise', async () => {
  const roomId = randomUUID();
  const epoch = randomUUID();
  const bytes = Buffer.from('synthetic-data');
  const image = new Blob([bytes], { type: 'image/png' });
  const socket = new EventEmitter();
  socket.timeout = () => ({ emitWithAck: async () =>
    ({ ok: false, error: { code: 'TRANSFER_NOT_FOUND' } }) });
  const errors = [];
  const client = createAssetClient(socket, { roomId, director: true,
    getSource: async () => image, onError: error => errors.push(error) });
  try {
    socket.emit('room:authority', { version: 1, roomId, state: 'active', epoch });
    socket.emit('assets:requested', { version: 1, roomId, epoch, revision: 0,
      transferId: randomUUID(), asset: { id: 'map', sha256: sha256(bytes),
        mime: 'image/png', bytes: bytes.length } });
    await waitFor(() => errors.length > 0, 'recoverable sender rejection');
    assert.deepEqual(errors, ['TRANSFER_NOT_FOUND']);
  } finally { client.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { roomFixture } from './room-helpers.js';
import { rawSocket, connect, prove, localAuthority, send, waitFor } from './token-helpers.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sample = Buffer.from('synthetic PNG bytes for relay-only security tests, not an actual image');
function manifest(roomId, epoch, tokenId, bytes = sample) {
  return { roomId, epoch, revision: 1,
    map: { name: 'Public synthetic map', widthPx: 10, heightPx: 10,
      widthCells: 10, heightCells: 10, xCells: -5, yCells: -5, imageId: 'map' },
    tokens: [{ id: tokenId, name: 'Visible token', color: '#85dcd2', size: 1, imageId: null }],
    assets: [{ id: 'map', sha256: sha256(bytes), mime: 'image/png', bytes: bytes.length }] };
}

test('only verified room director can publish valid public media metadata', async t => {
  const f = await roomFixture(t);
  f.admit(f.member);
  const director = await connect(rawSocket(t, f, f.director));
  const state = await prove(director, localAuthority());
  const player = await connect(rawSocket(t, f, f.member));
  let seen;
  player.on('assets:manifest', message => { seen = message; });
  const content = manifest(f.created.room.id, state.epoch, state.record.current.tokens[0].id);
  assert.equal((await send(director, 'assets:publish', content)).revision, 1);
  await waitFor(() => seen?.revision === 1, 'manifest delivered to room member');
  assert.deepEqual(seen.assets[0], content.assets[0]);
  assert.equal((await send(director, 'assets:publish', content)).error?.code, 'STALE_ASSET_MANIFEST');
  assert.equal((await send(director, 'assets:publish', { ...content, epoch: 'not-an-epoch' })).error?.code, 'ASSET_MANIFEST_INVALID');
  assert.equal((await send(player, 'assets:publish', { ...content, revision: 2 })).error?.code, 'FORBIDDEN');
});

test('authorized member receives chunks through relay with downstream acknowledgement and SHA-256', async t => {
  const f = await roomFixture(t, { EVENT_RATE_LIMIT: '200' });
  f.admit(f.member);
  const director = await connect(rawSocket(t, f, f.director));
  const state = await prove(director, localAuthority());
  const player = await connect(rawSocket(t, f, f.member));
  const content = manifest(f.created.room.id, state.epoch, state.record.current.tokens[0].id);
  await send(director, 'assets:publish', content);
  const delivered = [];
  let finished, acknowledged, requested;
  player.on('assets:chunk', (message, ack) => { delivered.push(Buffer.from(message.data, 'base64')); ack({ ok: true }); });
  player.on('assets:finished', message => { finished = message; });
  director.on('assets:chunk:acked', message => { acknowledged = message; });
  director.on('assets:requested', message => { requested = message; });
  const start = await send(player, 'assets:request', { epoch: state.epoch, revision: 1, assetId: 'map' });
  assert.equal(start.ok, true);
  await waitFor(() => requested?.transferId === start.transferId, 'owner request');
  const answer = await send(director, 'assets:chunk', { epoch: state.epoch, transferId: start.transferId,
    offset: 0, data: sample.toString('base64') });
  assert.equal(answer.pending, true);
  await waitFor(() => acknowledged?.transferId === start.transferId, 'downstream acknowledgement');
  assert.equal((await send(director, 'assets:finish', { epoch: state.epoch, transferId: start.transferId })).status, 'sent');
  await waitFor(() => finished?.transferId === start.transferId, 'recipient finished');
  assert.equal(sha256(Buffer.concat(delivered)), content.assets[0].sha256);
  assert.equal(finished.sha256, content.assets[0].sha256);
});

test('relay rejects malformed chunks and refuses unauthorized rooms without writing media data', async t => {
  const f = await roomFixture(t);
  f.admit(f.member);
  const director = await connect(rawSocket(t, f, f.director));
  const state = await prove(director, localAuthority());
  const player = await connect(rawSocket(t, f, f.member));
  const content = manifest(f.created.room.id, state.epoch, state.record.current.tokens[0].id);
  await send(director, 'assets:publish', content);
  const start = await send(player, 'assets:request', { epoch: state.epoch, revision: 1, assetId: 'map' });
  assert.equal((await send(director, 'assets:chunk', { epoch: state.epoch, transferId: start.transferId,
    offset: 1, data: sample.toString('base64') })).error?.code, 'INVALID_CHUNK');
  assert.equal((await send(director, 'assets:finish', { epoch: state.epoch, transferId: start.transferId })).error?.code, 'TRANSFER_NOT_FOUND');
  // A vanished transfer is a recoverable conflict, not grounds to suspend
  // the entire room or disconnect its verified director.
  assert.equal(director.connected, true);
  assert.equal((await send(director, 'tokens:permissions:get')).ok, true);
  assert.equal((await send(player, 'assets:request', { epoch: state.epoch, revision: 1, assetId: 'secret' })).error?.code, 'ASSET_NOT_FOUND');
});

test('disconnecting the recipient while a fragment is in flight never disconnects the director', async t => {
  const f = await roomFixture(t);
  f.admit(f.member);
  const director = await connect(rawSocket(t, f, f.director));
  const state = await prove(director, localAuthority());
  const player = await connect(rawSocket(t, f, f.member));
  await send(director, 'assets:publish', manifest(f.created.room.id, state.epoch, state.record.current.tokens[0].id));
  const started = await send(player, 'assets:request', { epoch: state.epoch, revision: 1, assetId: 'map' });
  assert.equal(started.ok, true);
  player.disconnect();
  // The server must have processed the disconnect and removed its pending
  // relay before the director sends the now-stale fragment.
  await waitFor(() => ![...f.app.io.of('/').sockets.values()].some(socket =>
    socket.data.token === f.member.token), 'server processed recipient disconnect');
  const attempt = await send(director, 'assets:chunk', { epoch: state.epoch,
    transferId: started.transferId, offset: 0, data: sample.toString('base64') });
  assert.equal(attempt.error?.code, 'TRANSFER_NOT_FOUND');
  assert.equal(director.connected, true);
  assert.equal((await send(director, 'tokens:permissions:get')).ok, true);
});

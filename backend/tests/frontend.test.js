import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createFrontendServer } from '../scripts/dev-frontend.js';
import { initialRoomTokens, publicTokens, socketDestination } from '../../frontend/board-model.js';
import { roomFixture } from './room-helpers.js';
import { rawSocket, connect, prove, localAuthority, assign, send, waitFor } from './token-helpers.js';

test('vendored Socket.IO browser client and license match the pinned dependency', async () => {
  const source = new URL('../node_modules/socket.io-client/', import.meta.url);
  const publicFiles = new URL('../../frontend/vendor/', import.meta.url);
  assert.equal(JSON.parse(await readFile(new URL('package.json', source), 'utf8')).version, '4.8.4');
  assert.deepEqual(await readFile(new URL('dist/socket.io.esm.min.js', source)), await readFile(new URL('socket.io-4.8.4.esm.min.js', publicFiles)));
  assert.deepEqual(await readFile(new URL('LICENSE', source)), await readFile(new URL('socket.io-LICENSE.txt', publicFiles)));
});

test('room migration copies legacy IDs/positions without modifying or truncating local tokens', () => {
  const local = [{ id: 'starter-1', name: 'Legacy', color: '#85dcd2', x: -2, y: -1 }];
  const before = structuredClone(local);
  const migrated = initialRoomTokens(local);
  assert.match(migrated[0].id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(local, before);
  assert.equal(migrated[0].x, -2);
  assert.throws(() => initialRoomTokens(Array.from({ length: 65 }, () => local[0])), /TOKEN_LIMIT/);
  const uuid = randomUUID();
  assert.equal(initialRoomTokens([{ ...local[0], id: uuid }])[0].id, uuid);
  const snapshot = { tokens: [{ id: 'b', x: 2, y: 3 }, { id: 'a', x: 0, y: 1 }] };
  assert.deepEqual(publicTokens(snapshot).map(token => [token.id, token.code]), [['a', 'T1'], ['b', 'T2']]);
});

test('Socket.IO uses an explicit deployment prefix, never a namespace inferred from the URL', () => {
  assert.deepEqual(socketDestination({ realtimeBaseUrl: 'https://example.invalid/backend/', socketPath: '/socket.io' }),
    { origin: 'https://example.invalid', path: '/backend/socket.io' });
  assert.deepEqual(socketDestination({ realtimeBaseUrl: 'ws://localhost:3400', socketPath: '/socket.io' }),
    { origin: 'http://localhost:3400', path: '/socket.io' });
});

test('static development server serves root/subdirectory assets and denies secrets/source/database paths', async t => {
  for (const basePath of ['/', '/vtt/']) {
    const server = createFrontendServer({ basePath });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}${basePath}`;
    for (const file of ['', 'app.js', 'frontend/multiplayer.js', 'backend/client/token-client.js', 'backend/public/settings.html']) {
      assert.equal((await fetch(base + file)).status, 200);
    }
    for (const file of ['.env', '.git/config', 'backend/data/naufragio.sqlite', 'backend/src/storage.js', 'docs/RASPBERRY_SSH.md', '../.env']) {
      assert.equal((await fetch(base + file)).status, 404);
    }
  }
});

test('permission metadata is private, works in waiting state, and updates after assignment/revocation', async t => {
  const f = await roomFixture(t, { EVENT_RATE_LIMIT: '100' });
  f.admit(f.member, f.created, { moveAssignedTokens: true });
  const player = await connect(rawSocket(t, f, f.member));
  const waiting = await send(player, 'tokens:permissions:get');
  assert.equal(waiting.permissions.isOwner, false);
  assert.deepEqual(waiting.permissions.assignedTokenIds, []);
  assert.equal(Object.hasOwn(waiting.permissions, 'assignments'), false);
  const director = await connect(rawSocket(t, f, f.director));
  const owner = await prove(director, localAuthority());
  const id = owner.record.current.tokens[0].id;
  let last;
  player.on('tokens:permissions', value => { last = value.permissions; });
  await assign(director, owner, id, [f.member.user.id]);
  await waitFor(() => last?.assignedTokenIds.includes(id));
  assert.equal(Object.hasOwn(last, 'assignmentVersions'), false);
  const all = await send(director, 'tokens:permissions:get');
  assert.equal(all.permissions.assignmentVersions[id], 1);
  f.rooms.updateMember(f.director.token, f.created.room.id, f.member.user.id, { permissions: { moveAssignedTokens: false } });
  await waitFor(() => last?.moveAssignedTokens === false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { roomFixture } from './room-helpers.js';
import { createTokenClient, stateDigest } from '../client/token-client.js';
import { snapshot as canonicalSnapshot } from '../shared/token-state.js';
import { token, rawSocket, connect, send, prove, localAuthority, waitFor, memoryStore, moveInput, accept, assign } from './token-helpers.js';

async function wireFixture(t, env = {}, options = {}) {
  const f = await roomFixture(t, { EVENT_RATE_LIMIT: '1000', ...env }, options);
  const second = await f.account('second-token-user', 'user');
  f.admit(f.member, f.created, { moveAssignedTokens: true });
  f.admit(second, f.created, { moveAssignedTokens: true });
  const local = localAuthority([token(), token()]);
  const director = await connect(rawSocket(t, f, f.director));
  const owner = await prove(director, local);
  assert.equal(owner.result.ok, true);
  const one = await connect(rawSocket(t, f, f.member));
  const two = await connect(rawSocket(t, f, second));
  for (const item of local.current.tokens) assert.equal((await assign(director, owner, item.id, [f.member.user.id, second.user.id])).ok, true);
  return { ...f, second, directorSocket: director, owner, one, two, tokens: local.current.tokens };
}

test('three simulated clients converge after simultaneous moves, director moves and a missed event', async t => {
  const f = await roomFixture(t, { EVENT_RATE_LIMIT: '100' });
  const second = await f.account('three-client-two', 'user');
  f.admit(f.member, f.created, { moveAssignedTokens: true });
  f.admit(second, f.created, { moveAssignedTokens: true });
  const tokens = [token(), token()];
  const disk = memoryStore();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let hold = true;
  const directorSocket = rawSocket(t, f, f.director);
  const director = createTokenClient(directorSocket, { roomId: f.created.room.id, director: true, store: disk,
    initialTokens: tokens, acceptMove: async () => { if (hold) await gate; return true; } });
  t.after(() => director.close());
  await connect(directorSocket);
  await waitFor(() => director.state.ready, 'director proof');
  const oneSocket = rawSocket(t, f, f.member, f.created.room.id, { transports: ['polling'] });
  const twoSocket = rawSocket(t, f, second);
  const one = createTokenClient(oneSocket, { roomId: f.created.room.id });
  const two = createTokenClient(twoSocket, { roomId: f.created.room.id });
  t.after(() => { one.close(); two.close(); });
  await connect(oneSocket); await connect(twoSocket);
  await waitFor(() => one.state.snapshot && two.state.snapshot, 'initial snapshots');
  await director.assign(tokens[0].id, [f.member.user.id]);
  await director.assign(tokens[1].id, [second.user.id]);
  const started = performance.now();
  const results = await Promise.all([one.move(tokens[0].id, { x: 10, y: 20 }), two.move(tokens[1].id, { x: 30, y: 40 })]);
  assert.ok(results.every(result => result.status === 'pending'));
  hold = false; release();
  await waitFor(() => [director, one, two].every(client => client.state.snapshot?.revision === 2), 'two commits');
  t.diagnostic(`Two simultaneous requests → three clients at revision 2: ${(performance.now() - started).toFixed(2)} ms (Windows loopback)`);
  assert.deepEqual(one.state.snapshot, director.state.snapshot);
  assert.deepEqual(two.state.snapshot, director.state.snapshot);
  // The director needs neither an assignment nor the participant movement flag.
  const listeners = twoSocket.listeners('token:move:committed');
  twoSocket.removeAllListeners('token:move:committed');
  await director.move(tokens[1].id, { x: 50, y: 60 });
  await waitFor(() => one.state.snapshot?.revision === 3, 'director commit');
  assert.equal(two.state.snapshot.revision, 2);
  for (const listener of listeners) twoSocket.on('token:move:committed', listener);
  await director.move(tokens[0].id, { x: 70, y: 80 });
  await waitFor(() => [director, one, two].every(client => client.state.snapshot?.revision === 4), 'gap resynchronization');
  assert.deepEqual(one.state.snapshot, director.state.snapshot);
  assert.deepEqual(two.state.snapshot, director.state.snapshot);
  assert.deepEqual((await disk.load()).current, director.state.snapshot);
  assert.equal((await disk.load()).staged, null);
});

test('duplicate requests/acceptances commit once; altered IDs and obsolete versions fail', async t => {
  const f = await wireFixture(t);
  const input = moveInput(f.owner, f.tokens[0]);
  const requests = [], commits = [];
  f.directorSocket.on('token:move:requested', value => requests.push(value));
  f.one.on('token:move:committed', value => commits.push(value));
  assert.equal((await send(f.one, 'token:move:request', input)).status, 'pending');
  assert.equal((await send(f.one, 'token:move:request', input)).status, 'pending');
  await waitFor(() => requests.length === 1);
  assert.equal((await send(f.one, 'token:move:request', { ...input, position: { x: 99, y: 99 } })).error.code, 'EVENT_ID_REUSED');
  assert.equal((await accept(f.directorSocket, f.owner, input)).status, 'committed');
  assert.equal((await send(f.one, 'token:move:request', input)).status, 'committed');
  const again = await send(f.directorSocket, 'token:move:accept', { epoch: f.owner.epoch, eventId: input.eventId,
    revision: 1, stateDigest: await stateDigest(f.owner.record.current) });
  assert.equal(again.status, 'committed');
  assert.equal(commits.length, 1);
  assert.equal((await send(f.one, 'token:move:request', { ...input, eventId: randomUUID() })).error.code, 'STALE_MOVE');
  assert.equal(f.app.store.db.prepare('SELECT revision FROM room_authority').get().revision, 1);
});

test('simultaneous requests on one token conflict and can retry against the confirmed version', async t => {
  const f = await wireFixture(t);
  const first = moveInput(f.owner, f.tokens[0]);
  const second = { ...first, eventId: randomUUID(), position: { x: 8, y: 9 } };
  const results = await Promise.all([send(f.one, 'token:move:request', first), send(f.two, 'token:move:request', second)]);
  const index = results.findIndex(result => result.ok);
  assert.equal(results[1 - index].error.code, 'TOKEN_BUSY');
  const winner = index === 0 ? first : second;
  assert.equal((await accept(f.directorSocket, f.owner, winner)).status, 'committed');
  const retry = { ...moveInput(f.owner, f.owner.record.current.tokens[0]), position: { x: 11, y: 12 } };
  assert.equal((await send(index === 0 ? f.two : f.one, 'token:move:request', retry)).status, 'pending');
  assert.equal((await accept(f.directorSocket, f.owner, retry)).status, 'committed');
  assert.equal(f.owner.record.current.revision, 2);
});

test('director rejection does not alter official state and cannot later be accepted', async t => {
  const f = await wireFixture(t);
  const input = moveInput(f.owner, f.tokens[0]);
  await send(f.one, 'token:move:request', input);
  const rejected = once(f.one, 'token:move:rejected', { signal: AbortSignal.timeout(3000) });
  assert.equal((await send(f.directorSocket, 'token:move:reject', { epoch: f.owner.epoch, eventId: input.eventId, reason: 'DIRECTOR_REJECTED' })).status, 'rejected');
  assert.equal((await rejected)[0].reason, 'DIRECTOR_REJECTED');
  assert.equal((await accept(f.directorSocket, f.owner, input)).status, 'rejected');
  assert.equal(f.app.store.db.prepare('SELECT revision FROM room_authority').get().revision, 0);
});

test('movement flags and assignments are both required; pending grants are rechecked', async t => {
  const f = await wireFixture(t);
  const input = moveInput(f.owner, f.tokens[0]);
  await send(f.one, 'token:move:request', input);
  f.rooms.updateMember(f.director.token, f.created.room.id, f.member.user.id, { permissions: { moveAssignedTokens: false } });
  assert.equal((await accept(f.directorSocket, f.owner, input)).reason, 'PERMISSION_REVOKED');
  assert.equal((await send(f.one, 'token:move:request', { ...input, eventId: randomUUID() })).error.code, 'FORBIDDEN');
  const other = moveInput(f.owner, f.tokens[1]);
  await send(f.two, 'token:move:request', other);
  assert.equal((await assign(f.directorSocket, f.owner, f.tokens[1].id, [], 1)).ok, true);
  assert.equal((await accept(f.directorSocket, f.owner, other)).reason, 'ASSIGNMENT_CHANGED');
  assert.equal((await send(f.two, 'token:move:request', { ...other, eventId: randomUUID() })).error.code, 'FORBIDDEN');
  assert.equal(f.app.store.db.prepare('SELECT revision FROM room_authority').get().revision, 0);
});

test('assignment versions prevent stale regrant and membership revocation clears assignments', async t => {
  const f = await wireFixture(t);
  const payload = { epoch: f.owner.epoch, eventId: randomUUID(), tokenId: f.tokens[0].id, assignmentVersion: 1, userIds: [] };
  assert.equal((await send(f.directorSocket, 'token:assign', payload)).assignmentVersion, 2);
  assert.equal((await send(f.directorSocket, 'token:assign', payload)).assignmentVersion, 2);
  assert.equal((await send(f.directorSocket, 'token:assign', { ...payload, eventId: randomUUID(), userIds: [f.member.user.id] })).error.code, 'STALE_ASSIGNMENT');
  f.rooms.revokeMember(f.director.token, f.created.room.id, f.member.user.id);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM token_assignments WHERE user_id=?').get(f.member.user.id).n, 0);
});

test('participants cannot impersonate the director, submit content or route to another party', async t => {
  const f = await wireFixture(t);
  const other = f.rooms.create(f.director.token, { name: 'Isolated tokens' });
  const outsider = await connect(rawSocket(t, f, f.director, other.room.id));
  const seen = [];
  outsider.on('token:move:committed', event => seen.push(event));
  const input = moveInput(f.owner, f.tokens[0]);
  for (const extra of [{ role: 'director' }, { actorId: f.director.user.id }, { assigned: true }, { roomId: other.room.id }]) {
    assert.equal((await send(f.one, 'token:move:request', { ...input, ...extra })).error.code, 'INVALID_MESSAGE');
  }
  for (const point of [{ x: null, y: 0 }, { x: 1000001, y: 0 }, { x: 0, y: 0, mapId: 'secret' }]) {
    assert.equal((await send(f.one, 'token:move:request', { ...input, position: point })).error.code, 'INVALID_MESSAGE');
  }
  for (const event of ['token:move:committed', 'tokens:snapshot', 'image:chunk', 'map:activate', 'dice:roll', 'chat:message']) {
    assert.equal((await send(f.one, event, input)).error.code, 'EVENT_NOT_AVAILABLE');
  }
  await send(f.one, 'token:move:request', input);
  assert.equal((await accept(f.directorSocket, f.owner, input)).status, 'committed');
  assert.equal(seen.length, 0);
  const fake = await send(f.one, 'token:move:accept', { epoch: f.owner.epoch, eventId: randomUUID(), revision: 2, stateDigest: '0'.repeat(64) });
  assert.equal(fake.error.code, 'FORBIDDEN');
  assert.equal(f.app.store.db.prepare('SELECT revision FROM room_authority WHERE room_id=?').get(f.created.room.id).revision, 1);
});

test('disconnect suspends movements; a new device or stale snapshot cannot reclaim authority', async t => {
  const f = await wireFixture(t);
  const input = moveInput(f.owner, f.tokens[0]);
  await send(f.one, 'token:move:request', input);
  const waiting = once(f.one, 'room:authority', { signal: AbortSignal.timeout(3000) });
  f.directorSocket.disconnect();
  assert.equal((await waiting)[0].state, 'waiting');
  assert.equal((await send(f.one, 'token:move:request', input)).error.code, 'DIRECTOR_NOT_READY');
  const fresh = await connect(rawSocket(t, f, f.director));
  const impostor = localAuthority(f.owner.record.current.tokens);
  impostor.current = structuredClone(f.owner.record.current);
  assert.equal((await prove(fresh, impostor)).result.error.code, 'OFFICIAL_STATE_MISMATCH');
  const corrupt = { ...f.owner.record, current: structuredClone(f.owner.record.current) };
  corrupt.current.tokens[0].x++;
  assert.equal((await prove(fresh, corrupt)).result.error.code, 'OFFICIAL_STATE_MISMATCH');
  const recovered = await prove(fresh, f.owner.record);
  assert.equal(recovered.result.ok, true);
  assert.notEqual(recovered.epoch, f.owner.epoch);
  assert.equal((await send(f.one, 'token:move:request', input)).error.code, 'STALE_EPOCH');
  assert.equal((await send(fresh, 'token:move:accept', { epoch: recovered.epoch, eventId: input.eventId, revision: 1, stateDigest: '0'.repeat(64) })).error.code, 'MOVE_NOT_PENDING');
  const replay = await prove(fresh, f.owner.record);
  assert.equal(replay.result.error.code, 'INVALID_CHALLENGE');
});

test('expired requests and disconnected requesters cannot be accepted later', async t => {
  let now = 1000000;
  const f = await wireFixture(t, {}, { clock: () => now });
  const input = moveInput(f.owner, f.tokens[0]);
  await send(f.one, 'token:move:request', input);
  now += 10001; f.app.presence.refresh();
  assert.equal((await accept(f.directorSocket, f.owner, input)).reason, 'MOVE_EXPIRED');
  const next = moveInput(f.owner, f.tokens[1]);
  await send(f.two, 'token:move:request', next);
  const left = once(f.directorSocket, 'token:move:rejected', { signal: AbortSignal.timeout(3000) });
  f.two.disconnect();
  assert.equal((await left)[0].reason, 'REQUESTER_DISCONNECTED');
  assert.equal((await accept(f.directorSocket, f.owner, next)).status, 'rejected');
});

test('sync snapshots must match the durable checkpoint and only reach the requested member', async t => {
  const f = await wireFixture(t);
  // Deliberately reverse UUID order: the protocol emits a canonical snapshot.
  f.owner.record.current.tokens.sort((a, b) => a.id < b.id ? 1 : -1);
  const requested = once(f.directorSocket, 'tokens:sync:requested', { signal: AbortSignal.timeout(3000) });
  await send(f.one, 'tokens:sync:request', { epoch: f.owner.epoch, eventId: randomUUID() });
  const [request] = await requested;
  const damaged = structuredClone(f.owner.record.current);
  damaged.tokens[0].x = 999;
  assert.equal((await send(f.directorSocket, 'tokens:sync:provide', { epoch: f.owner.epoch, syncId: request.syncId, snapshot: damaged })).error.code, 'OFFICIAL_STATE_MISMATCH');
  const snapshots = [];
  f.two.on('tokens:snapshot', value => snapshots.push(value));
  const delivered = once(f.one, 'tokens:snapshot', { signal: AbortSignal.timeout(3000) });
  assert.equal((await send(f.directorSocket, 'tokens:sync:provide', { epoch: f.owner.epoch, syncId: request.syncId, snapshot: f.owner.record.current })).status, 'sent');
  assert.deepEqual((await delivered)[0].snapshot, canonicalSnapshot(f.owner.record.current));
  assert.equal(snapshots.length, 0);
});

test('failed local writes suspend authority; a staged committed state recovers after lost completion', async t => {
  const f = await roomFixture(t, { EVENT_RATE_LIMIT: '100' });
  f.admit(f.member, f.created, { moveAssignedTokens: true });
  const baseStore = memoryStore();
  let failStage = true;
  const disk = { load: () => baseStore.load(), save: next => {
    if (next.staged && failStage) { failStage = false; throw new Error('LOCAL_WRITE_FAILED'); }
    return baseStore.save(next);
  } };
  const item = token();
  let socket = rawSocket(t, f, f.director);
  let director = createTokenClient(socket, { roomId: f.created.room.id, director: true, store: disk, initialTokens: [item] });
  await connect(socket); await waitFor(() => director.state.ready);
  await director.move(item.id, { x: 1, y: 2 });
  await waitFor(() => director.state.error === 'LOCAL_WRITE_FAILED');
  assert.equal(f.app.store.db.prepare('SELECT revision FROM room_authority').get().revision, 0);
  director.close();
  let failCompletion = true;
  const crashStore = { load: () => baseStore.load(), save: next => {
    if (next.current.revision === 1 && !next.staged && failCompletion) { failCompletion = false; throw new Error('COMPLETION_LOST'); }
    return baseStore.save(next);
  } };
  socket = rawSocket(t, f, f.director);
  director = createTokenClient(socket, { roomId: f.created.room.id, director: true, store: crashStore });
  await connect(socket); await waitFor(() => director.state.ready);
  await director.move(item.id, { x: 3, y: 4 });
  await waitFor(() => director.state.error === 'COMPLETION_LOST');
  assert.equal(f.app.store.db.prepare('SELECT revision FROM room_authority').get().revision, 1);
  assert.equal((await baseStore.load()).current.revision, 0);
  assert.equal((await baseStore.load()).staged.revision, 1);
  director.close();
  const restoredSocket = rawSocket(t, f, f.director);
  const restored = createTokenClient(restoredSocket, { roomId: f.created.room.id, director: true, store: baseStore });
  t.after(() => restored.close());
  await connect(restoredSocket); await waitFor(() => restored.state.ready);
  assert.equal(restored.state.snapshot.revision, 1);
  assert.equal(restored.state.snapshot.tokens[0].x, 3);
  assert.equal((await baseStore.load()).staged, null);
});

test('client without local state refuses authority instead of inventing IndexedDB recovery', async t => {
  const f = await wireFixture(t);
  const socket = rawSocket(t, f, f.director);
  const client = createTokenClient(socket, { roomId: f.created.room.id, director: true, store: memoryStore(), initialTokens: [token()] });
  t.after(() => client.close());
  await connect(socket);
  await waitFor(() => client.state.error === 'OFFICIAL_STATE_UNAVAILABLE');
  assert.equal(client.state.ready, false);
  assert.equal(f.app.store.db.prepare('SELECT revision FROM room_authority').get().revision, 0);
});

test('another login cannot replace a verified director until it proves the same local state', async t => {
  const f = await wireFixture(t);
  const candidate = await connect(rawSocket(t, f, f.director));
  const wrong = localAuthority();
  wrong.current = structuredClone(f.owner.record.current);
  assert.equal((await prove(candidate, wrong)).result.error.code, 'OFFICIAL_STATE_MISMATCH');
  assert.equal(f.directorSocket.connected, true);
  const input = moveInput(f.owner, f.tokens[0]);
  assert.equal((await send(candidate, 'token:move:request', input)).error.code, 'DIRECTOR_NOT_READY');
  await send(f.one, 'token:move:request', input);
  assert.equal((await accept(f.directorSocket, f.owner, input)).status, 'committed');
  const replaced = once(f.directorSocket, 'disconnect', { signal: AbortSignal.timeout(3000) });
  assert.equal((await prove(candidate, f.owner.record)).result.ok, true);
  await replaced;
});

test('initial proof validates signatures, token bounds and shape before creating a checkpoint', async t => {
  const f = await roomFixture(t, { EVENT_RATE_LIMIT: '100' });
  const socket = await connect(rawSocket(t, f, f.director));
  await waitFor(() => socket.challenge);
  const local = localAuthority();
  const payload = { challenge: socket.challenge.challenge, snapshot: local.current,
    publicKey: local.keys.publicKey.export({ format: 'jwk' }), signature: 'A'.repeat(86) };
  assert.equal((await send(socket, 'authority:claim', payload)).error.code, 'INVALID_PROOF');
  for (const tokens of [[...Array.from({ length: 65 }, token)], [local.current.tokens[0], local.current.tokens[0]],
    [{ ...local.current.tokens[0], character: { hp: 10 } }]]) {
    assert.equal((await send(socket, 'authority:claim', { ...payload, snapshot: { ...local.current, tokens } })).error.code, 'INVALID_MESSAGE');
  }
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM room_authority').get().n, 0);
  assert.equal((await prove(socket, local)).result.ok, true);
});

test('a confirmation must match the pending coordinates, revision and computed checkpoint', async t => {
  const f = await wireFixture(t);
  const input = moveInput(f.owner, f.tokens[0]);
  await send(f.one, 'token:move:request', input);
  assert.equal((await send(f.directorSocket, 'token:move:accept', { epoch: f.owner.epoch, eventId: input.eventId,
    revision: 2, stateDigest: '0'.repeat(64) })).error.code, 'STALE_MOVE');
  assert.equal((await send(f.directorSocket, 'token:move:accept', { epoch: f.owner.epoch, eventId: input.eventId,
    revision: 1, stateDigest: '0'.repeat(64) })).error.code, 'OFFICIAL_STATE_MISMATCH');
  assert.equal(f.app.store.db.prepare('SELECT revision FROM room_authority').get().revision, 0);
  assert.equal((await accept(f.directorSocket, f.owner, input)).status, 'committed');
});

test('an uncommitted local journal is discarded when recovering the confirmed checkpoint', async t => {
  const f = await roomFixture(t, { EVENT_RATE_LIMIT: '100' });
  const disk = memoryStore();
  const firstSocket = rawSocket(t, f, f.director);
  const first = createTokenClient(firstSocket, { roomId: f.created.room.id, director: true, store: disk, initialTokens: [token()] });
  await connect(firstSocket); await waitFor(() => first.state.ready);
  const record = await disk.load();
  record.staged = structuredClone(record.current);
  record.staged.revision++;
  record.staged.tokens[0].tokenVersion++;
  record.staged.tokens[0].x = 100;
  await disk.save(record);
  first.close();
  const socket = rawSocket(t, f, f.director);
  const next = createTokenClient(socket, { roomId: f.created.room.id, director: true, store: disk });
  t.after(() => next.close());
  await connect(socket); await waitFor(() => next.state.ready);
  assert.equal(next.state.snapshot.revision, 0);
  assert.equal(next.state.snapshot.tokens[0].x, 0);
  assert.equal((await disk.load()).staged, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { roomFixture } from './room-helpers.js';
import { origin } from './helpers.js';
import { prove, localAuthority } from './token-helpers.js';

function socketFor(t, base, account, roomId, extra = {}) {
  const socket = io(base.url, { autoConnect: false, reconnection: false, forceNew: true, timeout: 2000,
    extraHeaders: { Origin: origin }, transports: ['websocket'], auth: { token: account.token, roomId }, ...extra });
  socket.roomId = roomId;
  socket.on('authority:challenge', value => { socket.challenge = value; });
  t.after(() => socket.disconnect());
  return socket;
}
async function connect(socket) {
  const ready = new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); socket.off('connect', good); socket.off('connect_error', bad); };
    const good = () => { cleanup(); resolve(); };
    const bad = error => { cleanup(); reject(error); };
    const timer = setTimeout(() => bad(new Error('CONNECTION_TIMEOUT')), 3000);
    socket.once('connect', good);
    socket.once('connect_error', bad);
  });
  socket.connect();
  await ready;
}
async function denied(socket) {
  const failed = once(socket, 'connect_error', { signal: AbortSignal.timeout(3000) });
  socket.connect();
  const [error] = await failed;
  assert.equal(socket.connected, false);
  socket.disconnect();
  return error.data?.code;
}
const requestPresence = async socket => (await socket.timeout(1500).emitWithAck('room:presence:get', { version: 1 })).presence;
const disconnecting = socket => once(socket, 'disconnect', { signal: AbortSignal.timeout(3000) });

test('presence messages validate versions, reject extra fields and enforce event limits', async t => {
  const f = await roomFixture(t, { EVENT_RATE_LIMIT: '3' });
  const socket = socketFor(t, f, f.director, f.created.room.id);
  await connect(socket);
  for (const payload of [{ version: 2 }, { version: 1, ownerId: f.member.user.id }, null]) {
    const result = await socket.timeout(1500).emitWithAck('room:presence:get', payload);
    assert.equal(result.ok, false);
  }
  const left = disconnecting(socket);
  const limited = await socket.timeout(1500).emitWithAck('room:presence:get', { version: 1 });
  assert.equal(limited.error.code, 'RATE_LIMITED');
  await left;
});

test('both transports enforce identity, membership, Origin and strict handshakes', async t => {
  const f = await roomFixture(t);
  const id = f.created.room.id;
  for (const transport of ['polling', 'websocket']) {
    assert.equal(await denied(socketFor(t, f, f.member, id, { transports: [transport] })), 'ROOM_ACCESS_DENIED');
    assert.equal(await denied(socketFor(t, f, f.director, randomUUID(), { transports: [transport] })), 'ROOM_ACCESS_DENIED');
    assert.equal(await denied(socketFor(t, f, f.member, id, { transports: [transport], auth: { token: f.member.token, roomId: id, role: 'director' } })), 'INVALID_INPUT');
  }
  f.admit(f.member);
  for (const transport of ['polling', 'websocket']) {
    const socket = socketFor(t, f, f.member, id, { transports: [transport] });
    await connect(socket);
    assert.equal((await requestPresence(socket)).state, 'waiting');
    socket.disconnect();
  }
  assert.equal(await denied(socketFor(t, f, f.member, id, { auth: { token: 'invalid', roomId: id } })), 'UNAUTHENTICATED');
  const forbidden = socketFor(t, f, f.member, id, { extraHeaders: { Origin: 'https://evil.invalid' } });
  await denied(forbidden);
});

test('disconnect waits without electing a participant; owner reconnection preserves authority', async t => {
  const f = await roomFixture(t);
  const local = localAuthority();
  const id = f.created.room.id;
  f.admit(f.member);
  const member = socketFor(t, f, f.member, id);
  await connect(member);
  assert.equal((await requestPresence(member)).state, 'waiting');
  const director = socketFor(t, f, f.director, id);
  await connect(director);
  assert.equal((await requestPresence(member)).state, 'waiting');
  assert.equal((await prove(director, local)).result.ok, true);
  assert.equal((await requestPresence(member)).state, 'active');
  const duplicate = socketFor(t, f, f.member, id);
  await connect(duplicate);
  assert.equal((await requestPresence(member)).participants.length, 2);
  duplicate.disconnect();
  const left = disconnecting(director);
  director.disconnect();
  await left;
  // A request refreshes access and presence, so the assertion does not depend on a transport delay.
  f.app.presence.refresh();
  const waiting = await requestPresence(member);
  assert.equal(waiting.state, 'waiting');
  assert.equal(waiting.ownerId, f.director.user.id);
  assert.deepEqual(waiting.participants.map(user => user.role), ['participant']);
  const reconnected = socketFor(t, f, f.director, id);
  await connect(reconnected);
  assert.equal((await prove(reconnected, local)).result.ok, true);
  assert.equal((await requestPresence(member)).state, 'active');
  const replaced = disconnecting(reconnected);
  const newest = socketFor(t, f, f.director, id);
  await connect(newest);
  assert.equal((await requestPresence(member)).state, 'active');
  assert.equal((await prove(newest, local)).result.ok, true);
  await replaced;
  const state = await requestPresence(member);
  assert.equal(state.state, 'active');
  assert.equal(state.participants.filter(user => user.role === 'director').length, 1);
});

test('presence and grants are isolated between parties; unsupported game messages stay closed', async t => {
  const f = await roomFixture(t);
  const other = await f.account('other-member-test', 'user');
  const second = f.rooms.create(f.director.token, { name: 'Second isolated party' });
  f.admit(f.member);
  f.admit(other, second);
  const first = socketFor(t, f, f.member, f.created.room.id);
  const next = socketFor(t, f, other, second.room.id);
  const snapshots = [];
  next.on('room:presence', value => snapshots.push(value));
  await connect(first);
  await connect(next);
  assert.equal(await denied(socketFor(t, f, other, f.created.room.id)), 'ROOM_ACCESS_DENIED');
  for (const event of ['token:move', 'token:confirm', 'map:activate', 'image:chunk', 'room:presence', 'room:join']) {
    const response = await first.timeout(1500).emitWithAck(event, { version: 1, roomId: second.room.id, role: 'director' });
    assert.equal(response.error.code, 'EVENT_NOT_AVAILABLE');
  }
  const forged = await first.timeout(1500).emitWithAck('room:presence:get', { version: 1, roomId: second.room.id });
  assert.equal(forged.ok, false);
  f.rooms.updateMember(f.director.token, f.created.room.id, f.member.user.id, { permissions: { diceAllowed: true } });
  assert.equal(f.rooms.get(other.token, second.room.id).permissions.diceAllowed, false);
  const state = await requestPresence(next);
  assert.equal(state.roomId, second.room.id);
  assert.deepEqual(state.participants.map(user => user.id), [other.user.id]);
  for (const value of snapshots) {
    assert.equal(value.roomId, second.room.id);
    assert.equal(value.participants.some(user => user.id === f.member.user.id), false);
  }
});

test('membership revocation disconnects just that party and cannot be undone with the old code', async t => {
  const f = await roomFixture(t);
  const second = f.rooms.create(f.director.token, { name: 'Still authorized' });
  f.admit(f.member);
  f.admit(f.member, second);
  const first = socketFor(t, f, f.member, f.created.room.id);
  const other = socketFor(t, f, f.member, second.room.id);
  await connect(first);
  await connect(other);
  const left = disconnecting(first);
  f.rooms.revokeMember(f.director.token, f.created.room.id, f.member.user.id);
  await left;
  assert.equal(other.connected, true);
  assert.equal((await requestPresence(other)).roomId, second.room.id);
  assert.equal(await denied(socketFor(t, f, f.member, f.created.room.id)), 'ROOM_ACCESS_DENIED');
  assert.throws(() => f.rooms.join(f.member.token, { code: f.created.admissionCode.code }), error => error.code === 'ROOM_ACCESS_DENIED');
});

test('logout and role changes invalidate live authority without promoting other accounts', async t => {
  const f = await roomFixture(t);
  const local = localAuthority();
  f.admit(f.member);
  const id = f.created.room.id;
  const member = socketFor(t, f, f.member, id);
  const director = socketFor(t, f, f.director, id);
  await connect(member);
  await connect(director);
  assert.equal((await prove(director, local)).result.ok, true);
  let left = disconnecting(director);
  f.auth.logout(f.director.token);
  await left;
  assert.equal((await requestPresence(member)).state, 'waiting');
  const current = await f.auth.login({ username: f.director.user.username, password: f.director.secret });
  const reconnected = socketFor(t, f, current, id);
  await connect(reconnected);
  assert.equal((await prove(reconnected, local)).result.ok, true);
  left = disconnecting(reconnected);
  f.auth.updateUser(f.token, f.director.user.id, { role: 'user' });
  await left;
  assert.equal((await requestPresence(member)).state, 'waiting');
  assert.equal((await requestPresence(member)).participants[0].role, 'participant');
  assert.equal(await denied(socketFor(t, f, current, id)), 'UNAUTHENTICATED');
  const memberLeft = disconnecting(member);
  f.auth.updateUser(f.token, f.member.user.id, { disabled: true });
  await memberLeft;
});

test('session expiration removes the director and later the participant', async t => {
  let now = 1000000;
  const f = await roomFixture(t, { SESSION_TTL_SECONDS: '60' }, { clock: () => now });
  f.admit(f.member);
  now += 30000;
  const later = await f.auth.login({ username: f.member.user.username, password: f.member.secret });
  const member = socketFor(t, f, later, f.created.room.id);
  const director = socketFor(t, f, f.director, f.created.room.id);
  await connect(member);
  await connect(director);
  assert.equal((await prove(director)).result.ok, true);
  const ownerLeft = disconnecting(director);
  now += 30000;
  f.app.presence.refresh();
  await ownerLeft;
  assert.equal((await requestPresence(member)).state, 'waiting');
  const memberLeft = disconnecting(member);
  now += 30000;
  f.app.presence.refresh();
  await memberLeft;
});

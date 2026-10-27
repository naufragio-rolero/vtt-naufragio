import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { roomFixture } from './room-helpers.js';
import { api } from './auth-helpers.js';
import { createRoomService } from '../src/rooms/service.js';

const hasCode = code => error => error.code === code;

test('room creation requires direction and binds immutable ownership to the session', async t => {
  const { url, token, director, member, created, rooms, app } = await roomFixture(t);
  assert.match(created.admissionCode.code, /^room_[A-Za-z0-9_-]{22}$/);
  assert.equal(created.room.ownerId, director.user.id);
  for (const session of [token, member.token]) {
    assert.equal((await api(url, '/rooms', { method: 'POST', token: session, body: { name: 'Denied' } })).status, 403);
  }
  for (const extra of [{ ownerId: member.user.id }, { state: 'active' }, { map: 'content' }, { role: 'admin' }]) {
    assert.equal((await api(url, '/rooms', { method: 'POST', token: director.token, body: { name: 'Invalid', ...extra } })).status, 400);
  }
  const createdHttp = await api(url, '/rooms', { method: 'POST', token: director.token, body: { name: 'Second party' } });
  assert.equal(createdHttp.status, 201);
  assert.notEqual(createdHttp.data.room.id, created.room.id);
  assert.notEqual(createdHttp.data.admissionCode.code, created.admissionCode.code);
  assert.equal((await api(url, '/rooms', { token: member.token })).data.rooms.length, 0);
  assert.equal((await api(url, '/rooms', { token: director.token })).data.rooms.length, 2);
  assert.equal((await api(url, `/rooms/${created.room.id}`, { token: member.token })).status, 404);
  assert.equal((await api(url, `/rooms/${randomUUID()}`, { token: member.token })).status, 404);
  assert.equal(JSON.stringify(rooms.list(director.token)).includes(created.admissionCode.code), false);
  const persisted = app.store.db.prepare('SELECT code_hash FROM room_codes WHERE room_id=?').get(created.room.id);
  assert.match(persisted.code_hash, /^[a-f0-9]{64}$/);
});

test('code possession alone is insufficient; named invitations admit with all permissions denied', async t => {
  const { url, rooms, director, member, created, token, auth } = await roomFixture(t);
  const code = created.admissionCode.code;
  assert.equal((await api(url, '/rooms/join', { method: 'POST', token: member.token, body: { code } })).status, 404);
  const issued = await api(url, `/rooms/${created.room.id}/invitations`, { method: 'POST', token: director.token, body: { userId: member.user.id } });
  assert.equal(issued.status, 201);
  assert.equal(issued.data.invitation.kind, 'room_membership');
  assert.deepEqual(issued.data.invitation.permissions, { diceAllowed: false, moveAssignedTokens: false });
  const invitations = await api(url, '/room-invitations', { token: member.token });
  assert.equal(invitations.data.invitations.length, 1);
  assert.equal((await api(url, '/room-invitations', { token })).data.invitations.length, 0);
  assert.throws(() => rooms.join(token, { code }), hasCode('ROOM_ACCESS_DENIED'));
  const signup = auth.createInvitation(director.token, {});
  for (const invalid of [signup.token, member.token, 'invalid', `room_${randomBytes(16).toString('base64url')}`]) {
    assert.throws(() => rooms.join(member.token, { code: invalid }), hasCode('ROOM_ACCESS_DENIED'));
  }
  const accepted = await api(url, '/rooms/join', { method: 'POST', token: member.token, body: { code } });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.isOwner, false);
  assert.deepEqual(accepted.data.permissions, { diceAllowed: false, moveAssignedTokens: false });
  assert.equal(rooms.invitations(member.token).length, 0);
  assert.deepEqual(rooms.join(member.token, { code }), accepted.data);
  assert.equal(rooms.list(member.token).length, 1);
});

test('permissions are scoped to a room and grantable only by its owner', async t => {
  const { url, rooms, director, member, created, admit, token } = await roomFixture(t);
  admit(member);
  const second = rooms.create(director.token, { name: 'Other party' });
  admit(member, second);
  const path = `/rooms/${created.room.id}/members/${member.user.id}`;
  assert.equal((await api(url, path, { method: 'PATCH', token: member.token, body: { permissions: { diceAllowed: true } } })).status, 403);
  assert.equal((await api(url, path, { method: 'PATCH', token, body: { permissions: { diceAllowed: true } } })).status, 403);
  const changed = await api(url, path, { method: 'PATCH', token: director.token, body: { permissions: { diceAllowed: true } } });
  assert.equal(changed.status, 200);
  assert.deepEqual(rooms.get(member.token, created.room.id).permissions, { diceAllowed: true, moveAssignedTokens: false });
  assert.deepEqual(rooms.get(member.token, second.room.id).permissions, { diceAllowed: false, moveAssignedTokens: false });
  for (const permissions of [{ createRooms: true }, { uploads: true }, { tokens: ['t1'] }, { diceAllowed: 'true' }]) {
    assert.equal((await api(url, path, { method: 'PATCH', token: director.token, body: { permissions } })).status, 400);
  }
  assert.equal((await api(url, `/rooms/${created.room.id}/members`, { token: director.token })).data.members.length, 2);
  assert.equal((await api(url, `/rooms/${created.room.id}/members`, { token: member.token })).status, 403);
  assert.throws(() => rooms.revokeMember(director.token, created.room.id, director.user.id), hasCode('OWNER_IMMUTABLE'));
});

test('expired, revoked and replaced room codes never grant admission', async t => {
  let now = 1000000;
  const { rooms, director, member, created } = await roomFixture(t, { ROOM_CODE_TTL_SECONDS: '60' }, { clock: () => now });
  rooms.invite(director.token, created.room.id, { userId: member.user.id });
  now += 60000;
  assert.throws(() => rooms.join(member.token, { code: created.admissionCode.code }), hasCode('ROOM_ACCESS_DENIED'));
  const second = rooms.rotateCode(director.token, created.room.id);
  assert.notEqual(second.code, created.admissionCode.code);
  rooms.revokeCode(director.token, created.room.id);
  assert.throws(() => rooms.join(member.token, { code: second.code }), hasCode('ROOM_ACCESS_DENIED'));
  const third = rooms.rotateCode(director.token, created.room.id);
  rooms.join(member.token, { code: third.code });
  rooms.revokeCode(director.token, created.room.id);
  assert.equal(rooms.get(member.token, created.room.id).isOwner, false); // Admission and ongoing membership are separate.
});

test('room invitations expire, can be revoked, and cannot be replayed after membership revocation', async t => {
  let now = 1000000;
  const { rooms, director, member, created, url } = await roomFixture(t, {}, { clock: () => now });
  const roomId = created.room.id;
  rooms.invite(director.token, roomId, { userId: member.user.id, expiresInSeconds: 60 });
  now += 60000;
  assert.throws(() => rooms.join(member.token, { code: created.admissionCode.code }), hasCode('ROOM_ACCESS_DENIED'));
  const revoked = rooms.invite(director.token, roomId, { userId: member.user.id });
  assert.equal((await api(url, `/rooms/${roomId}/invitations/${revoked.id}/revoke`, { method: 'POST', token: director.token, body: {} })).status, 204);
  assert.throws(() => rooms.join(member.token, { code: created.admissionCode.code }), hasCode('ROOM_ACCESS_DENIED'));
  rooms.invite(director.token, roomId, { userId: member.user.id, permissions: { diceAllowed: true } });
  assert.equal(rooms.join(member.token, { code: created.admissionCode.code }).permissions.diceAllowed, true);
  assert.equal((await api(url, `/rooms/${roomId}/members/${member.user.id}/revoke`, { method: 'POST', token: director.token, body: {} })).status, 204);
  assert.throws(() => rooms.join(member.token, { code: created.admissionCode.code }), hasCode('ROOM_ACCESS_DENIED'));
  rooms.invite(director.token, roomId, { userId: member.user.id });
  assert.equal(rooms.join(member.token, { code: created.admissionCode.code }).permissions.diceAllowed, false);
});

test('a different director cannot administer another party or its invitations', async t => {
  const { rooms, director, member, created, account } = await roomFixture(t);
  const outsider = await account('other-director-test', 'director');
  const otherRoom = rooms.create(outsider.token, { name: 'Other' });
  const invite = rooms.invite(director.token, created.room.id, { userId: member.user.id });
  assert.throws(() => rooms.invite(outsider.token, created.room.id, { userId: member.user.id }), hasCode('ROOM_ACCESS_DENIED'));
  assert.throws(() => rooms.revokeInvitation(outsider.token, otherRoom.room.id, invite.id), hasCode('ROOM_INVITATION_NOT_FOUND'));
  assert.throws(() => rooms.rotateCode(outsider.token, created.room.id), hasCode('ROOM_ACCESS_DENIED'));
  assert.throws(() => rooms.revokeMember(outsider.token, created.room.id, member.user.id), hasCode('ROOM_ACCESS_DENIED'));
});

test('code collisions retry safely without reusing revoked historical values', async t => {
  const { app, auth, config, director, created } = await roomFixture(t);
  const next = `room_${randomBytes(16).toString('base64url')}`;
  const candidates = [created.admissionCode.code, next];
  const service = createRoomService(app.store, auth, config, { generateCode: () => candidates.shift() });
  service.revokeCode(director.token, created.room.id);
  const other = service.create(director.token, { name: 'Collision retry' });
  assert.equal(other.admissionCode.code, next);
});

test('failed room admissions are limited by account and peer', async t => {
  const { url, rooms, member } = await roomFixture(t, { ROOM_JOIN_RATE_LIMIT: '2' });
  for (let index = 0; index < 2; index++) {
    assert.equal((await api(url, '/rooms/join', { method: 'POST', token: member.token, body: { code: 'invalid' } })).status, 404);
  }
  assert.equal((await api(url, '/rooms/join', { method: 'POST', token: member.token, headers: { 'X-Forwarded-For': '192.0.2.5' }, body: { code: 'invalid' } })).status, 429);
  assert.throws(() => rooms.join(member.token, { code: 'invalid' }), hasCode('ROOM_JOIN_RATE_LIMITED'));
});

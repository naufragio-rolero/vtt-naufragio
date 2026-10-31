import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { io } from 'socket.io-client';
import { once } from 'node:events';
import { openStorage } from '../src/storage.js';
import { createBackend } from '../src/server.js';
import { roomFixture } from './room-helpers.js';
import { origin } from './helpers.js';

test('schema 3 migrates to 4 and temporary admissions and room-scoped sessions survive restart',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'naufragio-guest-restart-')),path=join(directory,'metadata.sqlite'),cleanups=[];
  t.after(async()=>{for(const cleanup of cleanups.reverse())await cleanup();await rm(directory,{recursive:true,force:true});});
  const store=openStorage(path);
  store.db.exec('DROP TABLE guest_requests; DROP TABLE guest_accounts; DROP TABLE room_admissions; PRAGMA user_version=3;');store.close();
  const f=await roomFixture({after:fn=>cleanups.push(fn)},{DATABASE_PATH:path}),id=f.created.room.id;
  const qr=f.app.guests.open(f.director.token,id,{}).admission;
  const request=f.app.guests.request({admissionToken:qr.token,displayName:'Synthetic restart guest'});
  const pending=f.app.guests.list(f.director.token,id).requests[0];f.app.guests.decide(f.director.token,id,pending.id,{approve:true});
  const guest=f.app.guests.claim({requestToken:request.requestToken});await f.app.close();
  const app=createBackend(f.config);cleanups.push(()=>app.close());
  assert.equal(app.store.db.prepare('PRAGMA user_version').get().user_version,4);
  assert.equal(app.auth.session(guest.token).roomId,id);assert.equal(app.auth.session(guest.token).guest,true);
  assert.equal(app.rooms.get(guest.token,id).isOwner,false);
  assert.equal(app.guests.status({requestToken:request.requestToken}).state,'claimed');
  assert.throws(()=>app.guests.claim({requestToken:request.requestToken}),/ADMISSION_NOT_APPROVED/);
  assert.deepEqual(app.store.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('schema 1 migrates transactionally without losing existing identity metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'naufragio-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'identity.sqlite');
  let store = openStorage(path);
  try {
    store.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('synthetic-id', 'synthetic-user', 'synthetic-hash', 'user', 0, 1);
    store.db.exec(`DROP TABLE guest_requests; DROP TABLE guest_accounts; DROP TABLE room_admissions;
      DROP TABLE room_authority; DROP TABLE token_assignments;
      DROP TABLE room_invitations; DROP TABLE room_memberships; DROP TABLE room_codes; DROP TABLE rooms;
      PRAGMA user_version = 1;`);
  } finally { store.close(); }
  store = openStorage(path);
  try {
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 4);
    assert.equal(store.db.prepare('SELECT username FROM users').get().username, 'synthetic-user');
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM rooms').get().n, 0);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.throws(() => store.transaction(() => {
      store.db.prepare('INSERT INTO rooms VALUES (?,?,?,?)').run('synthetic-room', 'synthetic-id', 'Temporary', 1);
      throw new Error('ROLLBACK_PROBE');
    }), /ROLLBACK_PROBE/);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM rooms').get().n, 0);
  } finally { store.close(); }
});

test('restart preserves ownership, hashed admissions and grants while presence starts waiting', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'naufragio-room-restart-'));
  const path = join(directory, 'rooms.sqlite');
  // One cleanup owns both servers, before removing files (also on Windows).
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    await rm(directory, { recursive: true, force: true });
  });
  const scoped = { after: cleanup => cleanups.push(cleanup) };
  const f = await roomFixture(scoped, { DATABASE_PATH: path });
  f.admit(f.member, f.created, { diceAllowed: true });
  const pending = await f.account('pending-room-test', 'user');
  const invitation = f.rooms.invite(f.director.token, f.created.room.id, { userId: pending.user.id });
  await f.app.close();
  const bytes = await readFile(path);
  for (const secret of [f.created.admissionCode.code, f.member.token, f.director.secret]) {
    assert.equal(bytes.includes(Buffer.from(secret)), false);
  }
  const app = createBackend(f.config);
  cleanups.push(() => app.close());
  const address = await app.listen(0);
  const result = app.rooms.get(f.member.token, f.created.room.id);
  assert.equal(result.room.ownerId, f.director.user.id);
  assert.equal(result.permissions.diceAllowed, true);
  assert.equal(result.permissions.moveAssignedTokens, false);
  assert.equal(app.rooms.invitations(pending.token)[0].id, invitation.id);
  assert.equal(app.rooms.join(pending.token, { code: f.created.admissionCode.code }).permissions.diceAllowed, false);
  const socket = io(`http://127.0.0.1:${address.port}`, { autoConnect: false, reconnection: false,
    transports: ['websocket'], extraHeaders: { Origin: origin },
    auth: { token: f.member.token, roomId: f.created.room.id } });
  cleanups.push(() => socket.disconnect());
  const ready = once(socket, 'connect', { signal: AbortSignal.timeout(3000) });
  socket.connect();
  await ready;
  const response = await socket.timeout(2000).emitWithAck('room:presence:get', { version: 1 });
  assert.equal(response.presence.state, 'waiting');
  assert.equal(response.presence.ownerId, f.director.user.id);
  assert.deepEqual(response.presence.participants.map(user => user.id), [f.member.user.id]);
});

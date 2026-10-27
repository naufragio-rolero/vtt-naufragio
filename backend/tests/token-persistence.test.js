import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { roomFixture } from './room-helpers.js';
import { createBackend } from '../src/server.js';
import { openStorage } from '../src/storage.js';
import { rawSocket, connect, prove, localAuthority, moveInput, accept, assign } from './token-helpers.js';

test('schema 2 migration preserves room metadata and adds no content columns', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'naufragio-schema3-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'metadata.sqlite');
  let store = openStorage(path);
  try {
    store.db.exec(`INSERT INTO users VALUES ('synthetic-owner','synthetic-owner','synthetic-hash','director',0,1);
      INSERT INTO rooms VALUES ('synthetic-room','synthetic-owner','Synthetic',1);
      DROP TABLE room_authority; DROP TABLE token_assignments; PRAGMA user_version=2;`);
  } finally { store.close(); }
  store = openStorage(path);
  try {
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 3);
    assert.equal(store.db.prepare('SELECT owner_id FROM rooms').get().owner_id, 'synthetic-owner');
    assert.deepEqual(store.db.prepare('PRAGMA table_info(room_authority)').all().map(row => row.name),
      ['room_id', 'state_id', 'public_key', 'revision', 'state_digest']);
    assert.deepEqual(store.db.prepare('PRAGMA table_info(token_assignments)').all().map(row => row.name), ['room_id', 'token_id', 'user_id']);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { store.close(); }
});

test('backend restart retains checkpoint/assignments, refuses new state and resumes only with the original browser state', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'naufragio-token-restart-'));
  const path = join(directory, 'metadata.sqlite');
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    await rm(directory, { recursive: true, force: true });
  });
  const scoped = { after: cleanup => cleanups.push(cleanup) };
  const f = await roomFixture(scoped, { DATABASE_PATH: path, EVENT_RATE_LIMIT: '100' });
  f.admit(f.member, f.created, { moveAssignedTokens: true });
  const director = await connect(rawSocket(scoped, f, f.director));
  const owner = await prove(director, localAuthority());
  const item = owner.record.current.tokens[0];
  await assign(director, owner, item.id, [f.member.user.id]);
  const player = await connect(rawSocket(scoped, f, f.member));
  const input = { ...moveInput(owner, item), position: { x: 934275.125, y: -761849.375 } };
  assert.equal((await player.timeout(3000).emitWithAck('token:move:request', { version: 1, roomId: f.created.room.id, ...input })).status, 'pending');
  assert.equal((await accept(director, owner, input)).status, 'committed');
  await f.app.close();
  const bytes = await readFile(path);
  for (const text of ['934275.125', '-761849.375', 'PRIVATE KEY', f.member.token]) assert.equal(bytes.includes(Buffer.from(text)), false);
  const app = createBackend(f.config);
  cleanups.push(() => app.close());
  const address = await app.listen(0);
  assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM token_assignments').get().n, 1);
  assert.equal(app.store.db.prepare('SELECT revision FROM room_authority').get().revision, 1);
  const next = { ...f, app, url: `http://127.0.0.1:${address.port}` };
  const resumed = await connect(rawSocket(scoped, next, f.director));
  assert.equal((await prove(resumed, localAuthority())).result.error.code, 'OFFICIAL_STATE_MISMATCH');
  const restored = await prove(resumed, owner.record);
  assert.equal(restored.result.ok, true);
  assert.notEqual(restored.epoch, owner.epoch);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';
import { openStorage } from '../src/storage.js';
import { createAuthService } from '../src/auth/service.js';
import { createPasswordHasher, validateNewPassword } from '../src/auth/passwords.js';
import { password, setup } from './auth-helpers.js';

test('SQLite persists only identity metadata, survives reopen and stores no raw secrets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'naufragio-auth-test-'));
  const path = join(directory, 'auth.sqlite');
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_PATH: path });
  let store = openStorage(path);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  let auth = createAuthService(store, config);
  const secret = password();
  await auth.bootstrap({ username: 'admin-test', password: secret });
  const first = await auth.login({ username: 'admin-test', password: secret });
  const invitation = auth.createInvitation(first.token, {});
  await auth.createUser(first.token, { username: 'ordinary-test', password: secret, role: 'user' });
  auth.setRoleLabels(first.token, { admin: 'Operación', director: 'Dirección', user: 'Participante' });
  const rows = store.db.prepare('SELECT password_hash FROM users').all();
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  for (const row of rows) assert.match(row.password_hash, /^scrypt\$32768\$8\$3\$/);
  assert.match(store.db.prepare('SELECT token_hash FROM sessions').get().token_hash, /^[a-f0-9]{64}$/);
  const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name);
  assert.deepEqual(tables, ['role_labels', 'sessions', 'signup_invitations', 'users']);
  store.close();
  const file = await readFile(path);
  for (const value of [secret, first.token, invitation.token]) assert.equal(file.includes(Buffer.from(value)), false);
  store = openStorage(path);
  auth = createAuthService(store, config);
  assert.equal(auth.session(first.token).role, 'admin');
  assert.equal(auth.validateInvitation({ token: invitation.token }).valid, true);
  assert.equal(auth.roleLabels().user, 'Participante');
  assert.equal((await auth.login({ username: 'admin-test', password: secret })).user.role, 'admin');
  store.db.exec('PRAGMA user_version = 99');
  assert.throws(() => openStorage(path), /UNSUPPORTED_DATABASE_VERSION/);
});

test('password hashing accepts long Unicode passwords, enforces policy and bounds work', async () => {
  const hasher = createPasswordHasher();
  const secret = `${password()} café 東京 🙂`;
  const hash = await hasher.hash(secret);
  assert.equal(await hasher.verify(secret, hash), true);
  assert.equal(await hasher.verify(password(), hash), false);
  assert.equal(await hasher.verify(secret, undefined), false);
  for (const invalid of ['', 'short', 'x'.repeat(129), null]) assert.throws(() => validateNewPassword(invalid));
  const work = await Promise.allSettled(Array.from({ length: 6 }, () => hasher.hash(password())));
  assert.equal(work.filter(result => result.status === 'fulfilled').length, 5);
  assert.equal(work.find(result => result.status === 'rejected').reason.code, 'AUTH_BUSY');
});

test('session creation evicts older sessions once the per-account limit is reached', async t => {
  let now = 100000;
  const { auth, token, secret } = await setup(t, {}, { clock: () => now });
  const tokens = [token];
  for (let index = 0; index < 5; index++) {
    now++;
    tokens.push((await auth.login({ username: 'admin-test', password: secret })).token);
  }
  assert.throws(() => auth.session(tokens[0]), error => error.code === 'UNAUTHENTICATED');
  for (const current of tokens.slice(1)) assert.equal(auth.session(current).role, 'admin');
});

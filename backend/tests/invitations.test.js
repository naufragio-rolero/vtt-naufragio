import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, api, password } from './auth-helpers.js';
import { createAuthService } from '../src/auth/service.js';
import { passwords } from '../src/auth/passwords.js';

const hasCode = code => error => error.code === code;
const signup = (token, name = 'ordinary-test') => ({ username: name, password: password(), invitationToken: token });

test('signup invitations are scoped, opaque, single-use and distinct from sessions/room codes', async t => {
  const { auth, token, url } = await setup(t);
  const response = await api(url, '/invitations', { method: 'POST', token, body: { expiresInSeconds: 60 } });
  assert.equal(response.status, 201);
  const invite = response.data.invitation;
  assert.match(invite.token, /^signup_[A-Za-z0-9_-]{43}$/);
  const checked = await api(url, '/auth/invitations/validate', { method: 'POST', body: { token: invite.token } });
  assert.equal(checked.status, 200);
  assert.deepEqual({ ...checked.data, expiresAt: 0 }, { valid: true, kind: 'account_signup', role: 'user', expiresAt: 0 });
  assert.throws(() => auth.session(invite.token), hasCode('UNAUTHENTICATED'));
  for (const invalid of [token, 'ROOM-12345678', 'signup_invalid']) {
    const check = await api(url, '/auth/invitations/validate', { method: 'POST', body: { token: invalid } });
    assert.equal(check.status, 400);
    assert.deepEqual(check.data, { error: { code: 'INVALID_INVITATION' } });
  }
  const list = await api(url, '/invitations', { token });
  assert.equal(list.status, 200);
  assert.equal(JSON.stringify(list.data).includes(invite.token), false);
  assert.equal(JSON.stringify(list.data).includes('token_hash'), false);
  const body = signup(invite.token);
  assert.equal((await api(url, '/auth/register', { method: 'POST', body })).status, 201);
  assert.equal((await api(url, '/auth/register', { method: 'POST', body: signup(invite.token, 'another-test') })).status, 400);
  assert.throws(() => auth.validateInvitation({ token: invite.token }), hasCode('INVALID_INVITATION'));
});

test('expired, revoked and used invitations have identical public failures', async t => {
  let now = 1000000;
  const { auth, token, url } = await setup(t, {}, { clock: () => now });
  const expired = auth.createInvitation(token, { expiresInSeconds: 60 });
  now += 60000;
  const revoked = auth.createInvitation(token, {});
  assert.equal((await api(url, `/invitations/${revoked.id}/revoke`, { method: 'POST', token, body: {} })).status, 204);
  const used = auth.createInvitation(token, {});
  await auth.register(signup(used.token));
  for (const item of [expired, revoked, used]) {
    const response = await api(url, '/auth/register', { method: 'POST', body: signup(item.token, 'other-test') });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: { code: 'INVALID_INVITATION' } });
  }
});

test('directors cannot list or revoke invitations belonging to other directors', async t => {
  const { auth, token, url } = await setup(t);
  const sessions = [];
  for (const username of ['director-one', 'director-two']) {
    const secret = password();
    await auth.createUser(token, { username, password: secret, role: 'director' });
    sessions.push(await auth.login({ username, password: secret }));
  }
  const own = auth.createInvitation(sessions[0].token, {});
  const other = auth.createInvitation(sessions[1].token, {});
  assert.equal(auth.listInvitations(sessions[0].token).length, 1);
  assert.equal(auth.listInvitations(token).length, 2);
  assert.equal((await api(url, `/invitations/${other.id}/revoke`, { method: 'POST', token: sessions[0].token, body: {} })).status, 404);
  assert.equal(auth.validateInvitation({ token: other.token }).valid, true);
  auth.revokeInvitation(sessions[0].token, own.id);
  auth.revokeInvitation(token, other.id);
});

test('parallel registration consumes exactly once and failed account creation rolls back', async t => {
  const { auth, token, app } = await setup(t);
  const invite = auth.createInvitation(token, {});
  const results = await Promise.allSettled([auth.register(signup(invite.token, 'first-test')), auth.register(signup(invite.token, 'second-test'))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'INVALID_INVITATION');
  assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM users').get().n, 2);
  const retry = auth.createInvitation(token, {});
  await assert.rejects(auth.register(signup(retry.token, 'admin-test')), hasCode('USERNAME_UNAVAILABLE'));
  assert.equal(auth.validateInvitation({ token: retry.token }).valid, true);
  assert.equal((await auth.register(signup(retry.token, 'third-test'))).role, 'user');
});

test('registration rechecks revocation after password hashing before committing', async t => {
  const { auth, token, app, config } = await setup(t);
  const invite = auth.createInvitation(token, {});
  let entered;
  let release;
  const hashing = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const delayed = createAuthService(app.store, config, { hasher: {
    async hash(value) { const hash = await passwords.hash(value); entered(); await gate; return hash; },
    verify: passwords.verify
  } });
  const registration = delayed.register(signup(invite.token));
  await hashing;
  auth.revokeInvitation(token, invite.id);
  release();
  await assert.rejects(registration, hasCode('INVALID_INVITATION'));
  assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
});

test('issuance rejects privilege fields, excessive lifetimes and excessive active invitations', async t => {
  const { auth, token } = await setup(t);
  for (const value of [{ role: 'director' }, { roomCode: 'x' }, { expiresInSeconds: 0 }, { expiresInSeconds: 604801 }]) {
    assert.throws(() => auth.createInvitation(token, value), hasCode('INVALID_INPUT'));
  }
  for (let index = 0; index < 50; index++) auth.createInvitation(token, {});
  assert.throws(() => auth.createInvitation(token, {}), hasCode('INVITATION_LIMIT'));
});

test('revoking an administrator session during hashing prevents user provisioning', async t => {
  const { app, auth, token, config } = await setup(t);
  let entered;
  let release;
  const hashing = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const delayed = createAuthService(app.store, config, { hasher: {
    async hash(value) { const result = await passwords.hash(value); entered(); await gate; return result; },
    verify: passwords.verify
  } });
  const pending = delayed.createUser(token, { username: 'director-test', password: password(), role: 'director' });
  await hashing;
  auth.logout(token);
  release();
  await assert.rejects(pending, hasCode('UNAUTHENTICATED'));
  assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
});

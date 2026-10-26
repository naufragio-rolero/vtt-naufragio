import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, api, password } from './auth-helpers.js';
import { fixture } from './helpers.js';

const hasCode = code => error => error.code === code;

test('initial administrator is local-only, unique and has no default credentials', async t => {
  const { app, url } = await fixture(t);
  assert.equal(app.auth.bootstrapAvailable(), true);
  await assert.rejects(app.auth.login({ username: 'admin', password: password() }), hasCode('INVALID_CREDENTIALS'));
  await assert.rejects(app.auth.bootstrap({ username: 'admin', password: 'short' }), hasCode('INVALID_PASSWORD'));
  const secret = password();
  const admin = await app.auth.bootstrap({ username: 'ADMIN-TEST', password: secret });
  assert.equal(admin.username, 'admin-test');
  assert.equal(admin.role, 'admin');
  await assert.rejects(app.auth.bootstrap({ username: 'other-admin', password: secret }), hasCode('ALREADY_INITIALIZED'));
  assert.equal((await api(url, '/users', { method: 'POST', body: { username: 'intruder', password: secret, role: 'admin' } })).status, 401);
  assert.equal((await api(url, '/auth/bootstrap', { method: 'POST', body: {} })).status, 404);
});

test('login, me, logout, logout-all and expiry use revocable sessions', async t => {
  let now = 1000000;
  const { auth, url, secret, token } = await setup(t, { SESSION_TTL_SECONDS: '60' }, { clock: () => now });
  const other = await api(url, '/auth/login', { method: 'POST', body: { username: 'ADMIN-TEST', password: secret } });
  assert.equal(other.status, 200);
  assert.match(other.data.token, /^sess_/);
  assert.equal(other.data.expiresAt, now + 60000);
  assert.equal((await api(url, '/auth/me', { token })).data.user.role, 'admin');
  assert.equal((await api(url, '/auth/me', { headers: { Cookie: `session=${token}` } })).status, 401);
  assert.equal((await api(url, '/auth/me', { token: 'bad' })).status, 401);
  assert.equal((await api(url, `/auth/me?token=${token}`)).status, 400);
  assert.equal((await api(url, '/auth/logout', { method: 'POST', token, body: {} })).status, 204);
  assert.equal((await api(url, '/auth/me', { token })).status, 401);
  assert.equal((await api(url, '/auth/me', { token: other.data.token })).status, 200);
  assert.equal((await api(url, '/auth/logout-all', { method: 'POST', token: other.data.token, body: {} })).status, 204);
  assert.throws(() => auth.session(other.data.token), hasCode('UNAUTHENTICATED'));
  const current = await auth.login({ username: 'admin-test', password: secret });
  now += 60000;
  assert.throws(() => auth.session(current.token), hasCode('UNAUTHENTICATED'));
});

test('wrong password, unknown account and disabled account return the same error', async t => {
  const { auth, url, token } = await setup(t);
  const secret = password();
  const user = await auth.createUser(token, { username: 'disabled-test', password: secret, role: 'user' });
  auth.updateUser(token, user.id, { disabled: true });
  const failures = [];
  for (const body of [
    { username: 'admin-test', password: secret },
    { username: 'unknown-test', password: secret },
    { username: 'disabled-test', password: secret }
  ]) {
    const response = await api(url, '/auth/login', { method: 'POST', body });
    assert.equal(response.status, 401);
    failures.push(response.data);
  }
  assert.deepEqual(failures, Array(3).fill({ error: { code: 'INVALID_CREDENTIALS' } }));
});

test('admin provisions directors; directors and ordinary users cannot elevate themselves', async t => {
  const { auth, url, token } = await setup(t);
  const secret = password();
  const created = await api(url, '/users', { method: 'POST', token, body: { username: 'director-test', password: secret, role: 'director' } });
  assert.equal(created.status, 201);
  const director = await auth.login({ username: 'director-test', password: secret });
  assert.equal((await api(url, '/users', { token })).status, 200);
  assert.equal((await api(url, '/users', { token: director.token })).status, 403);
  for (const role of ['admin', 'director', 'user']) {
    assert.equal((await api(url, '/users', { method: 'POST', token: director.token, body: { username: 'elevated', password: secret, role } })).status, 403);
  }
  assert.equal((await api(url, `/users/${director.user.id}`, { method: 'PATCH', token: director.token, body: { role: 'admin' } })).status, 403);
  const invitation = auth.createInvitation(director.token, {});
  for (const extra of [{ role: 'admin' }, { isAdmin: true }, { permissions: ['*'] }]) {
    const response = await api(url, '/auth/register', { method: 'POST', body: { username: 'ordinary-test', password: secret, invitationToken: invitation.token, ...extra } });
    assert.equal(response.status, 400);
  }
  const registered = await api(url, '/auth/register', { method: 'POST', body: { username: 'ordinary-test', password: secret, invitationToken: invitation.token } });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.role, 'user');
  const ordinary = await auth.login({ username: 'ordinary-test', password: secret });
  for (const path of ['/users', '/invitations', '/rooms', '/resources']) {
    assert.equal((await api(url, path, { method: 'POST', token: ordinary.token, body: {} })).status, 403, path);
  }
  assert.equal((await api(url, '/auth/login', { method: 'POST', body: { username: 'ordinary-test', password: secret, role: 'admin' } })).status, 400);
  assert.equal((await api(url, '/rooms', { method: 'POST', token: director.token, body: {} })).status, 501);
  assert.equal((await api(url, '/rooms', { method: 'POST', token, body: {} })).status, 403);
  assert.equal((await api(url, '/rooms/join', { method: 'POST', token: ordinary.token, body: { role: 'admin' } })).status, 501);
});

test('password changes require the current password and revoke all sessions', async t => {
  const { auth, url, token, secret } = await setup(t);
  const second = await auth.login({ username: 'admin-test', password: secret });
  const replacement = password();
  const incorrect = await api(url, '/auth/password', { method: 'POST', token, body: { currentPassword: password(), newPassword: replacement } });
  assert.equal(incorrect.status, 401);
  assert.equal((await api(url, '/auth/password', { method: 'POST', token, body: { currentPassword: secret, newPassword: replacement } })).status, 204);
  for (const value of [token, second.token]) assert.throws(() => auth.session(value), hasCode('UNAUTHENTICATED'));
  await assert.rejects(auth.login({ username: 'admin-test', password: secret }), hasCode('INVALID_CREDENTIALS'));
  assert.equal((await auth.login({ username: 'admin-test', password: replacement })).user.role, 'admin');
});

test('demotion, disabling and admin revocation invalidate existing sessions immediately', async t => {
  const { auth, token, url } = await setup(t);
  const secret = password();
  const director = await auth.createUser(token, { username: 'director-test', password: secret, role: 'director' });
  const login = () => auth.login({ username: 'director-test', password: secret });
  const first = await login();
  const invite = auth.createInvitation(first.token, {});
  assert.equal((await api(url, `/users/${director.id}`, { method: 'PATCH', token, body: { role: 'user' } })).status, 200);
  assert.throws(() => auth.session(first.token), hasCode('UNAUTHENTICATED'));
  assert.throws(() => auth.validateInvitation({ token: invite.token }), hasCode('INVALID_INVITATION'));
  const second = await login();
  assert.equal(second.user.role, 'user');
  assert.equal((await api(url, `/users/${director.id}/revoke-sessions`, { method: 'POST', token, body: {} })).status, 204);
  assert.throws(() => auth.session(second.token), hasCode('UNAUTHENTICATED'));
  const third = await login();
  auth.updateUser(token, director.id, { disabled: true });
  assert.throws(() => auth.session(third.token), hasCode('UNAUTHENTICATED'));
});

test('last active administrator cannot be disabled or demoted', async t => {
  const { auth, token, admin } = await setup(t);
  assert.throws(() => auth.updateUser(token, admin.id, { role: 'user' }), hasCode('LAST_ADMIN'));
  assert.throws(() => auth.updateUser(token, admin.id, { disabled: true }), hasCode('LAST_ADMIN'));
  const secondSecret = password();
  const another = await auth.createUser(token, { username: 'other-admin', password: secondSecret, role: 'admin' });
  auth.updateUser(token, admin.id, { role: 'user' });
  assert.throws(() => auth.session(token), hasCode('UNAUTHENTICATED'));
  assert.equal(auth.bootstrapAvailable(), false);
  assert.equal(auth.listUsers((await auth.login({ username: another.username, password: secondSecret })).token).length, 2);
});

test('role labels are configurable only by admin and never grant capabilities', async t => {
  const { auth, token, url } = await setup(t);
  const secret = password();
  await auth.createUser(token, { username: 'ordinary-test', password: secret, role: 'user' });
  const ordinary = await auth.login({ username: 'ordinary-test', password: secret });
  const labels = { admin: 'Operación', director: 'Dirección', user: 'Administrador' };
  assert.equal((await api(url, '/roles', { method: 'PUT', token: ordinary.token, body: labels })).status, 403);
  assert.equal((await api(url, '/roles', { method: 'PUT', token, body: labels })).status, 200);
  assert.deepEqual((await api(url, '/roles')).data.roleLabels, labels);
  assert.deepEqual((await api(url, '/settings/site.config.json')).data.roleLabels, labels);
  assert.equal((await api(url, '/users', { token: ordinary.token })).status, 403);
  assert.equal((await api(url, '/auth/me', { token: ordinary.token })).data.user.role, 'user');
  assert.equal((await api(url, '/roles', { method: 'PUT', token, body: { ...labels, user: '' } })).status, 400);
});

test('authentication attempts are limited per peer and account and reset after their window', async t => {
  let now = 1000;
  const { app, url } = await fixture(t, { AUTH_RATE_LIMIT: '2', AUTH_WINDOW_MS: '100' }, { clock: () => now });
  const secret = password();
  for (const username of ['unknown-one', 'unknown-two']) {
    assert.equal((await api(url, '/auth/login', { method: 'POST', body: { username, password: secret } })).status, 401);
  }
  const denied = await api(url, '/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': '192.0.2.5' }, body: { username: 'unknown-three', password: secret } });
  assert.equal(denied.status, 429);
  assert.ok(denied.headers.has('retry-after'));
  now += 100;
  assert.equal((await api(url, '/auth/login', { method: 'POST', body: { username: 'unknown-three', password: secret } })).status, 401);
  for (let index = 0; index < 2; index++) await assert.rejects(app.auth.login({ username: 'account-only', password: secret }), hasCode('INVALID_CREDENTIALS'));
  await assert.rejects(app.auth.login({ username: 'ACCOUNT-ONLY', password: secret }), hasCode('AUTH_RATE_LIMITED'));
});

test('concurrent local bootstrap creates only one administrator', async t => {
  const { app } = await fixture(t);
  const results = await Promise.allSettled([
    app.auth.bootstrap({ username: 'first-admin', password: password() }),
    app.auth.bootstrap({ username: 'second-admin', password: password() })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'ALREADY_INITIALIZED');
  assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
});

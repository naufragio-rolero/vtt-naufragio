import { randomBytes } from 'node:crypto';
import { fixture } from './helpers.js';

export const password = () => `test-${randomBytes(24).toString('base64url')}`;
export async function setup(t, env = {}, options = {}) {
  const base = await fixture(t, env, options);
  const secret = password();
  const admin = await base.app.auth.bootstrap({ username: 'admin-test', password: secret });
  const session = await base.app.auth.login({ username: admin.username, password: secret });
  return { ...base, secret, admin, token: session.token, auth: base.app.auth };
}
export async function api(url, path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${url}${path}`, { method, headers: {
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data, headers: response.headers };
}

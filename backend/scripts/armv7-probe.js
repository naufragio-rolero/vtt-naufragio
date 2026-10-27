// Controlled, serial compatibility probe. All application files stay under VALIDATION_ROOT.
import { resolve, join } from 'node:path';
import { realpathSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';

if (!process.env.VALIDATION_ROOT) throw new Error('VALIDATION_ROOT_REQUIRED');
const root = realpathSync(resolve(process.env.VALIDATION_ROOT));
const report = { node: process.version, arch: process.arch, samples: 3, sqlite: 'pending', auth: 'pending' };
const secret = () => `synthetic-${randomBytes(24).toString('base64url')}`;
let app;
let peakRss = process.memoryUsage().rss;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  if (peakRss > 160 * 1024 * 1024) {
    console.log(JSON.stringify({ ...report, errorCode: 'RSS_GUARD', peakRssBytes: peakRss }));
    process.exit(30);
  }
}, 50);
sampler.unref();
const started = performance.now();
const cpuStarted = process.cpuUsage();

async function measure(work) {
  const before = process.cpuUsage();
  const begin = performance.now();
  const value = await work();
  const cpu = process.cpuUsage(before);
  return { value, metrics: { wallMs: +(performance.now() - begin).toFixed(2),
    userCpuMs: +(cpu.user / 1000).toFixed(2), systemCpuMs: +(cpu.system / 1000).toFixed(2) } };
}

try {
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(join(root, 'data'), { recursive: true, mode: 0o700 });
  const sqlitePath = join(root, 'data/sqlite-check.sqlite');
  let db = new DatabaseSync(sqlitePath);
  db.exec('CREATE TABLE probe(id INTEGER PRIMARY KEY, value TEXT) STRICT; BEGIN IMMEDIATE');
  db.prepare('INSERT INTO probe VALUES (?,?)').run(1, 'synthetic');
  db.exec('COMMIT; BEGIN IMMEDIATE');
  db.prepare('INSERT INTO probe VALUES (?,?)').run(2, 'rollback');
  db.exec('ROLLBACK');
  db.close();
  db = new DatabaseSync(sqlitePath);
  if (db.prepare('SELECT count(*) AS n FROM probe').get().n !== 1) throw new Error();
  db.close();
  report.sqlite = 'pass';
  const { passwords } = await import('../src/auth/passwords.js');
  const password = secret();
  report.scrypt = { N: 32768, r: 8, p: 3, serial: true, hashes: [], verifies: [] };
  for (let index = 0; index < report.samples; index++) {
    const hash = await measure(() => passwords.hash(password));
    report.scrypt.hashes.push(hash.metrics);
    const checked = await measure(() => passwords.verify(password, hash.value));
    if (!checked.value) throw new Error();
    report.scrypt.verifies.push(checked.metrics);
  }
  const { loadConfig } = await import('../src/config.js');
  const { createBackend } = await import('../src/server.js');
  app = createBackend(loadConfig({ NODE_ENV: 'test', HOST: '127.0.0.1', DATABASE_PATH: join(root, 'data/auth.sqlite') }));
  await app.auth.bootstrap({ username: 'synthetic-admin', password });
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  async function request(path, body, token, expected = 200) {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    if (response.status !== expected) throw new Error();
    return expected === 204 ? null : response.json();
  }
  await request('/health');
  const login = await measure(() => request('/auth/login', { username: 'synthetic-admin', password }));
  report.authLogin = login.metrics;
  const token = login.value.token;
  const directorSecret = secret();
  await request('/users', { username: 'synthetic-director', password: directorSecret, role: 'director' }, token, 201);
  const director = await request('/auth/login', { username: 'synthetic-director', password: directorSecret });
  const { invitation } = await request('/invitations', {}, director.token, 201);
  await request('/auth/invitations/validate', { token: invitation.token });
  const userSecret = secret();
  await request('/auth/register', { username: 'synthetic-user', password: userSecret, invitationToken: invitation.token }, undefined, 201);
  await request('/auth/invitations/validate', { token: invitation.token }, undefined, 400);
  const user = await request('/auth/login', { username: 'synthetic-user', password: userSecret });
  await request('/invitations', {}, user.token, 403);
  await request('/rooms', {}, user.token, 403);
  await request('/auth/logout', {}, user.token, 204);
  await request('/auth/me', undefined, user.token, 401);
  await request('/auth/login', { username: 'synthetic-user', password: secret() }, undefined, 401);
  report.auth = 'pass';
  report.authChecks = ['bootstrap', 'login', 'provision', 'invitation', 'signup', 'single-use', 'permissions', 'logout', 'revocation', 'invalid-password'];
  await app.close();
  app = null;
} catch (error) {
  report.errorCode = error.code ?? 'VALIDATION_FAILED';
  process.exitCode = 20;
} finally {
  await app?.close();
  clearInterval(sampler);
  report.wallMs = +(performance.now() - started).toFixed(2);
  report.cpu = process.cpuUsage(cpuStarted);
  report.peakRssBytes = Math.max(peakRss, process.memoryUsage().rss);
  report.maxRssKiB = process.resourceUsage().maxRSS;
  console.log(JSON.stringify(report));
}

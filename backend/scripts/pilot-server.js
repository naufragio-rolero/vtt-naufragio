// Synthetic, private pilot fixture. Never serve the fixture file or log secrets.
import { realpath, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createBackend } from '../src/server.js';
import { loadConfig } from '../src/config.js';

const root = await realpath(process.env.PILOT_ROOT ?? '');
if (!process.env.PILOT_ROOT || !/^\/var\/tmp\/naufragio-pilot\.[A-Za-z0-9]+$/.test(root) && process.env.PILOT_LOCAL_CHECK !== '1') throw new Error('PRIVATE_ROOT_REQUIRED');
const config = loadConfig({ NODE_ENV: 'development', HOST: '127.0.0.1', PORT: process.env.PILOT_PORT ?? '3400',
  ALLOWED_ORIGINS: process.env.PILOT_ORIGIN ?? 'http://127.0.0.1:8080', DATABASE_PATH: join(root, 'data/pilot.sqlite') });
await mkdir(join(root, 'data'), { recursive: true, mode: 0o700 });
const app = createBackend(config);
const fixturePath = join(root, 'data/fixture.json');
let fixture;
try { fixture = JSON.parse(await readFile(fixturePath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const secret = () => `synthetic-${randomBytes(24).toString('base64url')}`;
  const adminPassword = secret();
  await app.auth.bootstrap({ username: 'pilot-admin', password: adminPassword });
  const admin = await app.auth.login({ username: 'pilot-admin', password: adminPassword });
  fixture = { accounts: [] };
  for (const [index, role] of ['director', 'user', 'user'].entries()) {
    const password = secret(), username = `pilot-person-${index}`;
    const user = await app.auth.createUser(admin.token, { username, password, role });
    fixture.accounts.push({ id: user.id, username, password });
  }
  app.auth.logout(admin.token);
  await writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600, flag: 'wx' });
}
const address = await app.listen();
console.log(JSON.stringify({ state: 'ready', node: process.version, arch: process.arch, port: address.port, pid: process.pid }));
let stopping = false;
for (const event of ['SIGTERM', 'SIGINT']) process.on(event, async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
});

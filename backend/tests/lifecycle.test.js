import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fixture } from './helpers.js';

function launch(t, env) {
  const child = spawn(process.execPath, ['src/main.js'], { cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', ALLOWED_ORIGINS: 'http://localhost:8080',
      ENABLE_DIAGNOSTICS: 'false', ...env }, windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  return { child, output: () => output };
}

test('CLI rejects invalid configuration without echoing sensitive values', { timeout: 10000 }, async t => {
  const { child, output } = launch(t, { PORT: 'not-a-real-secret' });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.match(output(), /STARTUP_FAILED/);
  assert.doesNotMatch(output(), /not-a-real-secret| at /);
});

test('CLI exits cleanly when the bind address is occupied', { timeout: 10000 }, async t => {
  const { app } = await fixture(t);
  const { child, output } = launch(t, { PORT: String(app.server.address().port) });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.match(output(), /LISTEN_FAILED/);
  assert.doesNotMatch(output(), / at /);
});

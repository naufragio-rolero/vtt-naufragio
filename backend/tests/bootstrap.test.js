import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { readHidden } from '../scripts/hidden-input.js';
import { password } from './auth-helpers.js';

test('bootstrap CLI rejects piped input, arguments and credential environment variables', { timeout: 10000 }, async t => {
  const secret = password();
  const child = spawn(process.execPath, ['scripts/bootstrap-admin.js', 'not-permitted'], {
    cwd: new URL('..', import.meta.url), windowsHide: true,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: ':memory:', ADMIN_PASSWORD: secret }
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.stdin.end(`${secret}\n`);
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.match(output, /BOOTSTRAP_FAILED/);
  assert.equal(output.includes(secret), false);
});

test('hidden terminal input never echoes a password and restores terminal mode on completion/cancel', async () => {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true, isRaw: false, setRawMode(value) { this.isRaw = value; }, resume() {}, pause() {}
  });
  let output = '';
  const terminal = { isTTY: true, write(value) { output += value; } };
  const secret = password();
  const read = readHidden('Password: ', input, terminal);
  input.emit('keypress', `${secret}x`, {});
  input.emit('keypress', '', { name: 'backspace' });
  input.emit('keypress', '', { name: 'return' });
  assert.equal(await read, secret);
  assert.equal(output.includes(secret), false);
  assert.equal(input.isRaw, false);
  const cancelled = readHidden('Password: ', input, terminal);
  input.emit('keypress', '', { ctrl: true, name: 'c' });
  await assert.rejects(cancelled, /CANCELLED/);
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount('keypress'), 0);
});

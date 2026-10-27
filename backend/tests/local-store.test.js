import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createIndexedDbStore } from '../client/indexeddb-store.js';

test('browser store requires an exclusive Web Lock per room before accessing authority data', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
  const held = new Set();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    async request(name, options, work) {
      assert.equal(options.ifAvailable, true);
      if (held.has(name)) return work(null);
      held.add(name);
      try { return await work({ name }); } finally { held.delete(name); }
    }
  } } });
  const first = createIndexedDbStore('synthetic-room');
  const second = createIndexedDbStore('synthetic-room');
  const other = createIndexedDbStore('other-room');
  t.after(() => { first.close(); second.close(); other.close(); });
  await first.acquire();
  await assert.rejects(second.acquire(), /LOCAL_STATE_IN_USE/);
  await other.acquire();
  first.release();
  await setImmediate();
  await second.acquire();
  second.release(); other.release();
  await setImmediate();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  await assert.rejects(first.acquire(), /LOCAL_LOCK_UNAVAILABLE/);
});

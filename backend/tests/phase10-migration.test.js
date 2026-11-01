import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStorage } from '../src/storage.js';

test('phase10 migration backs up v4 and preserves requests; rollback copy remains v4', async t => {
  const dir = await mkdtemp(join(tmpdir(),'phase10-migration-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path = join(dir,'game.sqlite');
  let store = openStorage(path);
  store.db.exec('ALTER TABLE guest_requests DROP COLUMN created_at; DROP TABLE room_scene; PRAGMA user_version=4');
  store.close();
  store = openStorage(path);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,6);
  assert.ok(store.db.prepare('PRAGMA table_info(guest_requests)').all().some(c=>c.name==='created_at'));
  store.close();
  const files = (await readdir(dir)).filter(name=>name.includes('.pre-phase10-'));
  assert.equal(files.length,1);
  const copy = new DatabaseSync(join(dir,files[0]),{readOnly:true});
  try {
    assert.equal(copy.prepare('PRAGMA user_version').get().user_version,4);
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally { copy.close(); }
});

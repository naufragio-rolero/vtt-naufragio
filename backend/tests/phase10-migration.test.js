import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStorage } from '../src/storage.js';
import { rollbackCopy } from '../scripts/rollback-phase10.js';

test('phase10 migration backs up v4 and preserves requests; rollback copy remains v4', async t => {
  const dir = await mkdtemp(join(tmpdir(),'phase10-migration-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path = join(dir,'game.sqlite');
  let store = openStorage(path);
  store.db.exec(`INSERT INTO users VALUES ('owner','owner','!test','director',0,1);
    INSERT INTO rooms VALUES ('room','owner','Preserved',1);
    INSERT INTO room_admissions VALUES ('admission','room','hash',9999999999999,1,NULL);
    INSERT INTO guest_requests VALUES ('request','admission','claim','Visitor',9999999999999,'pending',NULL,123);`);
  store.db.exec('ALTER TABLE guest_requests DROP COLUMN created_at; DROP TABLE dice_rolls; DROP TABLE room_scene; PRAGMA user_version=4');
  store.close();
  store = openStorage(path);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,7);
  assert.ok(store.db.prepare('PRAGMA table_info(guest_requests)').all().some(c=>c.name==='created_at'));
  assert.equal(store.db.prepare('SELECT display_name FROM guest_requests').get().display_name,'Visitor');
  assert.equal(store.db.prepare('SELECT created_at FROM guest_requests').get().created_at,null);
  store.close();
  const files = (await readdir(dir)).filter(name=>name.includes('.pre-phase10-'));
  assert.equal(files.length,1);
  const copy = new DatabaseSync(join(dir,files[0]),{readOnly:true});
  try {
    assert.equal(copy.prepare('PRAGMA user_version').get().user_version,4);
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally { copy.close(); }
});

test('rollback copy preserves current identities, requests and checkpoints; original v7 data stays intact',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'phase10-rollback-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const source=join(dir,'current.sqlite'),destination=join(dir,'compatible.sqlite');
  const store=openStorage(source);
  store.db.exec(`INSERT INTO users VALUES ('owner','owner','!test','director',0,1);
    INSERT INTO rooms VALUES ('room','owner','Current game',1);
    INSERT INTO room_authority VALUES ('room','state','key',12,'${'a'.repeat(64)}');
    INSERT INTO room_memberships VALUES ('room','owner',1,1,1,1);
    INSERT INTO dice_rolls VALUES ('room','request',100,'{}');`);
  store.close(); await rollbackCopy(source,destination);
  const original=new DatabaseSync(source,{readOnly:true}),copy=new DatabaseSync(destination,{readOnly:true});
  try {
    assert.equal(original.prepare('PRAGMA user_version').get().user_version,7);
    assert.equal(original.prepare('SELECT count(*) AS n FROM dice_rolls').get().n,1);
    assert.equal(copy.prepare('PRAGMA user_version').get().user_version,4);
    assert.equal(copy.prepare('SELECT revision FROM room_authority').get().revision,12);
    assert.equal(copy.prepare('SELECT active FROM room_memberships').get().active,1);
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally {original.close();copy.close();}
  await assert.rejects(rollbackCopy(source,destination));
  await assert.rejects(rollbackCopy(source,source));
});

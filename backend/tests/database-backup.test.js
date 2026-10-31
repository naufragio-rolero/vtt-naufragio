import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStorage } from '../src/storage.js';
import { backupDatabase } from '../scripts/database-backup.js';

test('online SQLite backup includes committed WAL metadata, preserves source and refuses overwrites',async t=>{
  const root=await mkdtemp(join(tmpdir(),'naufragio-backup-'));
  const source=join(root,'source.sqlite'),dest=join(root,'snapshot.sqlite'),store=openStorage(source);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.db.prepare("INSERT INTO users VALUES ('synthetic','synthetic','hash','admin',0,1)").run();
  await backupDatabase(source,dest);
  const copy=new DatabaseSync(dest,{readOnly:true});try{assert.equal(copy.prepare('SELECT count(*) AS n FROM users').get().n,1);assert.equal(copy.prepare('PRAGMA user_version').get().user_version,4);}finally{copy.close();}
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM users').get().n,1);
  await assert.rejects(backupDatabase(source,dest));await assert.rejects(backupDatabase(source,source));
});

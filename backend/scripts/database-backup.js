import { DatabaseSync, backup } from 'node:sqlite';
import { open, chmod, unlink, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// SQLite's online backup API includes committed WAL pages; never copy a live .sqlite file alone.
export async function backupDatabase(source, destination) {
  source=resolve(source);destination=resolve(destination);
  if((await lstat(source)).isSymbolicLink())throw new Error('UNSAFE_BACKUP_PATH');
  source=await realpath(source);
  destination=join(await realpath(dirname(destination)),basename(destination));
  const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
  if(same(source,destination)) throw new Error('UNSAFE_BACKUP_PATH');
  const reservation=await open(destination,'wx',0o600);await reservation.close();
  let db;
  try{
    db=new DatabaseSync(source,{readOnly:true});await backup(db,destination);await chmod(destination,0o600);
    const copy=new DatabaseSync(destination,{readOnly:true});
    try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||copy.prepare('PRAGMA foreign_key_check').all().length)throw new Error('BACKUP_INVALID');}
    finally{copy.close();}
  }catch(error){await unlink(destination);throw error;}
  finally{db?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{if(process.argv.length!==4)throw new Error();await backupDatabase(process.argv[2],process.argv[3]);console.log('BACKUP_OK');}
  catch{console.error('BACKUP_FAILED: use a private existing directory and a new destination.');process.exitCode=1;}
}

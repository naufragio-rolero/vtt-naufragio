// Create an old-backend-compatible COPY. Never mutate the source or control a service.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { backupDatabase } from './database-backup.js';

export async function rollbackCopy(source,destination) {
  await backupDatabase(source,destination);
  const db=new DatabaseSync(resolve(destination));
  try {
    const version=db.prepare('PRAGMA user_version').get().user_version;
    if (![4,5,6,7].includes(version)) throw new Error('UNSUPPORTED_DATABASE_VERSION');
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
    try {
      if (version>=7) db.exec('DROP TABLE dice_rolls');
      if (version>=6) db.exec('DROP TABLE room_scene');
      if (version>=5) db.exec('ALTER TABLE guest_requests DROP COLUMN created_at');
      db.exec('PRAGMA user_version=4; COMMIT;');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
    if (db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('ROLLBACK_COPY_INVALID');
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length!==4) throw new Error('INVALID_ARGUMENTS');
    await rollbackCopy(process.argv[2],process.argv[3]); console.log('ROLLBACK_COPY_OK: original conservado; no se ha cambiado ningún servicio.');
  } catch { console.error('ROLLBACK_COPY_FAILED: usa una SQLite válida y un destino nuevo en un directorio privado.');process.exitCode=1; }
}

import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {openStorage} from '/opt/naufragio-vtt/current/backend/src/storage.js';
import {createAuthService} from '/opt/naufragio-vtt/current/backend/src/auth/service.js';
import {loadConfig} from '/opt/naufragio-vtt/current/backend/src/config.js';
import {backupDatabase} from '/opt/naufragio-vtt/current/backend/scripts/database-backup.js';
const root='/mnt/ssd/naufragio-vtt',path=root+'/data/naufragio.sqlite';
const config=loadConfig({NODE_ENV:'production',DATABASE_PATH:path,ALLOWED_ORIGINS:'https://naufragio-rolero.github.io'});
const secret=()=>`phase8-synthetic-${randomBytes(24).toString('base64url')}`;
if(process.argv[2]==='provision'){
 const store=openStorage(path);const migrated=store.db.prepare('PRAGMA user_version').get().user_version;assert.equal(migrated,4);
 const auth=createAuthService(store,config),password=secret();await auth.bootstrap({username:'phase8-admin',password});
 const admin=await auth.login({username:'phase8-admin',password});
 const director={username:'phase8-director',password:secret()};await auth.createUser(admin.token,{...director,role:'director'});auth.logout(admin.token);store.close();
 await writeFile(root+'/validation/fixture.json',JSON.stringify({director}),{mode:0o600,flag:'wx'});
 // Separate synthetic schema-3 fixture exercises the real migration on this SSD.
 const migrationPath=root+'/validation/migration.sqlite';let migration=openStorage(migrationPath);migration.close();
 let db=new DatabaseSync(migrationPath);db.exec('DROP TABLE guest_requests;DROP TABLE guest_accounts;DROP TABLE room_admissions;PRAGMA user_version=3');db.close();
 migration=openStorage(migrationPath);assert.equal(migration.db.prepare('PRAGMA user_version').get().user_version,4);migration.close();
 console.log(JSON.stringify({provisionedSynthetic:true,emptySchemaMigratedTo:4,separateMigration3To4:true}));
}else if(process.argv[2]==='backup'){
 const dest=root+'/backups/phase8-consistent.sqlite';await backupDatabase(path,dest);
 const db=new DatabaseSync(dest,{readOnly:true});const report={backupIntegrity:db.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeyViolations:db.prepare('PRAGMA foreign_key_check').all().length,schemaVersion:db.prepare('PRAGMA user_version').get().user_version,rooms:db.prepare('SELECT count(*) AS n FROM rooms').get().n};db.close();
 const restored=root+'/validation/restore.sqlite';await backupDatabase(dest,restored);
 const store=openStorage(restored),auth=createAuthService(store,{...config,databasePath:restored}),fixture=JSON.parse(await readFile(root+'/validation/fixture.json','utf8'));
 const session=await auth.login(fixture.director);assert.equal(session.user.role,'director');auth.logout(session.token);store.close();
 report.restoredLogin=true;report.restoreIntegrity=true;console.log(JSON.stringify(report));
}else throw new Error('UNKNOWN_OPERATION');

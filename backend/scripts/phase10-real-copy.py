"""Root preparation only: new release + real-data backup/copy rehearsals.

Never changes current, production environment, service, Apache or Pages.
Run only after opening the documented administrative window.
"""
import hashlib
import json
import os
import pathlib
import pwd
import shutil
import sqlite3
import subprocess
import time
import zipfile
import sys

P=pathlib.Path
stage=P('/mnt/ssd/naufragio-phase10-1f19390')
release=P('/opt/naufragio-vtt/releases/phase10-1f19390')
previous=P('/opt/naufragio-vtt/current').resolve()
runtime='/opt/naufragio-vtt/runtime/bin/node'
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def quiet():
    state=subprocess.run(['systemctl','is-active','naufragio-vtt'],capture_output=True,text=True).stdout.strip()
    listeners=subprocess.check_output(['ss','-H','-ltn','sport','=',':3400'],text=True).strip()
    if state!='inactive' or listeners:raise RuntimeError('VTT_ACTIVITY_OR_UNCONFIRMED_QUIESCENCE')
def sql(path):return sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)
def identity(path):
    with sql(path) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('INVALID_SQLITE')
        return {'users':db.execute('SELECT * FROM users ORDER BY id').fetchall(),
                'members':db.execute('SELECT * FROM room_memberships ORDER BY room_id,user_id').fetchall(),
                'labels':db.execute('SELECT * FROM role_labels ORDER BY role').fetchall(),
                'version':db.execute('PRAGMA user_version').fetchone()[0],
                'admins':db.execute("SELECT count(*) FROM users WHERE role='admin' AND disabled=0").fetchone()[0]}
def as_service(*args):
    subprocess.run(['runuser','-u','naufragio-vtt','--',runtime,*args],check=True,capture_output=True,text=True,timeout=120)
assert os.geteuid()==0
os.umask(0o077)
quiet()
if sys.argv[1:] == ['--verify-final']:
    previous_report=json.loads((stage/'evidence/real-copy-result.json').read_text())
    database=P(previous_report['databasePath'])
    assert identity(database)==identity(P(previous_report['backupPath']))
    assert P('/opt/naufragio-vtt/current').resolve()==previous
    old=json.loads((stage/'release-before.json').read_text())
    actual={str(p.relative_to(previous)):digest(p) for p in sorted(previous.rglob('*')) if p.is_file()}
    assert old['hashes']==actual and old['path']==str(previous)
    probes=json.loads((stage/'probes.json').read_text())
    web=[]
    for probe in probes:
        value=subprocess.check_output(['curl','-sS','--max-time','2','--resolve',probe['host']+':443:127.0.0.1','-o','/dev/null','-w','%{http_code} %{time_total} %{ssl_verify_result}','https://'+probe['host']+probe['path']],text=True,timeout=3).split()
        assert value[0]==str(probe['expected']) and value[2]=='0'
        web.append({'label':probe['label'],'code':value[0],'seconds':float(value[1]),'tlsVerified':True})
    services=subprocess.check_output(['systemctl','show','apache2','mariadb','ssh','smbd','-p','Id','-p','ActiveState','-p','MainPID'],text=True)
    assert services==json.loads((stage/'evidence/baseline.json').read_text())['services']
    stats=os.statvfs('/mnt/ssd')
    result={'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'architecture':subprocess.check_output(['uname','-m'],text=True).strip(),
      'productionState':subprocess.check_output(['systemctl','show','naufragio-vtt','-p','MainPID','-p','ActiveState','-p','UnitFileState'],text=True).strip(),
      'currentRelease':str(previous),'previousReleaseFilesUnchanged':len(actual),'realVersion':4,'adminCount':previous_report['adminCount'],
      'realIdentityMatchesBackup':True,'servicePidsAndStatesUnchanged':True,'web':web,
      'nodeProcesses':subprocess.run(['pgrep','-ax','node'],capture_output=True,text=True).stdout.strip(),
      'port3400Free':True,'runtimeSha256':digest(P(runtime)),'supervisorSha256':digest(previous/'backend/deploy/supervisor.py'),
      'candidatePrepared':release.is_dir(),'candidateCurrent':False,'frontendPublished':False,
      'temperatureC':int(P('/sys/class/thermal/thermal_zone0/temp').read_text())/1000,
      'loadavg':P('/proc/loadavg').read_text().strip(),'ssdAvailableBytes':stats.f_bavail*stats.f_frsize}
    assert not result['nodeProcesses']
    output=stage/'evidence/final-host.json';output.write_text(json.dumps(result,indent=2));os.chown(output,stage.stat().st_uid,stage.stat().st_gid);os.chmod(output,0o600)
    print(json.dumps(result))
    raise SystemExit()
assert str(previous)=='/opt/naufragio-vtt/releases/phase9-beta'
assert digest(P(runtime))=='407b390f1667066e55cb36c8622e79d6d488aed417d072487bfbe92f47829d6b'
assert digest(stage/'source-1f19390.zip')=='eca17051896e4554b928a6c57568e041ef1ad686ad76f8973adb721f6899bb99'
assert not release.exists()
# Verify the immutable input before copying privileged release files.
with zipfile.ZipFile(stage/'source-1f19390.zip') as archive:
    for name in archive.namelist():
        if name.startswith('backend/') and not name.endswith('/'):
            if (stage/'source'/name).read_bytes()!=archive.read(name):raise RuntimeError('STAGED_SOURCE_MISMATCH')
manifest=json.loads((stage/'dist/manifest.json').read_text())
assert manifest['storageNamespace']=='phase9-beta'
for item in manifest['files']:
    target=(stage/'dist'/item['path']).resolve()
    assert target.is_relative_to(stage/'dist') and digest(target)==item['sha256']
public=json.loads((stage/'dist/site.config.json').read_text())
assert public['apiBaseUrl']==public['realtimeBaseUrl']=='https://api.naufragio.net' and public['socketPath']=='/socket.io'
# Read only the effective database path; never print or reuse real credentials.
env={}
for line in P('/etc/naufragio-vtt/backend.env').read_text().splitlines():
    if line.strip().startswith('DATABASE_PATH='):env['path']=line.strip().split('=',1)[1].strip().strip('"').strip("'")
database=P(env['path']).resolve()
assert database.is_file() and database.is_relative_to(P('/mnt/ssd/naufragio-vtt/data'))
before=identity(database)
assert before['version']==4 and before['admins']>=1
source_hash=digest(database)
account=pwd.getpwnam('naufragio-vtt')
backup=P('/mnt/ssd/naufragio-vtt/backups/phase10-1f19390')
backup.mkdir(mode=0o700)
os.chown(backup,account.pw_uid,account.pw_gid)
original=backup/'real-v4.sqlite'
quiet()
# Use the existing, installed online-backup procedure under its service identity.
as_service(str(previous/'backend/scripts/database-backup.js'),str(database),str(original))
assert identity(original)==before
shutil.copytree(stage/'source/backend',release/'backend',ignore=shutil.ignore_patterns('node_modules'))
shutil.copytree(previous/'backend/node_modules',release/'backend/node_modules')
shutil.copytree(stage/'dist',release/'frontend')
for path in release.rglob('*'):
    os.chown(path,0,0)
    os.chmod(path,0o555 if path.is_dir() else 0o444)
os.chown(release,0,0);os.chmod(release,0o555)
assert digest(release/'backend/deploy/supervisor.py')==digest(previous/'backend/deploy/supervisor.py')
migrated=backup/'migration-v7.sqlite'
as_service(str(previous/'backend/scripts/database-backup.js'),str(original),str(migrated))
code="import {openStorage} from "+json.dumps((release/'backend/src/storage.js').as_uri())+"; const s=openStorage(process.argv[1]);s.close();"
as_service('--input-type=module','-e',code,str(migrated))
after=identity(migrated)
assert after['version']==7 and all(after[k]==before[k] for k in ['users','members','labels','admins'])
compatible=backup/'rollback-v4.sqlite'
as_service(str(release/'backend/scripts/rollback-phase10.js'),str(migrated),str(compatible))
assert identity(compatible)==before
quiet()
assert database==P(env['path']).resolve() and digest(database)==source_hash and identity(database)==before
assert P('/opt/naufragio-vtt/current').resolve()==previous
report={'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'databasePath':str(database),
    'backupPath':str(original),'migrationCopy':str(migrated),'rollbackCopy':str(compatible),
    'realVersionBefore':4,'realVersionAfter':4,'copyVersion':7,'rollbackVersion':4,
    'adminCount':before['admins'],'identitiesAndPermissionsPreserved':True,'realDatabaseUnchanged':True,
    'releasePrepared':str(release),'currentUnchanged':True,'frontendPublished':False}
output=stage/'evidence/real-copy-result.json'
output.write_text(json.dumps(report,indent=2));os.chown(output,stage.stat().st_uid,stage.stat().st_gid);os.chmod(output,0o600)
print(json.dumps(report))

"""Prepare a private ARMv7 validation tree; no service/configuration mutations."""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tarfile
import time
import zipfile
import sys

root = pathlib.Path('/mnt/ssd/naufragio-phase10-1f19390')
assert root.resolve() == root and root.stat().st_uid == os.getuid() and os.geteuid() != 0
os.umask(0o077)
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
if sys.argv[1:] == ['frontend']:
    assert digest(root/'candidate-frontend.tar') == '169da1e26498fff884f0891d20d631cd8ba3190be9d16618d6552ea822beee51'
    target=root/'dist'
    if target.exists():
        assert target.resolve().parent == root
        os.chmod(target,0o700)
        for path in target.rglob('*'):
            assert not path.is_symlink()
            os.chmod(path,0o700 if path.is_dir() else 0o600)
    with tarfile.open(root/'candidate-frontend.tar') as archive:
        for member in archive.getmembers():
            assert not member.issym() and not member.islnk()
            assert (root/member.name).resolve().is_relative_to(target)
            archive.extract(member,root,set_attrs=False,filter='data')
    manifest=json.loads((target/'manifest.json').read_text())
    assert manifest['storageNamespace']=='phase9-beta'
    for item in manifest['files']:
        assert digest(target/item['path']) == item['sha256']
    print(json.dumps({'frontendStaged':True,'files':len(manifest['files']),'published':False}))
    raise SystemExit()
assert digest(root/'source-1f19390.zip') == 'eca17051896e4554b928a6c57568e041ef1ad686ad76f8973adb721f6899bb99'
assert digest(root/'dependencies.tar') == '02cfdace14826197aa880e6ef9c7f3ca543706723ccb52af9626ad94a0108f37'
assert not subprocess.run(['ss','-H','-ltn','sport','=',':3400'],capture_output=True,text=True,check=True).stdout.strip()
assert subprocess.run(['systemctl','is-active','naufragio-vtt'],capture_output=True,text=True).stdout.strip() == 'inactive'
source = root/'source'
source.mkdir(mode=0o700)
with zipfile.ZipFile(root/'source-1f19390.zip') as archive:
    for item in archive.infolist():
        assert (source/item.filename).resolve().is_relative_to(source)
    archive.extractall(source)
with tarfile.open(root/'dependencies.tar') as archive:
    for item in archive.getmembers():
        assert not item.issym() and not item.islnk()
        assert (source/'backend'/item.name).resolve().is_relative_to(source/'backend')
    archive.extractall(source/'backend',filter='data')
(root/'tmp').mkdir(mode=0o700)
release = pathlib.Path('/opt/naufragio-vtt/current').resolve()
hashes = {str(p.relative_to(release)):digest(p) for p in sorted(release.rglob('*')) if p.is_file()}
(root/'release-before.json').write_text(json.dumps({'path':str(release),'hashes':hashes},indent=2))
sites = [
    ('heavensgate','naufragio-heavensgate-le-ssl.conf',200),
    ('forum','naufragio-foros-le-ssl.conf',200),
    ('proxy','autonaufragio-le-ssl.conf',404),
    ('bibprof','bibprof-le-ssl.conf',200),
    ('ordenanthia','ordenanthia-le-ssl.conf',200),
    ('gallery','starkvind-gallery-le-ssl.conf',200),
]
probes = []
for label,name,expected in sites:
    text = (pathlib.Path('/etc/apache2/sites-enabled')/name).read_text()
    host = re.search(r'^\s*ServerName\s+([^\s#]+)',text,re.M).group(1)
    probes.append({'label':label,'host':host,'path':'/','expected':expected})
(root/'probes.json').write_text(json.dumps(probes))
stats = os.statvfs('/mnt/ssd')
baseline = {'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'release':str(release),
    'releaseFiles':len(hashes),'releaseManifestSha256':digest(root/'release-before.json'),
    'runtimeSha256':digest(pathlib.Path('/opt/naufragio-vtt/runtime/bin/node')),
    'supervisorSha256':digest(release/'backend/deploy/supervisor.py'),
    'loadavg':pathlib.Path('/proc/loadavg').read_text().strip(),
    'meminfo':pathlib.Path('/proc/meminfo').read_text(),
    'temperatureC':int(pathlib.Path('/sys/class/thermal/thermal_zone0/temp').read_text())/1000,
    'ssd':{'totalBytes':stats.f_blocks*stats.f_frsize,'availableBytes':stats.f_bavail*stats.f_frsize},
    'services':subprocess.check_output(['systemctl','show','apache2','mariadb','ssh','smbd','-p','Id','-p','ActiveState','-p','MainPID'],text=True)}
(root/'evidence/baseline.json').write_text(json.dumps(baseline,indent=2))
print(json.dumps({key:baseline[key] for key in ['utc','release','releaseFiles','runtimeSha256','supervisorSha256','temperatureC','ssd']}))

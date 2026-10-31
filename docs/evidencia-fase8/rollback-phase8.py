"""Root-only rollback for newly created Phase 8 resources; never execute implicitly."""
import pathlib,subprocess,os,shutil
assert os.geteuid()==0
unit=pathlib.Path('/etc/systemd/system/naufragio-vtt.service')
assert unit.is_file() and not unit.is_symlink()
assert '/opt/naufragio-vtt/current/backend/deploy/supervisor.py' in unit.read_text()
subprocess.run(['systemctl','stop','naufragio-vtt'],check=True)
assert not subprocess.check_output(['ss','-lntH','sport','=',':3400']).strip()
subprocess.run(['systemctl','disable','naufragio-vtt'],check=True)
unit.unlink();subprocess.run(['systemctl','daemon-reload'],check=True)
account=subprocess.check_output(['getent','passwd','naufragio-vtt']).decode().strip().split(':');assert account[5]=='/nonexistent' and account[6]=='/usr/sbin/nologin'
for name,parent in [('/etc/naufragio-vtt','/etc'),('/mnt/ssd/naufragio-vtt','/mnt/ssd'),('/opt/naufragio-vtt','/opt')]:
 p=pathlib.Path(name);assert p.resolve()==p and p.parent==pathlib.Path(parent) and not p.is_symlink()
 # Includes exclusively the new VTT synthetic data: preserve copies elsewhere before explicit rollback if needed.
 shutil.rmtree(p)
subprocess.run(['userdel','naufragio-vtt'],check=True)
if subprocess.run(['getent','group','naufragio-vtt'],stdout=subprocess.DEVNULL).returncode==0:subprocess.run(['groupdel','naufragio-vtt'],check=True)
print('VTT_ONLY_ROLLBACK_COMPLETE')

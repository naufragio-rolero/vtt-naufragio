"""Temporary, explicitly approved SSH exception. Run through an open SSH session.

Root required. Restores exact original config on stop marker, signal or 20 minutes.
No keys, accounts, global forwarding settings or other services are changed.
"""
import hashlib
import json
import os
import pathlib
import pwd
import shutil
import signal
import subprocess
import tempfile
import time

config = pathlib.Path('/etc/ssh/sshd_config')
stop = False
def stopping(*_):
    global stop
    stop = True
for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(sig, stopping)
def run(args, **kw):
    return subprocess.run(args, capture_output=True, check=True, **kw)
def emit(**value):
    print(json.dumps(value), flush=True)
def replace(data, stat):
    fd, name = tempfile.mkstemp(prefix='.naufragio-sshd-', dir=config.parent)
    try:
        os.fchown(fd, stat.st_uid, stat.st_gid)
        os.fchmod(fd, stat.st_mode & 0o777)
        with os.fdopen(fd, 'wb') as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.replace(name, config)
    finally:
        if os.path.exists(name):
            os.unlink(name)
if os.geteuid() != 0:
    raise SystemExit('ROOT_REQUIRED')
user = os.environ.get('SUDO_USER', '')
if not user or user == 'root':
    raise SystemExit('SSH_ACCOUNT_REQUIRED')
pwd.getpwnam(user)
original = config.read_bytes()
metadata = config.stat()
candidate = original + ('\n# Naufragio: excepcion privada de piloto; MariaDB conservado\nMatch User ' + user + '\n    PermitOpen 127.0.0.1:3306 127.0.0.1:3400\n').encode()
run(['/usr/sbin/sshd', '-t', '-f', '/dev/stdin'], input=candidate)
for account, expected in ((user, '127.0.0.1:3306 127.0.0.1:3400'), ('nobody', '127.0.0.1:3306')):
    effective = run(['/usr/sbin/sshd', '-T', '-f', '/dev/stdin', '-C', 'user=' + account], input=candidate).stdout.decode()
    if 'permitopen ' + expected + '\n' not in effective or 'allowtcpforwarding local\n' not in effective:
        raise SystemExit('UNEXPECTED_EFFECTIVE_CONFIG')
current = run(['/usr/sbin/sshd', '-T', '-C', 'user=' + user]).stdout.decode()
if 'permitopen 127.0.0.1:3306\n' not in current:
    raise SystemExit('BASELINE_CHANGED')
root = pathlib.Path(tempfile.mkdtemp(prefix='naufragio-ssh-', dir='/var/tmp'))
os.chmod(root, 0o700)
(root / 'original').write_bytes(original)
os.chmod(root / 'original', 0o600)
applied = False
restored = False
try:
    if config.read_bytes() != original:
        raise RuntimeError('CONCURRENT_CONFIG_CHANGE')
    replace(candidate, metadata)
    applied = True
    run(['/usr/sbin/sshd', '-t'])
    run(['systemctl', 'reload', 'ssh'])
    emit(state='applied', rollbackRoot=str(root), originalSha256=hashlib.sha256(original).hexdigest(), timeoutSeconds=1200)
    deadline = time.monotonic() + 1200
    while not stop and time.monotonic() < deadline and not (root / 'stop').exists():
        time.sleep(1)
finally:
    if applied:
        if config.read_bytes() != candidate:
            emit(state='rollback_blocked_concurrent_change', backupRetained=str(root))
        else:
            replace(original, metadata)
            run(['/usr/sbin/sshd', '-t'])
            run(['systemctl', 'reload', 'ssh'])
            restored = config.read_bytes() == original
            emit(state='restored', exactBytes=restored, originalSha256=hashlib.sha256(original).hexdigest())
    else:
        restored = True
    if restored:
        # Verified root is the private mkdtemp owned by this controller.
        if root.parent == pathlib.Path('/var/tmp') and root.name.startswith('naufragio-ssh-') and root.stat().st_uid == 0:
            shutil.rmtree(root)
            emit(state='policy_cleanup_complete')

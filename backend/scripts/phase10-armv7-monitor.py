"""Isolated test monitor: reuse installed guard/probes; never control production.

Run in a transient user service with Type=notify, WatchdogSec=10 and CPUQuota=100%.
The installed supervisor is imported read-only and its thresholds are unchanged.
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import signal
import subprocess
import sys
import time
sys.dont_write_bytecode = True

root = pathlib.Path(sys.argv[1]).resolve()
if root != pathlib.Path('/mnt/ssd/naufragio-phase10-1f19390') or os.geteuid() == 0:
    raise SystemExit('PRIVATE_UNPRIVILEGED_STAGE_REQUIRED')
installed = pathlib.Path('/opt/naufragio-vtt/current/backend/deploy/supervisor.py')
if hashlib.sha256(installed.read_bytes()).hexdigest() != '66493462bcadc49f7c0e994a076724e3f45c86fa22245ddd298bd91a69fa6c51':
    raise SystemExit('INSTALLED_SUPERVISOR_CHANGED')
spec = importlib.util.spec_from_file_location('installed_guard', installed)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
batch = sys.argv[2]
batches = {
    'core': ['guests', 'board-bounds', 'dice', 'phase10-migration', 'rooms-persistence'],
    'authority': ['token-sync', 'presence'],
    'media': ['assets', 'asset-client-timers'],
}
if batch not in batches or int(os.environ.get('WATCHDOG_USEC', '0')) != 10000000:
    raise SystemExit('INVALID_BATCH_OR_WATCHDOG')
probes = guard.independent_probes(json.loads((root / 'probes.json').read_text()))
services = guard.service_state()
baseline = [guard.probe(p) for p in probes]
initial = guard.resources()
if initial['availableKiB'] < 384 * 1024:
    raise SystemExit('INSUFFICIENT_INITIAL_MEMORY')
if subprocess.run(['systemctl', 'is-active', 'naufragio-vtt'], capture_output=True, text=True).stdout.strip() == 'active':
    raise SystemExit('PRODUCTION_ACTIVE')
args = ['/opt/naufragio-vtt/runtime/bin/node', '--max-old-space-size=64', '--test',
        '--experimental-test-isolation=none', '--test-concurrency=1']
args += ['tests/' + name + '.test.js' for name in batches[batch]]
env = dict(os.environ, UV_THREADPOOL_SIZE='1', TMPDIR=str(root / 'tmp'))
for key in ['NOTIFY_SOCKET', 'WATCHDOG_USEC', 'WATCHDOG_PID']:
    env.pop(key, None)
stop = False

def stopping(*_):
    global stop
    stop = True
for sig in [signal.SIGTERM, signal.SIGINT]:
    signal.signal(sig, stopping)
began = time.monotonic()
child = None
reason = 'pass'
try:
    with (root / 'evidence' / (batch + '-tests.txt')).open('w') as output:
        child = subprocess.Popen(args, cwd=root / 'source/backend', env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        guard.notify('READY=1\nWATCHDOG=1')
        ticks = os.sysconf('SC_CLK_TCK')
        with (root / 'evidence' / (batch + '-metrics.jsonl')).open('w', buffering=1) as log:
            n = 0
            while child.poll() is None and not stop:
                if time.monotonic() - began >= 900:
                    raise RuntimeError('VALIDATION_TIMEOUT')
                try:
                    sample = guard.resources(child)
                    stat = pathlib.Path('/proc', str(child.pid), 'stat').read_text().split()
                except (FileNotFoundError, ProcessLookupError, StopIteration):
                    if child.poll() is not None:
                        break
                    raise
                sample.update(elapsedSeconds=round(time.monotonic()-began,3), userCpuSeconds=int(stat[13])/ticks, systemCpuSeconds=int(stat[14])/ticks)
                current = guard.probe(probes[n % 6])
                if current['seconds'] > max(1.0, baseline[n % 6]['seconds'] * 5):
                    raise RuntimeError('WEB_LATENCY_REGRESSION')
                sample['web'] = current
                if n % 5 == 0:
                    if subprocess.run(['systemctl','is-active','naufragio-vtt'],capture_output=True,text=True).stdout.strip() == 'active':
                        raise RuntimeError('PRODUCTION_ACTIVITY_DETECTED')
                    sample['servicesUnchanged'] = guard.service_state() == services
                    if not sample['servicesUnchanged']:
                        raise RuntimeError('SERVICE_CHANGED')
                log.write(json.dumps(sample)+'\n')
                guard.notify('WATCHDOG=1')
                n += 1
                time.sleep(1)
        if stop or child.wait() != 0:
            raise RuntimeError('TESTS_STOPPED_OR_FAILED')
except Exception as error:
    reason = str(error)
    raise
finally:
    if child and child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=2)
    result = {'batch':batch,'reason':reason,'elapsedSeconds':round(time.monotonic()-began,3), 'childExited':child is None or child.poll() is not None}
    (root / 'evidence' / (batch + '-result.json')).write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)

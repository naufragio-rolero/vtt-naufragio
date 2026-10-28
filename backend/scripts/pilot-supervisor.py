"""Unprivileged, bounded pilot supervisor; root must contain only staged test files.

Resources, services and anonymous HTTP probes are sampled outside Node. No sudo.
Stop/restart markers inside the private root are the only controller commands.
"""
import json
import os
import pathlib
import resource
import signal
import subprocess
import sys
import time

root = pathlib.Path(sys.argv[1]).resolve()
if root.parent != pathlib.Path('/var/tmp') or not root.name.startswith('naufragio-pilot.') or root.is_symlink() or root.stat().st_uid != os.getuid() or os.geteuid() == 0:
    raise SystemExit('UNSAFE_PILOT_ROOT')
stop = False
def stopping(*_):
    global stop
    stop = True
for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(sig, stopping)
services = ['apache2', 'mariadb', 'ssh', 'smbd']
def service_state():
    return {name: subprocess.run(['systemctl', 'show', name, '-p', 'ActiveState', '-p', 'MainPID'], capture_output=True, text=True).stdout.strip() for name in services}
probes = json.loads((root / 'probes.json').read_text())
def web_state():
    results = []
    for item in probes:
        result = subprocess.run(['curl', '-k', '-s', '--max-time', '3', '--resolve', item['host'] + ':443:127.0.0.1', '-o', '/dev/null', '-w', '%{http_code} %{time_total}', 'https://' + item['host'] + item['path']], capture_output=True, text=True)
        parts = result.stdout.split()
        results.append({'label': item['label'], 'code': parts[0] if parts else '000', 'seconds': float(parts[1]) if len(parts) == 2 else None})
    return results
baseline_services = service_state()
baseline_web = web_state()
if any('ActiveState=active' not in value for value in baseline_services.values()) or any(item['code'] != str(probes[index].get('expected', '200')) for index, item in enumerate(baseline_web)):
    raise SystemExit('UNHEALTHY_BASELINE')
os.umask(0o077)
env = {'PATH': '/usr/bin:/bin', 'HOME': str(root / 'home'), 'TMPDIR': str(root / 'tmp'), 'SQLITE_TMPDIR': str(root / 'tmp'),
       'PILOT_ROOT': str(root), 'UV_THREADPOOL_SIZE': '1', 'LANG': 'C.UTF-8'}
for directory in ['home', 'tmp']:
    (root / directory).mkdir(mode=0o700, exist_ok=True)
log = open(root / 'server.log', 'ab', buffering=0)
def limits():
    os.nice(19)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (180, 185))
def start():
    return subprocess.Popen([str(root / 'node'), '--max-old-space-size=64', 'scripts/pilot-server.js'], cwd=root / 'backend', env=env,
                            stdout=log, stderr=log, start_new_session=True, preexec_fn=limits)
def terminate(child):
    if child and child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try: child.wait(timeout=6)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=5)
child = None
ticks = os.sysconf('SC_CLK_TCK')
began = time.monotonic()
reason = 'controller_stop'
try:
    child = start()
    print(json.dumps({'state': 'supervising', 'pid': child.pid, 'timeoutSeconds': 720}), flush=True)
    with open(root / 'metrics.jsonl', 'w', buffering=1) as metrics:
        n = 0
        while not stop and not (root / 'stop').exists() and time.monotonic() - began < 720:
            if (root / 'restart').exists():
                terminate(child)
                (root / 'restart').unlink()
                child = start()
                print(json.dumps({'state': 'restarted', 'pid': child.pid}), flush=True)
            if child.poll() is not None:
                reason = 'backend_exited'; break
            status = pathlib.Path('/proc/' + str(child.pid) + '/status').read_text()
            rss = int(next(line.split()[1] for line in status.splitlines() if line.startswith('VmRSS:')))
            mem = pathlib.Path('/proc/meminfo').read_text().splitlines()
            available = int(next(line.split()[1] for line in mem if line.startswith('MemAvailable:')))
            temp = int(pathlib.Path('/sys/class/thermal/thermal_zone0/temp').read_text()) / 1000
            stat = pathlib.Path('/proc/' + str(child.pid) + '/stat').read_text().split()
            sample = {'elapsedSeconds': round(time.monotonic() - began, 3), 'pid': child.pid, 'rssKiB': rss, 'availableKiB': available,
                      'temperatureC': temp, 'userCpuSeconds': int(stat[13]) / ticks, 'systemCpuSeconds': int(stat[14]) / ticks}
            if n % 5 == 0:
                current_services = service_state()
                current_web = web_state()
                sample['servicesUnchanged'] = current_services == baseline_services
                sample['web'] = current_web
                connections = subprocess.run(['ss', '-ntH', 'sport', '=', ':3400'], capture_output=True, text=True).stdout.splitlines()
                sample['establishedConnections'] = sum(line.startswith('ESTAB') for line in connections)
                if current_services != baseline_services or [i['code'] for i in current_web] != [i['code'] for i in baseline_web]:
                    reason = 'service_degradation'; metrics.write(json.dumps(sample) + '\n'); break
            metrics.write(json.dumps(sample) + '\n')
            if rss > 160 * 1024 or available < 192 * 1024 or temp >= 75:
                reason = 'resource_guard'; break
            n += 1
            time.sleep(1)
        else:
            if time.monotonic() - began >= 720: reason = 'timeout'
finally:
    terminate(child)
    log.close()
    print(json.dumps({'state': 'stopped', 'reason': reason, 'servicesUnchanged': service_state() == baseline_services, 'web': web_state()}), flush=True)

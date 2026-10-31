"""Private VTT supervisor. Runs as the unit's unprivileged main process.

No changes to other services. systemd WatchdogSec/KillMode cover supervisor
failure or a stalled monitor; Linux parent-death signal also covers child orphaning.
"""
import ctypes
import json
import os
import pathlib
import signal
import socket
import subprocess
import time
import urllib.request

RSS_KIB = 160 * 1024
AVAILABLE_KIB = 192 * 1024
TEMPERATURE_C = 75
SERVICES = ['apache2', 'mariadb', 'ssh', 'smbd']
libc = ctypes.CDLL(None, use_errno=True)
stopping = False


def stop(*_):
    global stopping
    stopping = True


for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, stop)


def notify(message):
    address = os.environ.get('NOTIFY_SOCKET')
    if not address:
        raise RuntimeError('SYSTEMD_NOTIFY_REQUIRED')
    if address.startswith('@'):
        address = '\0' + address[1:]
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as connection:
        connection.connect(address)
        connection.sendall(message.encode())


def service_state():
    notify('WATCHDOG=1')
    result = subprocess.run(['systemctl', 'show', *SERVICES, '-p', 'Id', '-p',
                             'ActiveState', '-p', 'MainPID'], capture_output=True,
                            text=True, timeout=3, check=True)
    notify('WATCHDOG=1')
    if result.stdout.count('ActiveState=active') != len(SERVICES):
        raise RuntimeError('SERVICE_UNHEALTHY')
    return result.stdout.strip()


def probe(item):
    notify('WATCHDOG=1')
    result = subprocess.run(['curl', '-sS', '--max-time', '2', '--resolve',
                             item['host'] + ':443:127.0.0.1', '-o', '/dev/null',
                             '-w', '%{http_code} %{time_total} %{ssl_verify_result}',
                             'https://' + item['host'] + item['path']],
                            capture_output=True, text=True, timeout=3, check=True)
    parts = result.stdout.split()
    if len(parts) != 3 or parts[0] != str(item['expected']) or parts[2] != '0':
        raise RuntimeError('WEB_UNHEALTHY')
    notify('WATCHDOG=1')
    return {'label': item['label'], 'code': parts[0], 'seconds': float(parts[1])}


def resources(child=None):
    mem = pathlib.Path('/proc/meminfo').read_text().splitlines()
    available = int(next(s.split()[1] for s in mem if s.startswith('MemAvailable:')))
    temp = int(pathlib.Path('/sys/class/thermal/thermal_zone0/temp').read_text()) / 1000
    def rss(pid):
        status = pathlib.Path('/proc', str(pid), 'status').read_text().splitlines()
        return int(next(s.split()[1] for s in status if s.startswith('VmRSS:')))
    own = rss(os.getpid())
    backend = rss(child.pid) if child else 0
    result = {'availableKiB': available, 'temperatureC': temp,
              'backendRssKiB': backend, 'supervisorRssKiB': own,
              'rssKiB': backend + own}
    if available < AVAILABLE_KIB or temp >= TEMPERATURE_C or backend + own > RSS_KIB:
        raise RuntimeError('RESOURCE_GUARD')
    return result


def health():
    try:
        with urllib.request.urlopen('http://127.0.0.1:3400/health', timeout=1) as response:
            return response.status == 200
    except OSError:
        return False


def main():
    child = None
    reason = 'normal_stop'
    began = time.monotonic()
    exit_code = 0
    try:
        if os.geteuid() == 0:
            raise RuntimeError('UNPRIVILEGED_USER_REQUIRED')
        if int(os.environ.get('WATCHDOG_USEC', '0')) <= 0:
            raise RuntimeError('SYSTEMD_WATCHDOG_REQUIRED')
        limit = int(os.environ.get('SUPERVISOR_MAX_SECONDS', '900'))
        if not 1 <= limit <= 3600:
            raise RuntimeError('INVALID_SUPERVISION_WINDOW')
        initial = resources()
        if initial['availableKiB'] < 384 * 1024:
            raise RuntimeError('INSUFFICIENT_INITIAL_MEMORY')
        probes = json.loads(pathlib.Path(os.environ['SUPERVISOR_PROBES']).read_text())
        baseline_services = service_state()
        baseline_web = [probe(item) for item in probes]
        print(json.dumps({'state': 'baseline', 'resources': initial,
                          'web': baseline_web}), flush=True)
        parent = os.getpid()
        def child_limits():
            # Set before exec and close the race where the parent died first.
            if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0 or os.getppid() != parent:
                os._exit(111)
        env = dict(os.environ)
        for name in ['NOTIFY_SOCKET', 'WATCHDOG_USEC', 'WATCHDOG_PID']:
            env.pop(name, None)
        child = subprocess.Popen(['/opt/naufragio-vtt/runtime/bin/node',
                                  '--max-old-space-size=64', 'src/main.js'],
                                 env=env, start_new_session=True,
                                 preexec_fn=child_limits)
        ticks = os.sysconf('SC_CLK_TCK')
        ready = False
        n = 0
        metrics = pathlib.Path(os.environ['SUPERVISOR_METRICS'])
        with metrics.open('a', buffering=1) as log:
            while not stopping and time.monotonic() - began < limit:
                if child.poll() is not None:
                    raise RuntimeError('BACKEND_EXITED')
                sample = resources(child)
                stat = pathlib.Path('/proc', str(child.pid), 'stat').read_text().split()
                sample.update(elapsedSeconds=round(time.monotonic() - began, 3),
                              backendPid=child.pid, supervisorPid=os.getpid(),
                              userCpuSeconds=int(stat[13]) / ticks,
                              systemCpuSeconds=int(stat[14]) / ticks)
                current = probe(probes[n % len(probes)])
                baseline = baseline_web[n % len(probes)]
                if current['seconds'] > max(1.0, baseline['seconds'] * 5):
                    raise RuntimeError('WEB_LATENCY_REGRESSION')
                sample['web'] = current
                if n % 5 == 0:
                    sample['servicesUnchanged'] = service_state() == baseline_services
                    if not sample['servicesUnchanged']:
                        raise RuntimeError('SERVICE_CHANGED')
                log.write(json.dumps(sample) + '\n')
                if not ready:
                    if health():
                        ready = True
                        notify('READY=1\nWATCHDOG=1\nSTATUS=Private VTT supervised')
                    elif time.monotonic() - began > 35:
                        raise RuntimeError('BACKEND_NOT_READY')
                notify('WATCHDOG=1')
                n += 1
                time.sleep(1)
        if not stopping:
            reason = 'supervision_window_complete'
    except Exception as error:
        # KillMode=control-group can terminate an in-flight curl/systemctl
        # together with Node during an explicitly requested systemctl stop.
        # Never convert resource/service guard failures into a successful stop.
        interrupted_probe = (isinstance(error, subprocess.CalledProcessError)
                             and error.returncode in (-signal.SIGTERM, -signal.SIGKILL))
        child_disappeared = isinstance(error, (FileNotFoundError, ProcessLookupError, StopIteration))
        if stopping and (interrupted_probe or child_disappeared or str(error) == 'BACKEND_EXITED'):
            reason = 'normal_stop'
        else:
            reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
            exit_code = 1
    finally:
        if child and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait(timeout=2)
        print(json.dumps({'state': 'supervisor_stopped', 'reason': reason,
                          'backendExited': child is None or child.poll() is not None}), flush=True)
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())

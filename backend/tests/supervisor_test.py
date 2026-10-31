"""Focused supervisor checks. Accelerated duration checks are not a real soak."""
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('supervisor', pathlib.Path(__file__).parents[1] / 'deploy/supervisor.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)


class SupervisorTests(unittest.TestCase):
    def test_finite_window(self):
        self.assertEqual(s.supervision_window({'SUPERVISOR_MAX_SECONDS': '16200'}), 16200)
        for value in ['0', '16201', '-1', '1e4', '', 'Infinity']:
            with self.assertRaises(RuntimeError):
                s.supervision_window({'SUPERVISOR_MAX_SECONDS': value})

    def test_proxy_health_headers_are_private_and_direct_mode_has_none(self):
        self.assertEqual(s.health_request({}).header_items(), [])
        key = 'a' * 64
        request = s.health_request({'TRUST_PROXY_LOOPBACK': 'true', 'TRUSTED_PROXY_TOKEN': key})
        headers = dict((k.lower(), v) for k, v in request.header_items())
        self.assertEqual(headers['x-naufragio-proxy-token'], key)
        self.assertEqual(headers['x-forwarded-for'], '127.0.0.1')
        self.assertEqual(headers['x-forwarded-proto'], 'https')
        self.assertNotIn(key, request.full_url)
        with self.assertRaisesRegex(RuntimeError, '^INVALID_HEALTH_PROXY_CONFIGURATION$'):
            s.health_request({'TRUST_PROXY_LOOPBACK': 'true', 'TRUSTED_PROXY_TOKEN': 'invalid'})
        self.assertIsNone(s.NoHealthRedirect().redirect_request(None, None, 302, '', {}, 'https://example.invalid'))

    def test_health_verifies_identity_and_does_not_use_environment_proxy(self):
        s.health_opener.cache_clear()
        self.addCleanup(s.health_opener.cache_clear)
        response = MagicMock()
        response.status = 200
        response.read.return_value = b'{"status":"ok","service":"naufragio-vtt","protocolVersion":1}'
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with patch.object(s.urllib.request, 'build_opener', return_value=opener) as build:
            self.assertTrue(s.health())
            self.assertEqual(build.call_args.args[0].proxies, {})
            response.read.return_value = b'{"status":"ok","service":"other"}'
            self.assertFalse(s.health())
            for _ in range(1000):
                self.assertFalse(s.health())
            self.assertEqual(build.call_count, 1)

    def test_only_six_independent_services_before_backend_start(self):
        probes = [{'host': 'site' + str(i) + '.invalid', 'path': '/', 'expected': 200} for i in range(6)]
        self.assertEqual(s.independent_probes(probes), probes)
        with self.assertRaises(RuntimeError):
            s.independent_probes(probes + [{'host': 'api.naufragio.net', 'path': '/', 'expected': 403}])
        probes[0]['host'] = 'api.naufragio.net'
        with self.assertRaises(RuntimeError):
            s.independent_probes(probes)

    def test_resource_guards_keep_limits_and_report_the_triggering_sample(self):
        for available, temperature, own in [(192 * 1024 - 1, 74000, 1000),
                                            (192 * 1024, 75000, 1000),
                                            (192 * 1024, 74000, 160 * 1024 + 1)]:
            def read(path):
                if path.as_posix() == '/proc/meminfo':
                    return 'MemAvailable: ' + str(available) + ' kB\n'
                if path.as_posix().endswith('/temp'):
                    return str(temperature)
                return 'VmRSS: ' + str(own) + ' kB\n'
            with patch.object(s.pathlib.Path, 'read_text', read):
                with self.assertRaises(s.ResourceGuard) as caught:
                    s.resources()
                self.assertEqual(caught.exception.sample['rssKiB'], own)
                self.assertEqual(caught.exception.sample['availableKiB'], available)

    def test_four_and_half_hours_of_metrics_have_bounded_files_and_descriptors(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'monitor.jsonl'
            with s.MetricsLog(path, max_bytes=2048) as log:
                for second in range(16200):
                    log.write({'elapsedSeconds': second, 'rssKiB': 100000})
                self.assertFalse(log.file.closed)
            self.assertTrue(log.file.closed)
            files = list(path.parent.iterdir())
            self.assertLessEqual(len(files), 4)
            for file in files:
                self.assertLessEqual(file.stat().st_size, 2048)
                for line in file.read_text().splitlines():
                    json.loads(line)


if __name__ == '__main__':
    unittest.main()

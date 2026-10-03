"""Offline regression checks for ROX security patches to pinned upstream scripts."""
import ast
import contextlib
import datetime
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

ROOT = Path(sys.argv.pop(1)) / 'apps/electron/resources/skills'
CLI = ROOT / 'last30days/last30days/scripts/last30days.py'
HOSTED = ROOT / 'last30days/last30days/scripts/lib/hosted.py'
DEMO = ROOT / 'last30days/last30days/scripts/test_device_auth.py'
DETACH = ROOT / 'gstack/gstack/bin/gstack-detach'


def functions(path, names, namespace=None):
    tree = ast.parse(path.read_text())
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(selected) == len(names)
    future = ast.parse('from __future__ import annotations').body
    unit = ast.fix_missing_locations(ast.Module(body=future + selected, type_ignores=[]))
    scope = {'os': os, 'Path': Path, 'datetime': datetime, 'json': json}
    scope.update(namespace or {})
    exec(compile(unit, str(path), 'exec'), scope)
    return scope


class VendorSecurity(unittest.TestCase):
    def test_patched_scripts_compile_without_imports_or_network(self):
        for path in (CLI, HOSTED, DEMO, DETACH):
            compile(path.read_text(), str(path), 'exec')

    @unittest.skipIf(os.name == 'nt', 'POSIX permission bits; Windows uses native ACLs')
    def test_detached_logs_are_private_and_existing_logs_tightened(self):
        scope = functions(DETACH, ['open_private_log'])
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'worker.log'
            for previous in (None, 0o644):
                if previous is not None:
                    path.chmod(previous)
                descriptor = scope['open_private_log'](str(path))
                os.write(descriptor, b'fixture report\n')
                os.close(descriptor)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    @unittest.skipIf(os.name == 'nt', 'POSIX permission bits; Windows uses native ACLs')
    def test_local_discovery_and_hosted_reports_are_private(self):
        scope = functions(CLI, ['save_output', '_save_discovery_output', '_ensure_output_directory'], {
            'slugify': lambda value: 'fixture', 'sanitize_suffix': lambda value: value,
            '_report_has_private_corpus': lambda report: False,
        })
        hosted = functions(HOSTED, ['_save_output'], {'_slugify': lambda value: 'fixture'})
        with tempfile.TemporaryDirectory() as root:
            report = types.SimpleNamespace(topic='fixture')
            outputs = [scope['save_output'](report, 'json', root, rendered_content='fixture'),
                       scope['_save_discovery_output']('fixture', domain='fixture', emit='json', save_dir=root),
                       hosted['_save_output']('fixture', 'fixture', 'json', root, 'hosted')]
            for path in outputs:
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    @unittest.skipIf(os.name == 'nt', 'POSIX permission bits; Windows uses native ACLs')
    def test_explicit_output_tightens_existing_mode_before_writing(self):
        scope = functions(CLI, ['save_rendered_output', '_ensure_output_directory'])
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'report.json'
            path.write_text('old fixture'); path.chmod(0o644)
            scope['save_rendered_output']('new fixture', str(path), private=False)
            self.assertEqual(path.read_text(), 'new fixture')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_device_summary_omits_secrets_and_backend_detail_for_every_status(self):
        summary = functions(CLI, ['device_auth_public_summary'])['device_auth_public_summary']
        for status in ('success', 'already_registered', 'awaiting_authorization', 'timeout', 'unexpected'):
            source = {'status': status, 'api_key': 'fixture-secret-api', 'access_token': 'fixture-secret-token',
                      'password': 'fixture-secret-password', 'detail': 'fixture-secret-detail',
                      'device_code': 'fixture-secret-device', 'user_code': 'ABCD-EFGH',
                      'verification_uri': 'https://github.com/login/device', 'persisted': True}
            result = summary(source)
            self.assertNotIn('fixture-secret', json.dumps(result))
            self.assertEqual(source['api_key'], 'fixture-secret-api')
            if status == 'awaiting_authorization':
                self.assertEqual(result['user_code'], 'ABCD-EFGH')
                self.assertEqual(result['verification_uri'], 'https://github.com/login/device')

    def test_device_demo_persists_key_without_printing_profile_or_credentials(self):
        writes = []
        lib = types.ModuleType('lib')
        lib.env = types.SimpleNamespace(CONFIG_FILE='fixture-private-config')
        lib.setup_wizard = types.SimpleNamespace(write_api_key=lambda path, key: writes.append((path, key)) or True)
        def post(url, data=None):
            if url.endswith('/code'):
                return {'device_code': 'fixture-secret-device', 'user_code': 'ABCD-EFGH', 'expires_in': 10, 'interval': 0}
            return {'access_token': 'fixture-secret-token'}
        scope = functions(DEMO, ['main'], {'BASE': 'https://fixture.invalid', '_post': post,
            '_get': lambda url, token: {'api_key': 'fixture-secret-api', 'password': 'fixture-secret-password'},
            'time': types.SimpleNamespace(time=lambda: 0, sleep=lambda delay: None),
            'webbrowser': types.SimpleNamespace(open=lambda url: None), 'sys': sys,
            'HTTPError': HTTPError, 'URLError': URLError})
        output = io.StringIO()
        with patch.dict(sys.modules, {'lib': lib}), contextlib.redirect_stdout(output):
            scope['main']()
        self.assertNotIn('fixture-secret', output.getvalue())
        self.assertEqual(writes, [('fixture-private-config', 'fixture-secret-api')])


if __name__ == '__main__':
    unittest.main()

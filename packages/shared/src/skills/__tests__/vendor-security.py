"""Offline regression checks for ROX security patches to pinned upstream scripts."""
import ast
import contextlib
import copy
import datetime
import io
import json
import os
import re
from pathlib import Path
import sys
import tempfile
import threading
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


    def test_review_scope_scoped_case_regex_matches_expected_paths(self):
        path = ROOT / 'compound-engineering/ce-code-review/scripts/review-scope.py'
        tree = ast.parse(path.read_text())
        assignment = next(n for n in tree.body if isinstance(n, ast.Assign)
                          and any(isinstance(t, ast.Name) and t.id == 'TEST_PATTERN' for t in n.targets))
        scope = {'re': re}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[assignment], type_ignores=[])), str(path), 'exec'), scope)
        pattern = scope['TEST_PATTERN']
        for name in ('tests/unit.py', 'src/a.test.ts', 'test_api.py', 'src/AuthTest.java', 'src/AuthTests.cs'):
            self.assertIsNotNone(pattern.search(name), name)
        for name in ('Contest.java', 'Manifest.cs', 'src/AuthTEST.java', 'src/app.ts'):
            self.assertIsNone(pattern.search(name), name)

    def test_reddit_memo_constructs_three_element_success_and_failure_entries(self):
        path = ROOT / 'last30days/last30days/scripts/lib/reddit.py'
        for fail in (False, True):
            calls = []
            failures = []
            @contextlib.contextmanager
            def tee():
                yield []
            def search(*args, **kwargs):
                calls.append(True)
                if fail:
                    raise ValueError('fixture failure')
                return {'items': [{'title': 'fixture'}]}
            scope = functions(path, ['_sc_memo_outcome', 'search_and_enrich_memo'], {
                'copy': copy, 'threading': threading, '_SC_MEMO': {}, '_SC_INFLIGHT': {},
                '_SC_MEMO_LOCK': threading.Lock(), 'search_and_enrich': search,
                'http': types.SimpleNamespace(tee_failures=tee, _record_failure=failures.append),
            })
            for replay in range(2):
                if fail:
                    with self.assertRaisesRegex(ValueError, 'fixture failure'):
                        scope['search_and_enrich_memo']('topic', 'start', 'end')
                else:
                    self.assertEqual(scope['search_and_enrich_memo']('topic', 'start', 'end'), {'items': [{'title': 'fixture'}]})
            self.assertEqual(len(calls), 1)
            self.assertEqual(len(next(iter(scope['_SC_MEMO'].values()))), 3)


if __name__ == '__main__':
    unittest.main()

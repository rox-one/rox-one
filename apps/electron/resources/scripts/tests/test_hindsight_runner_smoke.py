"""Smoke tests for the hindsight_runner CLI.

Run manually:
    cd /Users/t/Projects/rox-one
    python3 -m unittest apps.electron.resources.scripts.tests.test_hindsight_runner_smoke
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from ._tool_test_harness import build_env, run_tool


class HindsightRunnerSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.env = build_env()
        cls.tmpdir_obj = tempfile.TemporaryDirectory(prefix="hindsight-runner-smoke-")
        cls.tmpdir = Path(cls.tmpdir_obj.name)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmpdir_obj.cleanup()

    def run_hindsight(self, *args: str):
        return run_tool("hindsight", *args, env=self.env)

    def write_synthetic_profile(self, name: str) -> Path:
        """Minimal Chromium-shaped profile: enough for Hindsight to run and exit 0.

        The schema is intentionally tiny — the assertions below cover argument
        parsing and receipt shape, not forensic correctness.
        """
        root = self.tmpdir / name
        default = root / "Default"
        default.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(str(default / "History"))
        con.executescript(
            """
            CREATE TABLE urls(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR,
                visit_count INTEGER DEFAULT 0, typed_count INTEGER DEFAULT 0,
                last_visit_time INTEGER, hidden INTEGER DEFAULT 0);
            CREATE TABLE visits(id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER,
                from_visit INTEGER, transition INTEGER DEFAULT 0, segment_id INTEGER,
                visit_duration INTEGER);
            CREATE TABLE visit_source(id INTEGER PRIMARY KEY, source INTEGER);
            CREATE TABLE downloads(id INTEGER PRIMARY KEY, guid VARCHAR, current_path LONGVARCHAR,
                target_path LONGVARCHAR, start_time INTEGER, received_bytes INTEGER,
                total_bytes INTEGER, state INTEGER);
            CREATE TABLE downloads_url_chains(id INTEGER, chain_index INTEGER, url LONGVARCHAR);
            CREATE TABLE keyword_search_terms(keyword_id INTEGER, url_id INTEGER,
                lower_term LONGVARCHAR, term LONGVARCHAR);
            CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
            INSERT INTO meta VALUES ('version', '60'), ('last_compatible_version', '16');
            INSERT INTO urls VALUES (1, 'https://example.com/', 'Example', 2, 1, 13330000000000000, 0);
            INSERT INTO visits VALUES (1, 1, 13330000000000000, 0, 805306368, 1, 5000000),
                                      (2, 1, 13330000001000000, 0, 805306368, 1, 3000000);
            INSERT INTO visit_source VALUES (1, 0), (2, 0);
            """
        )
        con.commit()
        con.close()
        return root

    def test_check_reports_resolution(self) -> None:
        result = self.run_hindsight("--check")
        # The runner needs network on first use to build its PEP 723 environment;
        # skip cleanly so the suite stays green offline.
        if result.returncode != 0:
            self.skipTest(f"hindsight unavailable: {result.stderr.strip()}")

        payload = json.loads(result.stdout)
        self.assertTrue(payload.get("ok"))
        self.assertIn("hindsight", payload)

    def test_help_mentions_input(self) -> None:
        result = self.run_hindsight("--help")
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("--input", result.stdout)

    def test_missing_input_fails(self) -> None:
        result = self.run_hindsight("--output", str(self.tmpdir / "out"))
        self.assertNotEqual(result.returncode, 0)

    def test_native_argv_shape_produces_receipt(self) -> None:
        # Reproduces the TypeScript runner's argv exactly; native short flags
        # must parse (regression: `Error: No such option '-i'`).
        profile = self.write_synthetic_profile("ts-shape-profile")
        base = self.tmpdir / "ts-shape-out"
        result = self.run_hindsight("-i", str(profile), "-o", str(base), "-f", "sqlite", "--nocopy")
        self.assertNotIn("No such option", result.stderr)
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload.get("ok"))
        self.assertTrue(payload.get("output", "").endswith(".sqlite"))


if __name__ == "__main__":
    unittest.main()
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(frames):
    env = dict(os.environ, ROX_COGNEE_FAKE_BACKEND="1", PYTHONPATH=HERE)
    p = subprocess.run(
        [sys.executable, "-m", "rox_cognee_sidecar"],
        input="".join(json.dumps(f) + "\n" if not isinstance(f, str) else f for f in frames),
        capture_output=True, text=True, env=env, timeout=30,
    )
    assert p.returncode == 0, p.stderr
    return {r.get("id"): r for r in map(json.loads, p.stdout.splitlines())}


PROV = {"originClass": "owner", "sessionKind": "interactive", "observedAt": "2026-10-14T00:00:00Z"}


class ProtocolTest(unittest.TestCase):
    def test_roundtrip(self):
        out = run([
            {"id": 1, "method": "hello"},
            {"id": 2, "method": "add", "params": {"docs": [
                {"id": "n1", "source": "notes", "text": "Deploys run on Buildkite", "provenance": PROV},
                {"id": "u1", "source": "mail", "text": "Buildkite phishing", "provenance": {**PROV, "originClass": "untrusted"}},
            ]}},
        ])
        self.assertEqual(out[1]["result"]["protocol"], 1)
        self.assertEqual(out[2]["result"]["added"], 1)  # untrusted dropped

    def test_search_validation_and_errors(self):
        out = run([
            {"id": 1, "method": "search", "params": {"query": ""}},
            {"id": 2, "method": "search", "params": {"query": "x", "mode": "cypher"}},
            {"id": 3, "method": "search", "params": {"query": "x", "limit": 999}},
            {"id": 4, "method": "nope"},
            "not json\n",
            {"id": 5, "method": "add", "params": {"docs": [{"id": "a", "source": "evil", "text": "t"}]}},
        ])
        for i in (1, 2, 3, 5):
            self.assertEqual(out[i]["error"]["code"], "bad_params")
        self.assertEqual(out[4]["error"]["code"], "unknown_method")
        self.assertEqual(out[None]["error"]["code"], "bad_json")

    def test_shutdown_and_eof(self):
        out = run([{"id": 1, "method": "shutdown"}, {"id": 2, "method": "hello"}])
        self.assertTrue(out[1]["result"]["ok"])

    def test_config_requires_root_and_hides_key(self):
        sys.path.insert(0, HERE)
        from rox_cognee_sidecar.config import SidecarConfig
        with self.assertRaises(ValueError):
            SidecarConfig.from_env({})
        cfg = SidecarConfig.from_env({"ROX_COGNEE_ROOT": "/tmp/x", "ROX_COGNEE_LLM_API_KEY": "sekret"})
        self.assertNotIn("sekret", repr(cfg))
        env = cfg.cognee_env()
        self.assertEqual(env["LLM_PROVIDER"], "custom")
        self.assertEqual(env["EMBEDDING_PROVIDER"], "fastembed")
        self.assertTrue(env["SYSTEM_ROOT_DIRECTORY"].startswith("/tmp/x"))


if __name__ == "__main__":
    unittest.main()

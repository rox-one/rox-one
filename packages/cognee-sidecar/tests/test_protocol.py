import asyncio
import io
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
        self.assertEqual(out[2]["result"]["truncated"], 0)

    def test_search_validation_and_errors(self):
        out = run([
            {"id": 1, "method": "search", "params": {"query": ""}},
            {"id": 2, "method": "search", "params": {"query": "x", "mode": "cypher"}},
            {"id": 3, "method": "search", "params": {"query": "x", "limit": 999}},
            {"id": 4, "method": "nope"},
            "not json\n",
            {"id": 5, "method": "add", "params": {"docs": [{"id": "a", "source": "evil", "text": "t"}]}},
            {"id": 6, "method": "add", "params": {"docs": [{"id": "a", "source": "notes", "text": "t", "provenance": "owner"}]}},
        ])
        for i in (1, 2, 3, 5, 6):
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

    def test_add_reports_truncation(self):
        sys.path.insert(0, HERE)
        from rox_cognee_sidecar.server import MAX_DOC_CHARS
        long_text = "x" * (MAX_DOC_CHARS + 50)
        out = run([
            {"id": 1, "method": "add", "params": {"docs": [
                {"id": "big", "source": "notes", "text": long_text, "provenance": PROV},
            ]}},
        ])
        self.assertEqual(out[1]["result"]["added"], 1)
        self.assertEqual(out[1]["result"]["truncated"], 1)


class OversizedFrameTest(unittest.TestCase):
    def test_oversized_frame_drains_and_next_frame_ok(self):
        """Partial oversized chunk must not desync subsequent JSON-RPC frames."""
        sys.path.insert(0, HERE)
        from rox_cognee_sidecar.fake_backend import FakeBackend
        from rox_cognee_sidecar.server import MAX_LINE_BYTES, serve

        # Simulate readline(limit): first return MAX+1 bytes without newline,
        # then the remainder of that line (with newline), then a valid hello.
        rem = b'{"pad":true}\n'
        hello = (json.dumps({"id": 7, "method": "hello"}) + "\n").encode("utf-8")
        chunks = [
            b"x" * (MAX_LINE_BYTES + 1),  # partial oversized, no \\n
            rem,
            hello,
            b"",  # EOF
        ]
        idx = {"i": 0}

        async def read_line() -> bytes:
            i = idx["i"]
            idx["i"] = i + 1
            return chunks[i] if i < len(chunks) else b""

        buf = io.BytesIO()

        async def run_serve():
            await serve(FakeBackend(), read_line, out=buf)

        asyncio.run(run_serve())
        frames = [json.loads(line) for line in buf.getvalue().decode("utf-8").splitlines()]
        self.assertEqual(frames[0]["error"]["code"], "too_large")
        self.assertEqual(frames[1]["id"], 7)
        self.assertEqual(frames[1]["result"]["name"], "rox-cognee-sidecar")
        self.assertEqual(len(frames), 2)


class LlmErrorClassifyTest(unittest.TestCase):
    def test_is_llm_error_prefers_type_and_status(self):
        sys.path.insert(0, HERE)
        from rox_cognee_sidecar.cognee_backend import _is_llm_error

        class APITimeoutError(Exception):
            pass

        class APIStatusError(Exception):
            def __init__(self, status_code):
                self.status_code = status_code

        class LocalBoom(Exception):
            pass

        self.assertTrue(_is_llm_error(APITimeoutError("whatever")))
        self.assertTrue(_is_llm_error(APIStatusError(502)))
        self.assertTrue(_is_llm_error(TimeoutError()))
        # Free-text "502" / "timeout" in an unrelated error must NOT match.
        self.assertFalse(_is_llm_error(LocalBoom("embedding download timeout after 502")))
        self.assertFalse(_is_llm_error(ValueError("llm config missing")))


if __name__ == "__main__":
    unittest.main()

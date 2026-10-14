#!/usr/bin/env python3
"""Electron handshake probe for the Cookbooks Lab sidecar.

Spawns the loopback host the way Electron main does — `serve_lab.py` on an
ephemeral port — reads the startup URL line (the port-discovery contract),
proves the bearer-token gate over HTTP, then stops the host with SIGINT and
checks it exited cleanly.

What it asserts (all observed behavior; no product code is imported):

  1. the sidecar prints one `http://127.0.0.1:<port>/lab.html?token=…` line at
     startup (`scripts/serve_lab.py:25-26`) — that line *is* the discovery
     protocol; the port is whatever the OS handed out;
  2. the page is served WITHOUT a token: `GET /lab.html` -> 200 (only the Host
     header is checked, `src/rox_cookbooks/host.py:167-174`; docstring `:1-6`);
  3. every JSON route is token-gated (`_ok_auth`, `src/rox_cookbooks/host.py:93-98`;
     `:175-176`, `:210-212`): `GET /catalog` without a token -> 401, with a
     wrong token -> 401, with the token -> 200;
  4. both token transports work: `Authorization: Bearer <t>` and `?token=<t>`;
  5. the response carries the framing/caching headers the sidebar contract
     depends on — `X-Frame-Options: DENY`, `Cache-Control: no-store`,
     `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
     (`src/rox_cookbooks/host.py:117-123`);
  6. SIGINT stops the host with exit code 0 (`scripts/serve_lab.py:27-32` ->
     `LabHost.stop`, `src/rox_cookbooks/host.py:395-400`).

Exit status: 0 when every check passes, 1 otherwise.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
from http.client import HTTPConnection
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SERVE_LAB = ROOT / "scripts" / "serve_lab.py"

# The startup line, e.g. http://127.0.0.1:52231/lab.html?token=Ab3...
URL_LINE = re.compile(r"(http://127\.0\.0\.1:(\d+)/lab\.html\?token=\S+)")
STARTUP_TIMEOUT = 30.0
SHUTDOWN_TIMEOUT = 15.0
HTTP_TIMEOUT = 10.0

_HEADER_MARKERS = (
    "X-Frame-Options",
    "Cache-Control",
    "X-Content-Type-Options",
    "Referrer-Policy",
)


class Checks:
    """Collects PASS/FAIL lines and counts the failures."""

    def __init__(self) -> None:
        self.failures = 0

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        suffix = f" — {detail}" if detail else ""
        print(f"[{'PASS' if ok else 'FAIL'}] {name}{suffix}")
        if not ok:
            self.failures += 1
        return ok


def pump_lines(stream, sink: list) -> None:
    """Drain ``stream`` on a daemon thread so no read can block the probe."""

    def run() -> None:
        try:
            for line in stream:
                sink.append(line)
        except (OSError, ValueError):  # stream closed under us
            pass

    threading.Thread(target=run, daemon=True).start()


def wait_for_line(lines: list, proc: subprocess.Popen, timeout: float) -> str | None:
    """First line collected by ``pump_lines``, or ``None`` if none arrived."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if lines:
            return lines[0].strip()
        if proc.poll() is not None:
            return None
        time.sleep(0.05)
    return None


def http_get(port: int, path: str, token: str | None = None) -> tuple:
    """One loopback GET; returns ``(status, lowercased headers, body)``."""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    conn = HTTPConnection("127.0.0.1", port, timeout=HTTP_TIMEOUT)
    try:
        conn.request("GET", path, headers=headers)
        response = conn.getresponse()
        return (
            response.status,
            {key.lower(): value for key, value in response.getheaders()},
            response.read(),
        )
    finally:
        conn.close()


def parse_json_array(status: int, body: bytes):
    if status != 200:
        return None
    try:
        parsed = json.loads(body.decode("utf-8"))
    except ValueError:
        return None
    return parsed if isinstance(parsed, list) and parsed else None


def run_checks(checks: Checks, port: int, token: str) -> None:
    # 1. The page itself is public: only the Host header is checked, no token.
    status, _headers, body = http_get(port, "/lab.html")
    checks.check(
        "GET /lab.html without token -> 200 (page is not token-gated)",
        status == 200,
        f"status={status}",
    )
    checks.check("lab document served", b"ROX Cookbooks Lab" in body, f"{len(body)} bytes")

    status, _headers, _body = http_get(port, f"/lab.html?token={token}")
    checks.check("GET /lab.html?token=<token> -> 200", status == 200, f"status={status}")

    # 2. Every JSON route is token-gated (_ok_auth, host.py:93-98).
    status, _headers, _body = http_get(port, "/catalog")
    checks.check("GET /catalog without token -> 401", status == 401, f"status={status}")

    status, _headers, _body = http_get(port, "/catalog", token="not-the-real-token")
    checks.check("GET /catalog with wrong token -> 401", status == 401, f"status={status}")

    status, _headers, body = http_get(port, "/catalog", token=token)
    cards = parse_json_array(status, body)
    checks.check(
        "GET /catalog with Authorization: Bearer <token> -> 200 JSON array",
        cards is not None,
        f"status={status} items={len(cards) if cards is not None else 'n/a'}",
    )

    # The query transport is the one the page itself uses (lab.html:47).
    status, _headers, body = http_get(port, f"/catalog?token={token}")
    cards = parse_json_array(status, body)
    checks.check(
        "GET /catalog?token=<token> -> 200 JSON array",
        cards is not None,
        f"status={status} items={len(cards) if cards is not None else 'n/a'}",
    )

    status, headers, _body = http_get(port, "/lab.html")
    checks.check(
        "framing/cache security headers present",
        status == 200
        and headers.get("x-frame-options") == "DENY"
        and headers.get("cache-control") == "no-store"
        and headers.get("x-content-type-options") == "nosniff"
        and headers.get("referrer-policy") == "no-referrer",
        ", ".join(f"{name}={headers.get(name.lower())}" for name in _HEADER_MARKERS),
    )

    status, _headers, _body = http_get(port, "/nope", token=token)
    checks.check("unknown route -> 404", status == 404, f"status={status}")


def finish(checks: Checks, proc, err_lines: list, tmp) -> int:
    """Stop the sidecar if it is still up, print diagnostics, return the code."""
    if proc is not None and proc.poll() is None:
        proc.kill()
        proc.wait(timeout=SHUTDOWN_TIMEOUT)
    if checks.failures and err_lines:
        print("[INFO] sidecar stderr:", file=sys.stderr)
        print("".join(err_lines[-40:]).rstrip(), file=sys.stderr)
    print(f"[SUMMARY] {checks.failures} failed")
    if tmp is not None:
        tmp.cleanup()
    return 1 if checks.failures else 0


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description="Electron handshake probe for the Cookbooks Lab sidecar.")
    parser.add_argument(
        "--workspace",
        default=None,
        help="workspace for the probe run (default: a fresh temp directory)",
    )
    parser.add_argument(
        "--serve-lab",
        default=str(SERVE_LAB),
        help="sidecar entry point to spawn (default: scripts/serve_lab.py)",
    )
    args = parser.parse_args(argv)

    entry = Path(args.serve_lab).resolve()
    checks = Checks()
    if not entry.is_file():
        checks.check("sidecar entry point exists", False, str(entry))
        return finish(checks, None, [], None)

    tmp = None
    if args.workspace:
        workspace = Path(args.workspace).expanduser().resolve()
        workspace.mkdir(parents=True, exist_ok=True)
    else:
        tmp = tempfile.TemporaryDirectory(prefix="rox-lab-probe-")
        workspace = Path(tmp.name)

    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"  # the URL line must flush before we read it
    proc = subprocess.Popen(
        [sys.executable, "-u", str(entry), "--workspace", str(workspace)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        cwd=str(entry.parent),
    )
    print(f"[INFO] spawned {sys.executable} {entry} --workspace {workspace} (pid {proc.pid})")

    out_lines: list = []
    err_lines: list = []
    pump_lines(proc.stdout, out_lines)
    pump_lines(proc.stderr, err_lines)

    try:
        line = wait_for_line(out_lines, proc, STARTUP_TIMEOUT)
        match = URL_LINE.search(line or "")
        if not checks.check(
            "sidecar prints its loopback URL at startup",
            match is not None,
            f"first stdout line: {line!r}",
        ):
            return finish(checks, proc, err_lines, tmp)

        url = match.group(1)
        port = int(match.group(2))
        token = parse_qs(urlsplit(url).query).get("token", [""])[0]
        if not checks.check(
            "startup URL carries a token", bool(token), f"port={port} path=/lab.html"
        ):
            return finish(checks, proc, err_lines, tmp)

        run_checks(checks, port, token)

        proc.send_signal(signal.SIGINT)
        try:
            returncode = proc.wait(timeout=SHUTDOWN_TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            returncode = None
        checks.check(
            "SIGINT stops the host cleanly (exit 0)", returncode == 0, f"exit code={returncode}"
        )
        return finish(checks, proc, err_lines, tmp)
    except BaseException:
        proc.kill()
        proc.wait()
        raise


if __name__ == "__main__":
    raise SystemExit(main())

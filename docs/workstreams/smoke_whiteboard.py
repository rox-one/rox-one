#!/usr/bin/env python3
"""Smoke test for the served Rox workstream whiteboard.

Starts serve_whiteboard.py on a free local port, checks the shell page, the data
files and the app assets, then stops the server. Standard library only.
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "serve_whiteboard.py"
PORT = 0
BASE_URL = ""
START_TIMEOUT = 15.0

REQUIRED_IDS = (
    "app",
    "topbar",
    "search",
    "division-filter",
    "wave-filter",
    "status-filter",
    "fit",
    "zoom-out",
    "zoom-label",
    "zoom-in",
    "rail",
    "rail-list",
    "rail-toggle",
    "minimap",
    "toggle-layers",
    "layers",
    "toggle-structure",
    "toggle-dependencies",
    "toggle-handoffs",
    "toggle-market",
    "toggle-labels",
    "lock",
    "reset",
    "download",
    "print",
    "help",
    "stage",
    "world",
    "edges",
    "nodes",
    "legend",
    "statusbar",
    "count-label",
    "hint",
    "details",
    "details-close",
    "details-body",
    "toast",
    "help-overlay",
)

EXPECTED_COUNTS = {
    "divisions": 10,
    "groups": 30,
    "tasks": 60,
    "parked": 14,
    "guilds": 7,
    "interfaces": 10,
    "anchorLinks": 12,
}


class SmokeError(Exception):
    """A check failed with a message meant for the person running the test."""


class IdCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name == "id" and value:
                self.ids.add(value)


def http_get(path: str, timeout: float = 5.0):
    """Return (status, headers, body) for a GET against the local server."""
    url = BASE_URL + path
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        raise SmokeError(f"{path}: HTTP {exc.code} {exc.reason}") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise SmokeError(f"{path}: request failed ({exc})") from exc


def wait_for_page(proc: subprocess.Popen[str]):
    deadline = time.monotonic() + START_TIMEOUT
    startup_error: Exception | None = None
    while time.monotonic() < deadline:
        code = proc.poll()
        if code is not None:
            output = proc.stdout.read() if proc.stdout else ""
            raise SmokeError(
                f"server exited during startup with code {code}"
                + (f"\n--- server output ---\n{output.rstrip()}" if output.strip() else "")
            )
        try:
            return http_get("/whiteboard.html", timeout=1.0)
        except SmokeError as exc:
            startup_error = exc
            time.sleep(0.15)
    raise SmokeError(
        f"/whiteboard.html did not become available within {START_TIMEOUT:.0f}s "
        f"({startup_error})"
    )


def collect_ids(html: str) -> set[str]:
    parser = IdCollector()
    parser.feed(html)
    parser.close()
    return parser.ids


def check_required_ids(html: str) -> set[str]:
    found = collect_ids(html)
    missing = [node_id for node_id in REQUIRED_IDS if node_id not in found]
    if missing:
        raise SmokeError(
            "whiteboard.html is missing required DOM ids: " + ", ".join(missing)
        )
    return found


def require_no_store(headers, path: str) -> None:
    value = (headers.get("Cache-Control") or "").strip().lower()
    if value != "no-store":
        raise SmokeError(
            f"{path}: expected 'Cache-Control: no-store', got {value or '<missing>'!r}"
        )


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def load_json(path: str):
    status, _headers, body = http_get(path)
    if status != 200:
        raise SmokeError(f"{path}: expected HTTP 200, got {status}")
    if not body:
        raise SmokeError(f"{path}: empty response body")
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SmokeError(f"{path}: invalid JSON ({exc})") from exc


def check_task_board() -> tuple[int, int, int, int, int, int, int]:
    board = load_json("/task-board-v2.json")
    if not isinstance(board, dict):
        raise SmokeError("task-board-v2.json: top-level value is not an object")

    divisions = board.get("divisions")
    tasks = board.get("tasks")
    parked = board.get("parked")
    guilds = board.get("guilds")
    interfaces = board.get("interfaces")
    anchor_links = board.get("anchorLinks")
    for key, value in (
        ("divisions", divisions),
        ("tasks", tasks),
        ("parked", parked),
        ("guilds", guilds),
        ("interfaces", interfaces),
        ("anchorLinks", anchor_links),
    ):
        if not isinstance(value, list):
            raise SmokeError(
                f"task-board-v2.json: field '{key}' is missing or not a list"
            )

    groups = 0
    for index, division in enumerate(divisions):
        if not isinstance(division, dict):
            raise SmokeError(f"task-board-v2.json: divisions[{index}] is not an object")
        names = division.get("groups")
        if not isinstance(names, list):
            raise SmokeError(
                f"task-board-v2.json: divisions[{index}].groups is missing or not a list"
            )
        groups += len(names)

    actual = {
        "divisions": len(divisions),
        "groups": groups,
        "tasks": len(tasks),
        "parked": len(parked),
        "guilds": len(guilds),
        "interfaces": len(interfaces),
        "anchorLinks": len(anchor_links),
    }
    wrong = [
        f"{key} is {actual[key]}, expected {expected}"
        for key, expected in EXPECTED_COUNTS.items()
        if actual[key] != expected
    ]
    if wrong:
        raise SmokeError("task-board-v2.json: " + "; ".join(wrong))

    return (
        actual["divisions"],
        actual["groups"],
        actual["tasks"],
        actual["parked"],
        actual["guilds"],
        actual["interfaces"],
        actual["anchorLinks"],
    )


def check_open_roles() -> int:
    data = load_json("/open-roles-summary-20261122.json")
    if not isinstance(data, dict):
        raise SmokeError(
            "open-roles-summary-20261122.json: top-level value is not an object"
        )
    companies = data.get("companies")
    if not isinstance(companies, dict) or not companies:
        raise SmokeError(
            "open-roles-summary-20261122.json: field 'companies' is missing or empty"
        )
    for name, entry in companies.items():
        if not isinstance(entry, dict):
            raise SmokeError(
                f"open-roles-summary-20261122.json: companies[{name!r}] is not an object"
            )
        if not isinstance(entry.get("total"), int):
            raise SmokeError(
                f"open-roles-summary-20261122.json: companies[{name!r}].total is missing"
            )
    return len(companies)


def check_asset(path: str, content_type_prefix: str) -> int:
    status, headers, body = http_get(path)
    if status != 200:
        raise SmokeError(f"{path}: expected HTTP 200, got {status}")
    if not body:
        raise SmokeError(f"{path}: served empty file")
    content_type = (headers.get("Content-Type") or "").lower()
    if not content_type.startswith(content_type_prefix):
        raise SmokeError(
            f"{path}: expected Content-Type {content_type_prefix}*, got "
            f"{content_type or '<missing>'!r}"
        )
    require_no_store(headers, path)
    head = body[:200].lower()
    if b"<!doctype html" in head or b"<html" in head:
        raise SmokeError(f"{path}: served an HTML error page instead of the asset")
    return len(body)


def stop_server(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def main() -> int:
    global PORT, BASE_URL
    PORT = free_port()
    BASE_URL = f"http://127.0.0.1:{PORT}"
    if not SERVER.is_file():
        print(f"FAIL: server script not found: {SERVER}", file=sys.stderr)
        return 1

    proc = subprocess.Popen(
        [sys.executable, str(SERVER), "--port", str(PORT), "--no-open"],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        _status, headers, body = wait_for_page(proc)
        if not body:
            raise SmokeError("/whiteboard.html: empty response body")
        require_no_store(headers, "/whiteboard.html")

        html = body.decode("utf-8", "replace")
        found_ids = check_required_ids(html)

        key_headers = http_get("/task-board-v2.json")[1]
        require_no_store(key_headers, "/task-board-v2.json")

        divisions, groups, tasks, parked, guilds, interfaces, anchors = check_task_board()
        companies = check_open_roles()

        css_bytes = check_asset("/whiteboard.css", "text/css")
        js_bytes = check_asset("/whiteboard.js", "text/javascript")
    except SmokeError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    finally:
        stop_server(proc)
        if proc.stdout is not None:
            proc.stdout.close()

    print(
        "PASS: whiteboard served on 127.0.0.1:%d — "
        "%d required ids, %d divisions, %d groups, %d tasks, %d parked, "
        "%d guilds, %d interfaces, %d anchor links, %d companies, css %d B, js %d B"
        % (
            PORT,
            len(found_ids),
            divisions,
            groups,
            tasks,
            parked,
            guilds,
            interfaces,
            anchors,
            companies,
            css_bytes,
            js_bytes,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

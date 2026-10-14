"""Loopback JSON host for the Cookbooks Lab (Electron-shaped API).

Binds 127.0.0.1 only. JSON APIs require Authorization: Bearer <token>
or ?token=. GET / and /lab.html are the local notebook surface (token in query).
Secret values never appear in JSON responses.
"""

from __future__ import annotations

import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import parse_qs, unquote, urlparse

from .catalog import CatalogError, load_catalog
from .copies import CookbookCopies, CopyError
from .kernel import ActiveRuns, KernelError, RunHandle, execute_all, execute_code
from .notebooks import Notebook, NotebookError, Playbook, load_notebook, source_text
from .search import search_items
from .secrets import env_for_item, missing_secrets
from .ui import catalog_cards, load_store

STATIC = Path(__file__).resolve().parent / "static" / "lab.html"

# A Lab payload is a cell's source plus a small store, never megabytes, so the
# host refuses anything larger before it reads the body.
MAX_BODY_BYTES = 2 * 1024 * 1024

# Plan 016: one Run all request runs its cells sequentially in a single child
# process, so the cell count is capped here before any copy is touched.
MAX_RUN_ALL_CELLS = 100

# DNS-rebinding guard: the Lab binds loopback only (see ``LabHost.start``), so a
# Host header naming anything else is a browser trick, not a legitimate client.
ALLOWED_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "[::1]"})


class _BodyError(Exception):
    """A rejected request body, carrying the HTTP status to answer with."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def parse_index(value: Any) -> int | None:
    """A cell ``index`` as an int, accepting only ``int`` or a digit-string.

    Returns ``None`` for anything else (float, ``True``/``False``, ``"x"``, ...)
    so handlers answer 400 instead of raising inside the request thread.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


class LabHost:
    def __init__(
        self,
        workspace: Path,
        catalog_root: Path | None = None,
        token: str | None = None,
        store: Mapping[str, str] | None = None,
        store_path: Path | None = None,
    ):
        self.catalog = load_catalog(catalog_root)
        self.copies = CookbookCopies(Path(workspace), self.catalog)
        self.token = token or secrets.token_urlsafe(24)
        self.store: dict[str, str] = dict(store or {})
        if store_path is not None:
            loaded = load_store(store_path) or {}
            self.store.update(loaded)
        self.httpd: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None
        # In-flight executions keyed by itemId, so POST /cancel can kill them and
        # stop() can leave no orphaned cell processes (spec wave 9).
        self.runs = ActiveRuns()

    @property
    def url(self) -> str:
        if not self.httpd:
            raise RuntimeError("not started")
        host, port = self.httpd.server_address[:2]
        return f"http://{host}:{port}"

    def start(self) -> str:
        lab = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                return

            def _ok_auth(self) -> bool:
                q = parse_qs(urlparse(self.path).query)
                if q.get("token", [None])[0] == lab.token:
                    return True
                auth = self.headers.get("Authorization", "")
                return auth == f"Bearer {lab.token}"

            def _host_allowed(self) -> bool:
                """Whether the Host header names this loopback server.

                The port (if any) is stripped and the value lowercased; bare
                IPv6 forms (``::1``) are kept intact, bracketed ones (``[::1]``)
                reduce to the bracketed literal. An absent Host is refused: only
                loopback clients may talk to the Lab.
                """
                raw = (self.headers.get("Host") or "").strip().lower()
                if raw.startswith("["):
                    name = raw.split("]", 1)[0] + "]"
                elif raw.count(":") == 1:
                    name = raw.split(":", 1)[0]
                else:
                    name = raw
                return name in ALLOWED_HOSTS

            def _security_headers(self) -> None:
                # No Content-Security-Policy: the Lab page is a single file with
                # an inline <script>, so a CSP here would break it.
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")

            def _read_json(self) -> dict[str, Any]:
                raw_length = self.headers.get("Content-Length")
                try:
                    n = int(raw_length) if raw_length else 0
                except (TypeError, ValueError):
                    raise _BodyError(400, "invalid Content-Length")
                if n > MAX_BODY_BYTES:
                    raise _BodyError(413, "request body too large")
                if n <= 0:
                    return {}
                raw = self.rfile.read(n)
                data = json.loads(raw.decode("utf-8") or "{}")
                if not isinstance(data, dict):
                    raise ValueError("JSON object required")
                return data

            @staticmethod
            def _item_id(body: Mapping[str, Any]) -> str | None:
                """``body["itemId"]`` as a non-empty string, or ``None`` when missing."""
                value = body.get("itemId")
                if value is None:
                    return None
                text = str(value)
                return text or None

            def _send(self, code: int, payload: Any) -> None:
                body = json.dumps(payload).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self._security_headers()
                self.end_headers()
                self.wfile.write(body)

            def _send_bytes(self, code: int, body: bytes, content_type: str) -> None:
                self.send_response(code)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self._security_headers()
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if not self._host_allowed():
                    return self._send(403, {"error": "forbidden host"})
                parsed = urlparse(self.path)
                path = parsed.path
                if path in ("/", "/lab.html"):
                    html = STATIC.read_bytes() if STATIC.is_file() else b"<p>lab.html missing</p>"
                    return self._send_bytes(200, html, "text/html; charset=utf-8")
                if not self._ok_auth():
                    return self._send(401, {"error": "unauthorized"})
                q = parse_qs(parsed.query)
                if path == "/catalog":
                    return self._send(200, catalog_cards(lab.catalog, lab.store))
                if path == "/search":
                    query = (q.get("q") or [""])[0]
                    items = search_items(lab.catalog, query)
                    cards = [
                        c
                        for c in catalog_cards(lab.catalog, lab.store)
                        if c["id"] in {i.id for i in items}
                    ]
                    return self._send(200, cards)
                if path.startswith("/banner/"):
                    item_id = unquote(path.split("/", 2)[-1])
                    try:
                        item = lab.catalog.item(item_id)
                        missing = missing_secrets(lab.catalog, item, lab.store)
                    except (CatalogError, CopyError) as exc:
                        return self._send(400, {"error": str(exc)})
                    return self._send(200, {"missing": missing})
                if path.startswith("/document/"):
                    item_id = unquote(path.split("/", 2)[-1])
                    try:
                        payload = lab.document_payload(item_id)
                    except NotebookError as exc:
                        return self._send(400, {"error": str(exc), "reset": True})
                    except (CatalogError, CopyError) as exc:
                        return self._send(400, {"error": str(exc)})
                    return self._send(200, payload)
                return self._send(404, {"error": "not found"})

            def do_POST(self):
                if not self._host_allowed():
                    return self._send(403, {"error": "forbidden host"})
                if not self._ok_auth():
                    return self._send(401, {"error": "unauthorized"})
                parsed = urlparse(self.path)
                try:
                    body = self._read_json()
                except _BodyError as exc:
                    return self._send(exc.status, {"error": str(exc)})
                except ValueError as exc:
                    return self._send(400, {"error": str(exc)})
                if parsed.path == "/open":
                    item_id = self._item_id(body)
                    if item_id is None:
                        return self._send(400, {"error": "missing itemId"})
                    if "newCopy" in body and not isinstance(body["newCopy"], bool):
                        return self._send(400, {"error": "newCopy must be a boolean"})
                    try:
                        copy = lab.copies.open(item_id, new_copy=body.get("newCopy") is True)
                    except (CopyError, CatalogError) as exc:
                        return self._send(400, {"error": str(exc)})
                    return self._send(200, {"copyId": copy.copy_id, "document": str(copy.document)})
                if parsed.path == "/run":
                    item_id = self._item_id(body)
                    if item_id is None:
                        return self._send(400, {"error": "missing itemId"})
                    code = body.get("code")
                    if not isinstance(code, str):
                        return self._send(400, {"error": "code must be a string"})
                    raw_store = body.get("store")
                    if "store" in body and not isinstance(raw_store, dict):
                        return self._send(400, {"error": "store must be an object"})
                    try:
                        item = lab.catalog.item(item_id)
                    except CatalogError as exc:
                        return self._send(400, {"error": str(exc)})
                    if not item.supported or item.kind != "ipynb":
                        return self._send(400, {"error": "no kernel for this item"})
                    try:
                        copy = lab.copies.open(item_id)
                    except (CopyError, CatalogError) as exc:
                        return self._send(400, {"error": str(exc)})
                    idx: int | None = None
                    raw_index = body.get("index")
                    if raw_index is not None and raw_index != "":
                        idx = parse_index(raw_index)
                        if idx is None:
                            return self._send(400, {"error": "index must be an integer"})
                        try:
                            nb = Notebook.open(copy)
                        except NotebookError as exc:
                            return self._send(400, {"error": str(exc)})
                        if not 0 <= idx < len(nb.cells):
                            return self._send(400, {"error": "cell index out of range"})
                        if nb.cell_type(idx) != "code":
                            return self._send(400, {"error": "cell is not runnable"})
                        # Persist the edited source BEFORE executing so
                        # persist_code_output updates this cell in place instead
                        # of appending a duplicate.
                        try:
                            nb.set_code(idx, code)
                            nb.save()
                        except NotebookError as exc:
                            return self._send(400, {"error": str(exc)})
                    store = dict(lab.store)
                    if raw_store:
                        store.update(raw_store)
                    env = env_for_item(lab.catalog, item, store)
                    # Register before executing so a concurrent POST /cancel can
                    # kill this run; released in `finally` however it ends.
                    run = lab.runs.register(item_id, RunHandle())
                    try:
                        result = execute_code(
                            copy,
                            code,
                            env=env,
                            catalog=lab.catalog,
                            item=item,
                            store=store,
                            index=idx,
                            run=run,
                        )
                    except (NotebookError, CopyError, KernelError) as exc:
                        return self._send(400, {"error": str(exc)})
                    finally:
                        lab.runs.release(item_id, run)
                    safe = {
                        k: result[k]
                        for k in ("ok", "stdout", "stderr", "returncode", "error", "timed_out")
                        if k in result
                    }
                    safe["missing"] = missing_secrets(lab.catalog, item, store)
                    safe["cancelled"] = run.cancelled
                    return self._send(200, safe)
                if parsed.path == "/run-all":
                    item_id = self._item_id(body)
                    if item_id is None:
                        return self._send(400, {"error": "missing itemId"})
                    try:
                        item = lab.catalog.item(item_id)
                    except CatalogError as exc:
                        return self._send(400, {"error": str(exc)})
                    if not item.supported or item.kind != "ipynb":
                        return self._send(400, {"error": "no kernel for this item"})
                    raw_cells = body.get("cells")
                    if not isinstance(raw_cells, list) or not raw_cells:
                        return self._send(400, {"error": "cells must be a non-empty list"})
                    if len(raw_cells) > MAX_RUN_ALL_CELLS:
                        return self._send(400, {"error": "too many cells"})
                    entries: list[tuple[int, str]] = []
                    seen: set[int] = set()
                    for entry in raw_cells:
                        if not isinstance(entry, dict):
                            return self._send(400, {"error": "cell index must be an integer"})
                        idx = parse_index(entry.get("index"))
                        if idx is None:
                            return self._send(400, {"error": "cell index must be an integer"})
                        src = entry.get("source")
                        if not isinstance(src, str):
                            return self._send(400, {"error": "cell source must be a string"})
                        if idx in seen:
                            return self._send(400, {"error": "duplicate cell index"})
                        seen.add(idx)
                        entries.append((idx, src))
                    raw_store = body.get("store")
                    if "store" in body and not isinstance(raw_store, dict):
                        return self._send(400, {"error": "store must be an object"})
                    # Document order, not request order: cells run and are
                    # recorded by ascending index.
                    entries.sort(key=lambda pair: pair[0])
                    try:
                        copy = lab.copies.open(item_id)
                    except (CopyError, CatalogError) as exc:
                        return self._send(400, {"error": str(exc)})
                    try:
                        nb = Notebook.open(copy)
                        for idx, _src in entries:
                            if not 0 <= idx < len(nb.cells):
                                return self._send(400, {"error": "cell index out of range"})
                            if nb.cell_type(idx) != "code":
                                return self._send(400, {"error": "cell is not runnable"})
                        # Persist the edited sources with ONE save BEFORE
                        # executing, so persist_code_output updates these cells in
                        # place instead of appending duplicates (/run parity).
                        for idx, src in entries:
                            nb.set_code(idx, src)
                        nb.save()
                    except NotebookError as exc:
                        return self._send(400, {"error": str(exc)})
                    store = dict(lab.store)
                    if raw_store:
                        store.update(raw_store)
                    env = env_for_item(lab.catalog, item, store)
                    # Same registry as /run: a cancel kills this run too, and the
                    # records already written to results.json are kept.
                    run = lab.runs.register(item_id, RunHandle())
                    try:
                        result = execute_all(
                            copy,
                            entries,
                            env=env,
                            catalog=lab.catalog,
                            item=item,
                            store=store,
                            persist=True,
                            run=run,
                        )
                    except (NotebookError, CopyError, KernelError, CatalogError) as exc:
                        return self._send(400, {"error": str(exc)})
                    finally:
                        lab.runs.release(item_id, run)
                    safe = {k: result.get(k) for k in ("ok", "timed_out", "returncode")}
                    safe["missing"] = missing_secrets(lab.catalog, item, store)
                    safe["cancelled"] = run.cancelled
                    safe["cells"] = [
                        {
                            k: cell.get(k)
                            for k in (
                                "index",
                                "status",
                                "ok",
                                "stdout",
                                "stderr",
                                "error",
                                "timed_out",
                                "duration_ms",
                            )
                        }
                        for cell in result.get("cells") or []
                    ]
                    return self._send(200, safe)
                if parsed.path == "/cancel":
                    item_id = self._item_id(body)
                    if item_id is None:
                        return self._send(400, {"error": "missing itemId"})
                    try:
                        lab.catalog.item(item_id)
                    except CatalogError as exc:
                        # Unknown itemId is a bad address, like an unknown path.
                        return self._send(404, {"error": str(exc)})
                    # Idempotent: kills every live /run and /run-all for the item
                    # and answers 0 when nothing is running.
                    cancelled = lab.runs.cancel(item_id)
                    return self._send(200, {"ok": True, "cancelled": cancelled})
                if parsed.path == "/reset":
                    item_id = self._item_id(body)
                    if item_id is None:
                        return self._send(400, {"error": "missing itemId"})
                    if "confirm" in body and not isinstance(body["confirm"], bool):
                        return self._send(400, {"error": "confirm must be a boolean"})
                    try:
                        copy = lab.copies.open(item_id)
                        lab.copies.reset(copy, confirm=body.get("confirm") is True)
                    except (CopyError, CatalogError) as exc:
                        return self._send(400, {"error": str(exc)})
                    return self._send(200, {"ok": True})
                if parsed.path == "/save":
                    item_id = self._item_id(body)
                    if item_id is None:
                        return self._send(400, {"error": "missing itemId"})
                    try:
                        copy = lab.copies.open(item_id)
                    except (CopyError, CatalogError) as exc:
                        return self._send(400, {"error": str(exc)})
                    if copy.document.suffix == ".md":
                        text = body.get("text")
                        if not isinstance(text, str):
                            return self._send(400, {"error": "missing text"})
                        try:
                            Playbook.open(copy)
                            copy.document.write_text(text, encoding="utf-8")
                        except NotebookError as exc:
                            return self._send(400, {"error": str(exc)})
                        return self._send(200, {"ok": True})
                    idx = parse_index(body.get("index"))
                    if idx is None:
                        return self._send(400, {"error": "index must be an integer"})
                    src = body.get("source")
                    if not isinstance(src, str):
                        return self._send(400, {"error": "missing source"})
                    try:
                        nb = Notebook.open(copy)
                    except NotebookError as exc:
                        return self._send(400, {"error": str(exc)})
                    if not 0 <= idx < len(nb.cells):
                        return self._send(400, {"error": "cell index out of range"})
                    try:
                        if nb.cell_type(idx) == "markdown":
                            nb.set_markdown(idx, src)
                        else:
                            nb.set_code(idx, src)
                        nb.save()
                    except NotebookError as exc:
                        return self._send(400, {"error": str(exc)})
                    return self._send(200, {"ok": True})
                if parsed.path == "/store":
                    incoming = body.get("store")
                    if not isinstance(incoming, dict):
                        return self._send(400, {"error": "store object required"})
                    if not incoming:
                        return self._send(400, {"error": "store must not be empty"})
                    if not all(isinstance(value, str) for value in incoming.values()):
                        return self._send(400, {"error": "store values must be strings"})
                    lab.store = {str(key): value for key, value in incoming.items()}
                    return self._send(200, {"keys": list(lab.store.keys())})
                return self._send(404, {"error": "not found"})

        Handler.__qualname__ = "LabHostHandler"
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        return self.url

    def document_payload(self, item_id: str) -> dict[str, Any]:
        item = self.catalog.item(item_id)
        copy = self.copies.open(item_id)
        missing = missing_secrets(self.catalog, item, self.store)
        if item.kind == "md":
            return {
                "kind": "md",
                "title": item.title,
                "text": copy.document.read_text(encoding="utf-8"),
                "missing": missing,
                "supported": False,
            }
        data = load_notebook(copy.document)
        cells = []
        for cell in data.get("cells") or []:
            cells.append(
                {
                    "cell_type": cell.get("cell_type"),
                    "source": source_text(cell),
                    "outputs": cell.get("outputs") or [],
                }
            )
        return {
            "kind": "ipynb",
            "title": item.title,
            "cells": cells,
            "missing": missing,
            "supported": item.supported,
        }

    def stop(self) -> None:
        # Kill every in-flight execution first: cell processes start their own
        # session (start_new_session=True), so without this they survive the
        # sidecar shutdown and leak (spec wave 9, "stop leak").
        self.runs.cancel_all()
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
        if self.thread:
            self.thread.join(timeout=2)

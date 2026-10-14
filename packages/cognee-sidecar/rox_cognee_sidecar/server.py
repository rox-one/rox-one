"""Newline-delimited JSON-RPC over stdio.

Request:  {"id": 1, "method": "search", "params": {...}}
Response: {"id": 1, "result": ...} | {"id": 1, "error": {"code": str, "message": str}}

stdout carries protocol frames only; all logging goes to stderr. Requests are
handled concurrently (a long ``cognify`` never blocks ``search``), and frames
are written under a lock so responses never interleave.
"""
from __future__ import annotations

import asyncio
import json
import sys
from typing import Any, Awaitable, Callable, Protocol

from . import PROTOCOL_VERSION

# Worst case per add: 100 docs x 100k chars x 4 bytes (UTF-8) = 40 MB < 64 MiB.
MAX_LINE_BYTES = 64 * 1024 * 1024
MAX_DOC_CHARS = 100_000
MAX_DOCS_PER_ADD = 100
VALID_SOURCES = {"session", "notes", "tasks", "chats", "calls", "mail", "files", "lessons"}
VALID_MODES = {"chunks", "graph_completion", "insights"}


class RpcError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class Backend(Protocol):
    async def add(self, docs: list[dict[str, Any]]) -> dict[str, Any]: ...
    async def cognify(self, sources: list[str] | None) -> dict[str, Any]: ...
    async def search(self, query: str, mode: str, limit: int) -> list[dict[str, Any]]: ...
    async def delete(self, ids: list[str]) -> dict[str, Any]: ...
    async def status(self) -> dict[str, Any]: ...


def validate_docs(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or len(raw) > MAX_DOCS_PER_ADD:
        raise RpcError("bad_params", f"docs must be a list of at most {MAX_DOCS_PER_ADD}")
    out: list[dict[str, Any]] = []
    for d in raw:
        if not isinstance(d, dict):
            raise RpcError("bad_params", "doc must be an object")
        doc_id, source, text = d.get("id"), d.get("source"), d.get("text")
        prov = d.get("provenance")
        if prov is not None and not isinstance(prov, dict):
            raise RpcError("bad_params", "doc.provenance must be an object")
        origin = (prov or {}).get("originClass")
        if not isinstance(doc_id, str) or not doc_id or len(doc_id) > 512:
            raise RpcError("bad_params", "doc.id must be a non-empty string")
        if source not in VALID_SOURCES:
            raise RpcError("bad_params", "doc.source is not a known source")
        if not isinstance(text, str):
            raise RpcError("bad_params", "doc.text must be a string")
        # Defence in depth: the host gate already drops untrusted content.
        if origin == "untrusted":
            continue
        if not text.strip():
            continue
        out.append({"id": doc_id, "source": source, "text": text[:MAX_DOC_CHARS]})
    return out


class Server:
    def __init__(self, backend: Backend, out=None):
        self.backend = backend
        self.out = out or sys.stdout
        self._lock = asyncio.Lock()
        self._tasks: set[asyncio.Task[None]] = set()
        self.stopping = False

    async def _send(self, frame: dict[str, Any]) -> None:
        async with self._lock:
            self.out.write(json.dumps(frame, ensure_ascii=False) + "\n")
            self.out.flush()

    async def dispatch(self, method: str, params: dict[str, Any]) -> Any:
        if method == "hello":
            return {"protocol": PROTOCOL_VERSION, "name": "rox-cognee-sidecar"}
        if method == "status":
            return await self.backend.status()
        if method == "add":
            return await self.backend.add(validate_docs(params.get("docs")))
        if method == "cognify":
            sources = params.get("sources")
            if sources is not None and (not isinstance(sources, list) or not set(sources) <= VALID_SOURCES):
                raise RpcError("bad_params", "sources must be a list of known sources")
            return await self.backend.cognify(sources)
        if method == "search":
            query = params.get("query")
            mode = params.get("mode", "chunks")
            limit = params.get("limit", 8)
            if not isinstance(query, str) or not query.strip():
                raise RpcError("bad_params", "query must be a non-empty string")
            if mode not in VALID_MODES:
                raise RpcError("bad_params", "unknown search mode")
            if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 50:
                raise RpcError("bad_params", "limit must be 1..50")
            return await self.backend.search(query.strip()[:2000], mode, limit)
        if method == "delete":
            ids = params.get("ids")
            if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
                raise RpcError("bad_params", "ids must be a list of strings")
            return await self.backend.delete(ids)
        if method == "shutdown":
            self.stopping = True
            return {"ok": True}
        raise RpcError("unknown_method", f"unknown method {method!r}")

    async def handle_line(self, line: str) -> None:
        req_id: Any = None
        try:
            req = json.loads(line)
            if not isinstance(req, dict):
                raise RpcError("bad_request", "request must be an object")
            req_id = req.get("id")
            method = req.get("method")
            params = req.get("params") or {}
            if not isinstance(method, str) or not isinstance(params, dict):
                raise RpcError("bad_request", "method/params malformed")
            result = await self.dispatch(method, params)
            await self._send({"id": req_id, "result": result})
        except RpcError as e:
            await self._send({"id": req_id, "error": {"code": e.code, "message": e.message}})
        except json.JSONDecodeError:
            await self._send({"id": None, "error": {"code": "bad_json", "message": "invalid JSON"}})
        except Exception as e:  # never leak tracebacks / env into the frame
            print(f"[rox-cognee] {type(e).__name__} in request", file=sys.stderr)
            await self._send({"id": req_id, "error": {"code": "internal", "message": type(e).__name__}})

    def submit(self, line: str) -> None:
        t = asyncio.ensure_future(self.handle_line(line))
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    async def drain(self) -> None:
        if self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)


async def serve(backend: Backend, read_line: Callable[[], Awaitable[bytes]], out=None) -> None:
    server = Server(backend, out)
    while not server.stopping:
        raw = await read_line()
        if not raw:
            break  # parent closed stdin: exit
        if len(raw) > MAX_LINE_BYTES:
            await server._send({"id": None, "error": {"code": "too_large", "message": "frame too large"}})
            continue
        line = raw.decode("utf-8", errors="replace").strip()
        if line:
            server.submit(line)
            await asyncio.sleep(0)
    await server.drain()

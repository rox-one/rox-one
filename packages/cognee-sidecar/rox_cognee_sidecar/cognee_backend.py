"""Real backend over the cognee Python API (imported lazily, after env setup)."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from typing import Any

from .config import SidecarConfig

_MODE_TO_SEARCH_TYPE = {
    "chunks": "CHUNKS",
    "graph_completion": "GRAPH_COMPLETION",
    "insights": "GRAPH_SUMMARY_COMPLETION",
}

# Prefer typed signals over free-text substring matching on exception messages.
_LLM_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 529})
_LLM_EXC_NAMES = frozenset({
    "APIError",
    "APIConnectionError",
    "APITimeoutError",
    "APIStatusError",
    "RateLimitError",
    "InternalServerError",
    "ServiceUnavailableError",
    "Timeout",
    "TimeoutError",
    "ReadTimeout",
    "ConnectTimeout",
    "OpenAIError",
})


def doc_file_name(doc_id: str) -> str:
    return "rox-" + hashlib.sha256(doc_id.encode("utf-8")).hexdigest()[:32] + ".txt"


def dataset_for(source: str) -> str:
    return f"rox_{source}"


def _is_llm_error(err: BaseException) -> bool:
    """True when ``err`` looks like a provider/LLM transport failure worth retrying.

    Matches on exception type name and HTTP status code attributes (OpenAI/httpx
    style). Does not scan free-text exception messages for tokens like "502" or
    "timeout", which falsely trigger fallback on unrelated local failures.
    """
    if isinstance(err, (TimeoutError, asyncio.TimeoutError)):
        return True
    status = getattr(err, "status_code", None)
    if status is None:
        status = getattr(err, "status", None)
    if isinstance(status, int) and status in _LLM_STATUS_CODES:
        return True
    resp = getattr(err, "response", None)
    if resp is not None:
        sc = getattr(resp, "status_code", None)
        if isinstance(sc, int) and sc in _LLM_STATUS_CODES:
            return True
    name = type(err).__name__
    if name in _LLM_EXC_NAMES or name.endswith("APIError") or name.endswith("RateLimitError"):
        return True
    return False


class CogneeBackend:
    def __init__(self, cfg: SidecarConfig):
        self.cfg = cfg
        self.docs_dir = os.path.join(cfg.root, "docs")
        self.map_path = os.path.join(cfg.root, "ids.json")
        os.makedirs(self.docs_dir, exist_ok=True)
        os.environ.update(cfg.cognee_env())
        import cognee  # noqa: E402  (env must be set first)

        self.cognee = cognee
        self.cognee.config.system_root_directory(os.path.join(cfg.root, "system"))
        self.cognee.config.data_root_directory(os.path.join(cfg.root, "data"))
        self._ids: dict[str, dict[str, str]] = self._load_map()
        # Configured primary model for status(); never mutated mid-request.
        self._model = cfg.llm_model
        # Single write lock for add / delete / cognify so cognee's embedded
        # stores (SQLite + LanceDB + graph) never see concurrent writers.
        # search stays unlocked: it may observe a partially-indexed view;
        # the host applies a 300ms budget and falls back to FTS.
        self._write_lock = asyncio.Lock()
        self.last_error: str | None = None

    def _load_map(self) -> dict[str, dict[str, str]]:
        try:
            with open(self.map_path, encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save_map(self) -> None:
        tmp = self.map_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._ids, f)
        os.replace(tmp, self.map_path)

    def _llm_config(self, model: str):
        from cognee.infrastructure.llm.config import LLMConfig

        return LLMConfig(
            llm_provider="custom",
            llm_model=f"openai/{model}",
            llm_endpoint=self.cfg.llm_endpoint,
            llm_api_key=self.cfg.llm_api_key,
        )

    async def _with_fallback(self, fn):
        """Run ``fn(llm_config)`` on the primary model, retrying once on the fallback.

        The model is scoped per call (cognee's ``llm_config=`` argument), so
        concurrent requests never observe another request's fallback. Status
        reports the configured primary model, not an in-flight choice.
        """
        try:
            return await fn(self._llm_config(self.cfg.llm_model))
        except Exception as err:  # noqa: BLE001
            if self.cfg.llm_fallback_model == self.cfg.llm_model or not _is_llm_error(err):
                raise
            print("[rox-cognee] primary LLM failed, retrying with fallback model", file=sys.stderr)
            return await fn(self._llm_config(self.cfg.llm_fallback_model))

    async def add(self, docs: list[dict[str, Any]]) -> dict[str, Any]:
        async with self._write_lock:
            return await self._add(docs)

    async def _add(self, docs: list[dict[str, Any]]) -> dict[str, Any]:
        # Stage files first; only commit id-map entries for sources cognee accepted
        # so status()/search() dataset lists do not advertise docs the graph never got.
        staged: dict[str, list[tuple[str, str, str]]] = {}  # source -> [(name, path, id)]
        for d in docs:
            name = doc_file_name(d["id"])
            path = os.path.join(self.docs_dir, name)
            with open(path, "w", encoding="utf-8") as f:
                f.write(d["text"])
            staged.setdefault(d["source"], []).append((name, path, d["id"]))
        added = 0
        first_err: BaseException | None = None
        for source, items in staged.items():
            paths = [p for _, p, _ in items]
            try:
                await self.cognee.add(paths, dataset_name=dataset_for(source))
            except Exception as err:  # noqa: BLE001
                first_err = first_err or err
                print(f"[rox-cognee] add failed for dataset {dataset_for(source)}: {type(err).__name__}", file=sys.stderr)
                continue
            for name, _path, doc_id in items:
                self._ids[name] = {"id": doc_id, "source": source}
                added += 1
        self._save_map()
        if first_err is not None and added == 0:
            raise first_err
        # Partial success: map reflects accepted sources; host may retry the rest.
        # Re-adding the same ids rewrites the same file names; cognee-level
        # dedup of duplicate graph nodes is not assumed here.
        return {"added": added}

    async def cognify(self, sources: list[str] | None) -> dict[str, Any]:
        datasets = sorted({dataset_for(v["source"]) for v in self._ids.values() if not sources or v["source"] in sources})
        if not datasets:
            return {"datasets": []}
        async with self._write_lock:
            try:
                await self._with_fallback(lambda llm: self.cognee.cognify(datasets=datasets, llm_config=llm))
                self.last_error = None
            except Exception as err:
                self.last_error = type(err).__name__
                raise
        return {"datasets": datasets}

    def _hit_from(self, item: Any, rank: int) -> dict[str, Any] | None:
        payload = item
        if hasattr(item, "search_result"):
            payload = item.search_result
        if isinstance(payload, dict):
            text = payload.get("text") or payload.get("content") or payload.get("description")
            meta = payload
        else:
            text, meta = (payload if isinstance(payload, str) else None), {}
        if not isinstance(text, str) or not text.strip():
            return None
        doc = None
        for key in ("document_name", "name", "is_part_of"):
            val = meta.get(key) if isinstance(meta, dict) else None
            if isinstance(val, dict):
                val = val.get("name")
            if isinstance(val, str):
                base = os.path.basename(val)
                if not base.endswith(".txt"):
                    base += ".txt"
                if base in self._ids:
                    doc = self._ids[base]
                    break
        hid = doc["id"] if doc else "x-" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]
        # cognee does not expose a stable relevance score across modes; the host
        # fuses by rank (RRF), so ``score`` is rank-derived by contract.
        return {"id": hid, "source": doc["source"] if doc else "notes", "text": text, "score": 1.0 / (rank + 1), "known": doc is not None}

    async def search(self, query: str, mode: str, limit: int) -> list[dict[str, Any]]:
        from cognee.modules.search.types import SearchType

        stype = SearchType[_MODE_TO_SEARCH_TYPE[mode]]
        datasets = sorted({dataset_for(v["source"]) for v in self._ids.values()})
        if not datasets:
            return []
        results = await self._with_fallback(
            lambda llm: self.cognee.search(query_text=query, query_type=stype, datasets=datasets, top_k=limit, llm_config=llm)
        )
        hits: list[dict[str, Any]] = []
        for i, item in enumerate(results or []):
            h = self._hit_from(item, i)
            if h:
                hits.append(h)
            if len(hits) >= limit:
                break
        return hits

    async def delete(self, ids: list[str]) -> dict[str, Any]:
        async with self._write_lock:
            return await self._delete(ids)

    async def _delete(self, ids: list[str]) -> dict[str, Any]:
        from cognee.api.v1.datasets.datasets import datasets as ds_api

        wanted = {doc_file_name(i) for i in ids}
        wanted_ds = {dataset_for(self._ids[n]["source"]) for n in wanted if n in self._ids}
        removed = 0
        if not wanted_ds:
            return {"removed": 0}
        # Names successfully removed from cognee — cleared from the map in finally
        # so a mid-loop raise still keeps status()/search() honest about what left.
        gone: set[str] = set()
        try:
            all_ds = await ds_api.list_datasets()
            for ds in all_ds:
                if str(getattr(ds, "name", "")) not in wanted_ds:
                    continue
                for data in await ds_api.list_data(ds.id):
                    name = os.path.basename(str(getattr(data, "name", "")))
                    if not name.endswith(".txt"):
                        name += ".txt"
                    if name in wanted:
                        await ds_api.delete_data(dataset_id=ds.id, data_id=data.id, delete_dataset_if_empty=False)
                        gone.add(name)
                        removed += 1
        finally:
            for name in gone:
                self._ids.pop(name, None)
                try:
                    os.remove(os.path.join(self.docs_dir, name))
                except OSError:
                    pass
            if gone:
                self._save_map()
        return {"removed": removed}

    async def status(self) -> dict[str, Any]:
        return {"state": "ready", "documents": len(self._ids), "model": self._model, "lastError": self.last_error}

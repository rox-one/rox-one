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


def doc_file_name(doc_id: str) -> str:
    return "rox-" + hashlib.sha256(doc_id.encode("utf-8")).hexdigest()[:32] + ".txt"


def dataset_for(source: str) -> str:
    return f"rox_{source}"


def _is_llm_error(err: BaseException) -> bool:
    name = type(err).__name__.lower()
    msg = str(err).lower()
    return any(k in name or k in msg for k in ("llm", "ratelimit", "rate limit", "apierror", "timeout", "serviceunavailable", "502", "503", "529"))


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
        self._model = cfg.llm_model
        self._cognify_lock = asyncio.Lock()
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

    def _use_model(self, model: str) -> None:
        self._model = model
        self.cognee.config.set_llm_model(f"openai/{model}")

    async def _with_fallback(self, fn):
        try:
            return await fn()
        except Exception as err:  # noqa: BLE001
            if self._model == self.cfg.llm_fallback_model or not _is_llm_error(err):
                raise
            print("[rox-cognee] primary LLM failed, retrying with fallback model", file=sys.stderr)
            self._use_model(self.cfg.llm_fallback_model)
            try:
                return await fn()
            finally:
                self._use_model(self.cfg.llm_model)

    async def add(self, docs: list[dict[str, Any]]) -> dict[str, Any]:
        by_source: dict[str, list[str]] = {}
        for d in docs:
            name = doc_file_name(d["id"])
            path = os.path.join(self.docs_dir, name)
            with open(path, "w", encoding="utf-8") as f:
                f.write(d["text"])
            by_source.setdefault(d["source"], []).append(path)
            self._ids[name] = {"id": d["id"], "source": d["source"]}
        for source, paths in by_source.items():
            await self.cognee.add(paths, dataset_name=dataset_for(source))
        self._save_map()
        return {"added": len(docs)}

    async def cognify(self, sources: list[str] | None) -> dict[str, Any]:
        datasets = sorted({dataset_for(v["source"]) for v in self._ids.values() if not sources or v["source"] in sources})
        if not datasets:
            return {"datasets": []}
        async with self._cognify_lock:
            try:
                await self._with_fallback(lambda: self.cognee.cognify(datasets=datasets))
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
        return {"id": hid, "source": doc["source"] if doc else "notes", "text": text, "score": 1.0 / (rank + 1), "known": doc is not None}

    async def search(self, query: str, mode: str, limit: int) -> list[dict[str, Any]]:
        from cognee.modules.search.types import SearchType

        stype = SearchType[_MODE_TO_SEARCH_TYPE[mode]]
        datasets = sorted({dataset_for(v["source"]) for v in self._ids.values()})
        if not datasets:
            return []
        results = await self._with_fallback(
            lambda: self.cognee.search(query_text=query, query_type=stype, datasets=datasets, top_k=limit)
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
        from cognee.api.v1.datasets.datasets import datasets as ds_api

        wanted = {doc_file_name(i) for i in ids}
        removed = 0
        all_ds = await ds_api.list_datasets()
        for ds in all_ds:
            if not str(getattr(ds, "name", "")).startswith("rox_"):
                continue
            for data in await ds_api.list_data(ds.id):
                name = os.path.basename(str(getattr(data, "name", "")))
                if not name.endswith(".txt"):
                    name += ".txt"
                if name in wanted:
                    await ds_api.delete_data(dataset_id=ds.id, data_id=data.id, delete_dataset_if_empty=False)
                    removed += 1
        for name in wanted:
            self._ids.pop(name, None)
            try:
                os.remove(os.path.join(self.docs_dir, name))
            except OSError:
                pass
        self._save_map()
        return {"removed": removed}

    async def status(self) -> dict[str, Any]:
        return {"state": "ready", "documents": len(self._ids), "model": self._model, "lastError": self.last_error}

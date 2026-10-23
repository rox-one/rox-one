"""In-memory backend for protocol smoke tests (no cognee import)."""
from __future__ import annotations

from typing import Any


class FakeBackend:
    def __init__(self) -> None:
        self.docs: dict[str, dict[str, Any]] = {}

    async def add(self, docs):
        for d in docs:
            self.docs[d["id"]] = d
        return {"added": len(docs)}

    async def cognify(self, sources):
        return {"datasets": sorted({f"rox_{d['source']}" for d in self.docs.values()})}

    async def search(self, query, mode, limit):
        terms = query.lower().split()
        hits = [d for d in self.docs.values() if any(t in d["text"].lower() for t in terms)]
        return [{"id": d["id"], "source": d["source"], "text": d["text"], "score": 1.0 / (i + 1), "known": True} for i, d in enumerate(hits[:limit])]

    async def delete(self, ids):
        n = sum(1 for i in ids if self.docs.pop(i, None) is not None)
        return {"removed": n}

    async def status(self):
        return {"state": "ready", "documents": len(self.docs), "model": "fake", "lastError": None}

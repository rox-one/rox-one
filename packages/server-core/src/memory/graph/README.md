# Graph memory (cognee)

Additive knowledge-graph layer behind `MemoryIndexService` / `memory_search`.

| Piece | Role |
| --- | --- |
| `@rox/shared/memory/graph-provider` | Seam + RRF fusion (300ms search budget) |
| `packages/cognee-sidecar` | Python JSON-RPC sidecar (lazy uv + venv) |
| `cognee-runtime` / `CogneeGraphProvider` | Process manager, soft-fail cold search |
| `ingest.ts` + cost cap | Rebuild ingest, untrusted drop, daily USD cap |
| Settings → Память | `memory.graph` default **on**, per-source toggles |
| `one-time-import.ts` | Resumable backfill; never deletes native memory |

Storage: `~/rox/memory/cognee/<sha1(workspaceId)[:16]>/`.
Cost ledger: `~/rox/memory/cognee/cost/<yyyy-mm-dd>.json`.

License: see `packages/cognee-sidecar/NOTICE` and root `NOTICE`.

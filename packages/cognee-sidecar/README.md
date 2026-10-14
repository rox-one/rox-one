# rox-cognee-sidecar

Graph-memory sidecar for Rox. An **additive** knowledge-graph layer behind the
`GraphMemoryProvider` seam (`@rox/shared/memory/graph-provider`); the native
memory stack stays the source of truth.

- Python process, spawned lazily by server-core on first memory use (never at app
  start), idle-killed by the host. Installed into `~/rox/runtime/cognee` by the
  runtime manager (PR3), not bundled into the app.
- Protocol: newline-delimited JSON-RPC over stdio. Methods: `hello`, `status`,
  `add {docs}`, `cognify {sources?}`, `search {query, mode, limit}`,
  `delete {ids}`, `shutdown`. stdout is protocol-only; logs go to stderr and
  never include secrets or document text.
- Storage: `ROX_COGNEE_ROOT` (host passes `~/rox/memory/cognee/<workspaceId>`):
  ladybug graph + LanceDB + SQLite, one dataset per source (`rox_<source>`).
- LLM: OpenAI-compatible `api.rox.one` (Rox R1 Max), automatic retry with
  the gateway cheap tier `rox/fast` (DeepSeek V4.1 Flash class,
  overridable) on LLM errors. Key comes from `ROX_COGNEE_LLM_API_KEY`
  (injected by the host; never logged, never committed).
- Embeddings: local fastembed multilingual MiniLM (384-d).
- Untrusted-origin docs are dropped on ingest (defence in depth; host gates first).

Tests (no cognee needed): `python3 -m unittest discover -s tests`.
Lock: `uv lock` (pinned `uv.lock` committed).

Licensing: see `NOTICE` (cognee is Apache-2.0).

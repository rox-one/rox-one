# 02 — Isolated serialize-time OpenRouter strip

**What to build:** `finalizeCatalogResponse` drops an OpenRouter-shaped row even when the caller passed it in. Deleting that filter makes this ticket's test red.

**Blocked by:** None — can start immediately (parallel with 01).

**Status:** landed in [zed-api#4](https://github.com/agisota/zed-api/pull/4) (`finalizeCatalogResponse` + isolated test). RED on `406ccebb` before the filter: `openrouter/test` leaked.

- [x] Mixed-list unit test: OpenRouter row absent, non-OpenRouter row present
- [x] Worktree check: commenting the filter fails the test

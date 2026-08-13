# 02 — Isolated serialize-time OpenRouter strip

**What to build:** `finalizeCatalogResponse` drops an OpenRouter-shaped row even when the caller passed it in. Deleting that filter makes this ticket's test red.

**Blocked by:** None — can start immediately (parallel with 01).

**Status:** done locally.

- [x] Mixed-list unit test: OpenRouter row absent, non-OpenRouter row present
- [x] Worktree check: commenting the filter fails the test

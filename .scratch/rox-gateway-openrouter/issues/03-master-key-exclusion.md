# 03 — Master-key catalog exclusion

**What to build:** An env-var master key with no DB row gets the same OpenRouter-free `GET /v1/models` as the unauthenticated path.

**Blocked by:** None — can start immediately (parallel with 01).

**Status:** done locally.

- [x] Exclusion suite covers the `!keyMeta` / env-var master-key request shape
- [x] `findOpenRouterEntries` is empty

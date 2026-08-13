# 03 — Master-key catalog exclusion

**What to build:** An env-var master key with no DB row gets the same OpenRouter-free `GET /v1/models` as the unauthenticated path.

**Blocked by:** None — can start immediately (parallel with 01).

**Status:** landed in [zed-api#2](https://github.com/agisota/zed-api/pull/2) (`a master key with no DB metadata row still gets an OpenRouter-free catalog`).

- [x] Exclusion suite covers the `!keyMeta` / env-var master-key request shape
- [x] `findOpenRouterEntries` is empty

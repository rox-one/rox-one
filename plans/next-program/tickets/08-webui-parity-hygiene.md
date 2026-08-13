# 08 — Web UI parity and dead knobs

**What to build:** Web login and settings no longer 401 the manifest or warn about a missing notification handler. Root scripts that point at missing apps are gone. Token-length and config-dir lock are in the server runbook.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `/manifest.json` (or `/manifest*`) is reachable after login without a console 401, or is not requested
- [ ] `notification:getEnabled` has a web adapter stub
- [ ] `marketing:*` and `docs:dev` scripts removed; `CRAFT_WEBUI_PORT` removed
- [ ] `docs/cli.md` states token ≥16 and single-instance lock

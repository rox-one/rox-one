# 05 — Isolated staging SHA and runtime smoke

**What to build:** The merged (or proposed) SHA runs on a host that is not production and not the Swiss migration node. Unauthenticated catalog has no OpenRouter; quota listed ids complete.

**Blocked by:** 04

**Status:** loopback harness merged in [zed-api#3](https://github.com/agisota/zed-api/pull/3) squash `c2f356833` (tip of `release/v3.8.50`). That is **not** AC-07/08. No isolated staging host (`api.rox.one` = prod; Swiss node = live migration; Railway MCP unavailable).

- [x] Loopback `getUnifiedModelsResponse` smoke on tip `c2f356833`: public-only 200 / five `rox/*`; normal 200 / 281 models / OpenRouter 0
- [ ] Immutable SHA recorded on an isolated staging host (AC-07)
- [ ] JSON/SSE/telemetry/restart-persistence smoke recorded (AC-08)

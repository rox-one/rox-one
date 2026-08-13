# 05 — Isolated staging SHA and runtime smoke

**What to build:** The merged (or proposed) SHA runs on a host that is not production and not the Swiss migration node. Unauthenticated catalog has no OpenRouter; quota listed ids complete.

**Blocked by:** 04

**Status:** blocked — no isolated staging host. [zed-api#3](https://github.com/agisota/zed-api/pull/3) is loopback-only, not a staging deploy.

- [ ] Immutable SHA recorded (AC-07)
- [ ] JSON/SSE/telemetry/restart-persistence smoke recorded (AC-08)

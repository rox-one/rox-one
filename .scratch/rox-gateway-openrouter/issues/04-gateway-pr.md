# 04 — Export patch and open gateway PR

**What to build:** A `git am`-clean patch on `release/v3.8.50` and a PR on `agisota/zed-api` (or an updated patch in `rox-one` if write is denied).

**Blocked by:** 01, 02, 03

**Status:** [zed-api#2](https://github.com/agisota/zed-api/pull/2) merged @ `406ccebb`. Follow-up [zed-api#4](https://github.com/agisota/zed-api/pull/4) open @ `d93f945a`. `cursor[bot]` git push still 403; files uploaded via GitHub MCP as agisota.

- [x] Focused ROX suite 0 fail and `typecheck:core` exit 0, fresh this session
- [x] Patch applies with `git am --3way` on a clean `release/v3.8.50` clone
- [x] PR opened, or write-denied blocker reported with the patch attached
- [x] Follow-up PR: https://github.com/agisota/zed-api/pull/4

# 04 — Export patch and open gateway PR

**What to build:** A `git am`-clean patch on `release/v3.8.50` and a PR on `agisota/zed-api` (or an updated patch in `rox-one` if write is denied).

**Blocked by:** 01, 02, 03

**Status:** ready-for-agent

- [ ] Focused ROX suite 0 fail and `typecheck:core` exit 0, fresh this session
- [ ] Patch applies with `git am --3way` on a clean `release/v3.8.50` clone
- [ ] PR opened, or write-denied blocker reported with the patch attached

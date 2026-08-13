# 13 — Live-credential first-turn E2E

**What to build:** With a real model credential in the environment, the fresh-machine path reaches stream + one host tool + one MCP tool + a permission prompt, then restart restores the same session.

**Blocked by:** 01, 12. Also blocked on a human-supplied credential (`ROX_API_KEY` / `~/.omp/agent/config.yml` / other provider key).

**Status:** ready-for-agent

- [ ] Wave 5 steps that were BLOCKED become VERIFIED or stay BLOCKED with the missing secret named
- [ ] Negative paths from the previous program remain bounded
- [ ] Evidence is a log + browser trace, not a claim

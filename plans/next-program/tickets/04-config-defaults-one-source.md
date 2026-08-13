# 04 — One source of truth for config defaults

**What to build:** Desktop, headless, and CI agree on permission mode and thinking level. The bundled JSON is the only default document; the TypeScript fallback cannot disagree with it.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Bundled `thinkingLevel` is a current value, not legacy `"think"`
- [ ] Fallback permission mode matches the bundle (`allow-all` or an explicit documented choice)
- [ ] A test fails if the TypeScript fallback and the JSON diverge
- [ ] `apps/electron/resources/AGENTS.md` no longer claims there is no TypeScript fallback

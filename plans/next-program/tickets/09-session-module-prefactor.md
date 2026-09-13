# 09 — Deepen the session module (prefactor)

**What to build:** Share capability, spawn-env composition, and terminal event completion live behind internal seams of the session module. Public RPC and renderer behavior do not change.

**Blocked by:** None for the extract itself. Blocks later tickets that would otherwise edit the 10k-line file.

**Status:** ready-for-agent

- [ ] Existing server-core session tests stay green without rewriting assertions around private names
- [ ] Share owner key still stripped from renderer DTOs
- [ ] Spawn still merges persisted env + secret fragment
- [ ] A mid-turn agent crash still emits one `complete`
- [ ] A second workstream can land a session feature without a textual merge in the old god-file

# 06 — Secrets settings vertical slice

**What to build:** The user can add/remove a `secretRef` in Settings. The next spawned session receives the resolved env var. The renderer never sees the value.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Settings RPC reads/writes refs only
- [ ] Denied env var names are rejected with `SECRET_ENVVAR_DENIED`
- [ ] A new session after save has the var; the settings GET does not
- [ ] No placeholder page: if Infisical token is missing, the row shows a typed unavailable state

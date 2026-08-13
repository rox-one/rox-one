# 12 — OMP startup codes on the protocol union

**What to build:** The renderer and CLI switch on a typed error code for OMP startup failures. A new code cannot be added in the agent and silently become a generic string in the UI.

**Blocked by:** 09 if the event projection moves with the session extract; otherwise none.

**Status:** ready-for-agent

- [ ] Protocol union includes the six OMP startup codes
- [ ] UI copy for `OMP_NO_MODELS` / `OMP_AUTH_REQUIRED` is i18n’d in all 10 locales
- [ ] A test of the DTO rejects an unknown code or lists it exhaustively

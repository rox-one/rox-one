# 03 — Viewer share residual hardening

**What to build:** Share create/update measures payload size in UTF-8 bytes, GET/PUT/DELETE send `nosniff`, and concurrent PUTs cannot silently clobber each other. Legacy shares stay immutable.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A payload whose UTF-16 length is under 25 MiB but UTF-8 bytes are over is rejected 413
- [ ] Responses include `X-Content-Type-Options: nosniff`
- [ ] Conditional write or equivalent prevents lost update
- [ ] Unauthenticated and wrong-key mutations still 401/403
- [ ] OPS note for Cloudflare rate-limit rule and legacy R2 cleanup remains in SECURITY.md (human-run)

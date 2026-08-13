# 02 — Escape OAuth callback HTML

**What to build:** The OAuth callback page treats IdP `error` / `error_description` and the deeplink URL as untrusted text. A crafted value cannot run script or redirect to an unexpected origin.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `errorDetail` is escaped before it enters HTML
- [ ] `deeplinkUrl` is allowed only as an internal scheme already treated as internal
- [ ] A test with `<script>` / `javascript:` payloads stays inert
- [ ] Success path still auto-closes and returns to the app

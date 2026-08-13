# 01 — Honest quota catalog under public mode

**What to build:** A quota-exclusive API key, with ROX public catalog on, sees its pool's non-OpenRouter `qtSd/*` models in `GET /v1/models` and can complete against a listed id. It does not see `rox/*`.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Quota key + `ROX_PUBLIC_CATALOG_ONLY=true` + glm pool: catalog contains `qtSd/*`, contains no `rox/*`, contains no OpenRouter
- [ ] Same key: `enforceApiKeyPolicy` does not return `QUOTA_ONLY` for a listed id
- [ ] Non-quota key in public mode still sees only `rox/*`

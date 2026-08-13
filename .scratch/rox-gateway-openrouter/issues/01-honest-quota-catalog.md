# 01 — Honest quota catalog under public mode

**What to build:** A quota-exclusive API key, with ROX public catalog on, sees its pool's non-OpenRouter `qtSd/*` models in `GET /v1/models` and can complete against a listed id. It does not see `rox/*`.

**Blocked by:** None — can start immediately.

**Status:** landed in [zed-api#4](https://github.com/agisota/zed-api/pull/4) squash `df2a0fa5e` (quota honesty + provider-segment + claude/combo glm aliases). Production short circuit already on `406ccebb` (#2).

- [x] Quota key + `ROX_PUBLIC_CATALOG_ONLY=true` + glm pool: catalog contains `qtSd/*`, contains no `rox/*`, contains no OpenRouter
- [x] Same key: `enforceApiKeyPolicy` does not return `QUOTA_ONLY` for a listed id
- [x] Non-quota key in public mode still sees only `rox/*`

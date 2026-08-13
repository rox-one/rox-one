# ROX gateway OpenRouter catalog — design

Дата: 2026-08-13. Статус: контракт B **на gateway**. Exclusion merged в `release/v3.8.50` @ `406ccebb` ([zed-api#2](https://github.com/agisota/zed-api/pull/2)). Serialize-time strip + quota honesty + qtSd provider-segment — [zed-api#4](https://github.com/agisota/zed-api/pull/4) `hotfix/rox-catalog-honesty` @ `3b5181c3`. AC-07/08 (staging SHA + runtime smoke) — blocked. GitHub Actions на #4 не стартуют (org billing lock).  
Репо: `agisota/zed-api` `release/v3.8.50` @ `406ccebb`. Follow-up патч: `docs/patches/rox-catalog-honesty-followup.patch`. Исторический патч на `2e7732427`: `docs/patches/rox-catalog-openrouter-hotfix.patch` — не `git am` на tip.  
Канон артефактов на самом gateway: `_tasks/superpowers/specs/` (gitignored). Эта копия живёт в `rox-one`.

## Problem Statement

Публичный каталог ROX (`GET /v1/models`) не должен показывать OpenRouter. На `release/v3.8.50` предикат искал только legacy `openrouter_`, per-key фильтр возвращал OpenRouter обратно, quota short circuit обходил public projection. Локальный hotfix закрывает утечку OpenRouter на unit-уровне, но **подменяет** quota-каталог на `rox/*`, которые `enforceApiKeyPolicy` отвергает с `QUOTA_ONLY`. Клиенты, которые берут модель из каталога, получают 403 на каждый completion. Патч не на remote gateway, не на staging.

Отдельно: форк coding-agent и daily upstream sync — другие репозитории и хосты; в этот spec не входят.

## Solution

Применить exclusion hotfix, заменив quota-public remap: quota-exclusive ключ в любом режиме каталога видит **callable** `qtSd/*` своего пула после fail-closed OpenRouter strip. Не-quota ключи в public mode видят только `rox/*`. GET и POST согласованы: каждый id в каталоге ключа проходит `validateQuotaAccess` / `isModelAllowedForKey`. Доставка — PR в `agisota/zed-api` `release/v3.8.50`, изолированный staging SHA, runtime smoke.

## Seams

Существующие швы (новые не вводим в v1 этого spec):

1. **Catalog exit** — `finalizeCatalogResponse` / `getUnifiedModelsResponse`. Один serialize-time выход для `/v1/models`, `/v1/models/{id}`, specialty, vscode, provider-scoped lists.
2. **Request policy** — `enforceApiKeyPolicy` → `validateQuotaAccess`. Не меняем для контракта B: quota ключ по-прежнему вызывает только `qtSd/<group>/<provider>/<model>`.
3. **Test seam** — HTTP `GET /v1/models` через `getUnifiedModelsResponse` (как `rox-openrouter-catalog-exclusion.test.ts`) плюс прямой вызов `finalizeCatalogResponse` со смешанным массивом.

Углубление «один модуль callable-catalog для GET и POST» — follow-on (см. architecture review), не блокер этого spec.

## User Stories

1. As a ROX product client with a normal API key, I want `GET /v1/models` to list only `rox/*`, so that the picker never offers OpenRouter or raw provider ids.
2. As a ROX product client, I want `POST /v1/chat/completions` with a listed `rox/*` id to be accepted by key policy (subject to fallback), so that the picker does not lie.
3. As an operator of a quota-exclusive key, I want `GET /v1/models` to list the pool's `qtSd/*` ids that are not OpenRouter, so that discovery clients can pick a callable model.
4. As an operator of a quota-exclusive key, I want `POST /v1/chat/completions` with a listed `qtSd/*` id to pass `validateQuotaAccess`, so that completions are not 403 `QUOTA_ONLY`.
5. As an operator of a quota-exclusive OpenRouter pool, I want that pool's `qtSd/.../openrouter/...` rows absent from the catalog, so that AC-01 holds on the quota path.
6. As an unauthenticated or master-key caller, I want canonical and legacy OpenRouter rows absent from `/v1/models`, so that the leak cannot depend on a live OpenRouter fetch.
7. As a DB-key holder whose `allowedModels` names an OpenRouter id, I want that id still absent from the catalog, so that per-key allow-lists cannot republish the leak.
8. As a dashboard operator, I want `/api/models` (admin builder) unchanged, so that OpenRouter connections can still be managed.
9. As a release captain, I want the change on a named SHA of `release/v3.8.50`, so that staging is immutable and bisectable (AC-07).
10. As a release captain, I want JSON/SSE/telemetry/restart-persistence smoke on that SHA, so that unit-green is not mistaken for runtime-green (AC-08).
11. As a future catalog author, I want a serialize-time OpenRouter strip that fails closed, so that a new assembly branch cannot republish OpenRouter by omission.
12. As a reviewer, I want a test that feeds `finalizeCatalogResponse` a mixed list, so that the serialize-time strip is independently red if deleted.
13. As a reviewer, I want a master-key (`!keyMeta`) catalog case, so that AC-01's named path cannot regress silently.
14. As a quota client, I want advertised ids to be the ids I may POST, so that Claude Code / Codex discovery does not 403 after a healthy-looking picker.

## Implementation Decisions

- **Quota + public mode = B.** Do not advertise `rox/*` to quota-exclusive keys. Keep `buildQuotaExclusiveModels` in the #8770 short circuit for both public and non-public mode; OpenRouter rows drop at `finalizeCatalogResponse`. Rejected: A (empty list — #4806 empty picker). Rejected for this spec: C (allow `rox/*` in quota policy — needs fallback constrained to the pool; separate spec).
- **OpenRouter path-segment matching stays.** AC-01 forbids OpenRouter on quota catalog paths. Nested `agy/openrouter/...` remains excluded. Kilocode `kc/openrouter/free` over-match is accepted residual, not a v1 fix.
- **Request-path OpenRouter deny is out of scope.** Exclusion is discovery-only; POST of a known `openrouter/...` id stays a policy/allow-list concern.
- **Admin `/api/models` stays a separate builder.**
- **Dead late `allowedQuotas` branch** may be deleted in the same PR if it stays a one-line locality cleanup; not required to land the P1.
- **Cache key + `allowedModels=['*']` + construction marker** are not this spec.
- **Modules:** catalog short circuit, `finalizeCatalogResponse`, exclusion tests. Policy module unchanged for B.
- **Apply target:** `agisota/zed-api` `hotfix/rox-catalog-openrouter` from `release/v3.8.50`. `rox-one` keeps the patch + this spec as the handoff when write is unavailable.

## Testing Decisions

- Good tests assert **external behaviour**: response `data[].id` of `GET /v1/models`, and (for the contract test) that a listed id is not rejected by `enforceApiKeyPolicy` / `validateQuotaAccess`. Do not assert internal branch names.
- Prior art: `tests/unit/rox-openrouter-catalog-exclusion.test.ts` (HTTP via `getUnifiedModelsResponse`), `tests/unit/rox-public-model-policy.test.ts` (predicate cases).
- Replace the quota test that currently requires `rox/*` under public mode: it must require callable `qtSd/*` (glm pool in the fixture), zero OpenRouter, zero `rox/*`.
- Add: `finalizeCatalogResponse` mixed-list isolation; master-key env-var path; optional POST/policy admission of a listed quota id.
- RED-GREEN: new/changed tests fail on `2e7732427` production files and pass on the fix. Do not claim green from prior logs.
- Focused suite: `tests/unit/rox-*.test.ts`, `openrouter-vision-sync-4264.test.ts`, `specialty-model-hidden-openrouter-9293.test.ts`, plus `npm run typecheck:core`.
- Pre-existing 13 full-suite fails on `release/v3.8.50` are not regressions of this work.

## Out of Scope

- Track 2: ROX coding-agent fork dirty worktree / semantic commits (needs Mac workspace).
- Track 3: daily upstream sync state machine / launchd / Bun (needs local fork).
- Option C (callable `rox/*` for quota keys).
- Request-path OpenRouter hard deny.
- Construction-time OpenRouter marker (architecture candidate).
- Catalog cache key including `ROX_PUBLIC_CATALOG_ONLY`.
- Treating API-key `allowedModels=['*']` as allow-all (relay tokens are a different table).
- Changing `#4264` / `#9293` ROX divergence policy.
- Deploy to `api.rox.one` or the Swiss migration node.

## Further Notes

Handoff AC-01..AC-08: this spec covers AC-01 (catalog paths including quota, honestly), AC-02 (focused tests), AC-03 (typecheck), AC-07/08 (delivery after write+staging exist). AC-09..12 remain track 2/3.

Review run `20260813-074334-1543fd56`: verdict Needs changes on `8aaa9d039` because of the quota-public lie. Do not `git am` that commit as-is.

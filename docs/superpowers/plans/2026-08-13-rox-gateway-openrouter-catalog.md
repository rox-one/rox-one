# ROX Gateway OpenRouter Catalog Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `agisota/zed-api` `release/v3.8.50`, publish no OpenRouter rows on catalog paths, and make every advertised id for a quota-exclusive key a `qtSd/*` id that `validateQuotaAccess` will admit.

**Status 2026-08-13:** Exclusion #2 (`406ccebb`), honesty #4 squash (`df2a0fa5e`), loopback smoke #3 squash (`c2f356833`) are all on `origin/release/v3.8.50`. Do not `git am` local patches onto current tip. Staging (Task 7 / AC-07/08) still open. GitHub Actions do not start (org billing lock).

**Architecture:** Keep OpenRouter ownership/path matching and `finalizeCatalogResponse` fail-closed strip. Change only the quota short circuit: never substitute `buildRoxPublicCatalog()` for quota-exclusive keys. Public-mode non-quota keys still see `rox/*`. Request policy stays quota-only for those keys.

**Tech Stack:** Node native test runner, tsx, Next.js route handlers in `zed-api`, SQLite test fixtures via `DATA_DIR`.

**Spec:** `docs/superpowers/specs/2026-08-13-rox-gateway-openrouter-catalog-design.md` (rox-one copy). On zed-api, copy into `_tasks/superpowers/specs/` (gitignored `_tasks` repo).

## Global Constraints

- Base: `release/v3.8.50` @ `2e7732427`. Do not `git am` `8aaa9d039` as-is.
- zed-api forbids `git stash`; use a worktree for red-green.
- Contract B: quota keys get `qtSd/*` after OpenRouter strip, never uncallable `rox/*`.
- AC-01 path-segment `openrouter` match stays (including quota `qtSd/.../openrouter/...`).
- Do not change `validateQuotaAccess` / `enforceApiKeyPolicy` in this plan.
- Do not touch admin `/api/models`.
- Do not implement track 2 (coding-agent fork) or track 3 (daily sync).
- Fresh verification this session before any green claim. Prior logs do not count.
- cursor[bot] cannot push `agisota/zed-api`; stop at a local branch + patch if write is denied.

---

## File map

- Modify: `src/app/api/v1/models/catalog.ts` (quota short circuit ~579-589)
- Keep: `src/lib/roxPublicModelPolicy.ts` predicate + `finalizeCatalogResponse` strip
- Modify: `tests/unit/rox-openrouter-catalog-exclusion.test.ts` (quota case)
- Create assertions in: `tests/unit/rox-public-model-policy.test.ts` or a new `tests/unit/catalog-response-openrouter-filter.test.ts`
- Optional delete: unreachable `allowedQuotas` branch at `catalog.ts` ~1565
- Do not modify: `src/shared/utils/apiKeyPolicy.ts`, `src/sse/handlers/chat.ts`

### Task 1: Quota catalog must advertise callable qtSd ids

**Files:**
- Modify: `tests/unit/rox-openrouter-catalog-exclusion.test.ts`
- Modify: `src/app/api/v1/models/catalog.ts:579-589`

**Interfaces:**
- Consumes: `buildQuotaExclusiveModels(allowedQuotas, combos, timestamp, metadataFn)`, `finalizeCatalogResponse`
- Produces: GET `/v1/models` for a quota-exclusive key with `ROX_PUBLIC_CATALOG_ONLY=true` returns glm `qtSd/*` ids from the fixture pool, no `rox/*`, no OpenRouter

- [ ] **Step 1: Write the failing quota assertion**

Replace the test `"a quota-exclusive key gets rox IDs only while the ROX public catalog is on"` so it asserts callable quota ids:

```ts
test("a quota-exclusive key keeps callable qtSd ids when the ROX public catalog is on", async () => {
  const group = groupsDb.createGroup("Rox Exclusion");
  const connection = await providersDb.createProviderConnection({
    provider: "glm",
    authType: "apikey",
    name: "rox-exclusion-glm",
    apiKey: "sk-glm-rox-exclusion",
    isActive: true,
    testStatus: "active",
  });
  const pool = poolsDb.createPool({
    connectionId: (connection as Record<string, unknown>).id as string,
    name: "Rox Exclusion",
    groupId: group.id,
  });
  await syncQuotaCombos(pool.id);

  const quotaKey = await apiKeysDb.createApiKey("rox-openrouter-quota", "rox-quota-machine");
  await apiKeysDb.updateApiKeyPermissions(quotaKey.id, { allowedQuotas: [pool.id] });

  process.env.ROX_PUBLIC_CATALOG_ONLY = "true";
  const models = await readCatalog(quotaKey.key);

  assert.equal(findOpenRouterEntries(models).length, 0);
  assert.equal(
    models.filter((m) => isRoxPublicModelId(m.id)).length,
    0,
    "quota keys must not be advertised rox/* ids they cannot POST"
  );
  assert.ok(
    models.some((m) => String(m.id).startsWith("qtSd/")),
    "quota keys must still see pool qtSd/* ids"
  );
});
```

- [ ] **Step 2: Run the test on hotfix HEAD `8aaa9d039` (or current patched tree) and confirm it fails**

Run:

```bash
cd /tmp/zed-api
npx cross-env DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm \
  --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts \
  --test --test-force-exit --test-concurrency=4 \
  tests/unit/rox-openrouter-catalog-exclusion.test.ts
```

Expected: FAIL on the new quota test (`rox/*` present, `qtSd/` absent). Other exclusion tests may still pass.

- [ ] **Step 3: Minimal production change**

In `catalog.ts` quota short circuit, always build quota models; do not call `buildRoxPublicCatalog` / `scopeRoxPublicCatalogForKey` for `allowedQuotas.length > 0`:

```ts
if (earlyKeyMeta?.allowedQuotas && earlyKeyMeta.allowedQuotas.length > 0) {
  const { buildQuotaExclusiveModels } = await import("@/lib/quota/quotaCombos");
  const quotaModels = await buildQuotaExclusiveModels(
    earlyKeyMeta.allowedQuotas,
    combos,
    timestamp,
    (c) => buildComboCatalogMetadata(c, combos)
  );
  const quotaFinal = applyCatalogPostFilters(request, quotaModels, {
    connections,
    prefixMode,
    aliasToProviderId,
    hideNoThinkVariants: settings.hideNoThinkVariants === true,
  });
  return finalizeCatalogResponse(request, quotaFinal, () => undefined, {
    ...corsHeaders,
    ...diagnosticHeaders,
  });
}
```

`finalizeCatalogResponse` still strips OpenRouter, including `qtSd/<group>/openrouter/<model>`.

- [ ] **Step 4: Re-run the exclusion file**

Same command as Step 2. Expected: all tests in that file PASS, including the rewritten quota case.

- [ ] **Step 5: Commit on the gateway branch**

```bash
git add src/app/api/v1/models/catalog.ts tests/unit/rox-openrouter-catalog-exclusion.test.ts
git commit -m "$(cat <<'EOF'
fix(catalog): keep qtSd ids for quota keys in ROX public mode

Quota-exclusive keys must see callable pool ids. Advertising rox/* made
GET /v1/models disagree with validateQuotaAccess (QUOTA_ONLY).
EOF
)"
```

### Task 2: Isolated serialize-time OpenRouter strip

**Files:**
- Create: `tests/unit/catalog-response-openrouter-filter.test.ts`

**Interfaces:**
- Consumes: `finalizeCatalogResponse(request, finalModels, getContextFallback, headers)`
- Produces: OpenRouter-shaped row dropped even when the caller passed it in `finalModels`

- [ ] **Step 1: Write the failing isolated test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { finalizeCatalogResponse } from "../../src/app/api/v1/models/catalogResponse.ts";

test("finalizeCatalogResponse drops OpenRouter rows the caller forgot to filter", async () => {
  const request = new Request("http://127.0.0.1/v1/models");
  const finalModels = [
    { id: "openrouter/test", owned_by: "openrouter", root: "test", parent: null },
    { id: "glm/kept", owned_by: "glm", root: "glm/kept", parent: null },
  ];
  const response = await finalizeCatalogResponse(request, finalModels, () => 8192, {});
  const body = (await response.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(
    body.data.map((m) => m.id).sort(),
    ["glm/kept"]
  );
});
```

If `finalizeCatalogResponse` is not exported, export it (it already is).

- [ ] **Step 2: Run it**

```bash
npx cross-env DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm \
  --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts \
  --test --test-force-exit tests/unit/catalog-response-openrouter-filter.test.ts
```

Expected on a tree that already has the `catalogResponse.ts` filter: PASS. If the filter line is missing, FAIL. Do not delete the filter to force red; the red-green for this task is: comment the filter in a worktree, confirm FAIL, restore, confirm PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/catalog-response-openrouter-filter.test.ts
git commit -m "test(catalog): isolate finalizeCatalogResponse OpenRouter strip"
```

### Task 3: Master-key AC-01 path

**Files:**
- Modify: `tests/unit/rox-openrouter-catalog-exclusion.test.ts`

**Interfaces:**
- Consumes: env-var master key (`OMNIROUTE_API_KEY` / `ROUTER_API_KEY`) with no DB row
- Produces: `findOpenRouterEntries` empty for that request shape

- [ ] **Step 1: Add the fourth request-shape test**

Follow the existing unauthenticated `readCatalog` helper. Authenticate with the env master key used by `isValidApiKey`, without inserting a DB key row. Assert `findOpenRouterEntries(models)` is `[]` with OpenRouter stub installed and public mode off (the leak surface AC-01 names).

- [ ] **Step 2: Run the exclusion file.** Expected: PASS. If the `!keyMeta` branch ever iterates raw `models` again, FAIL.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/rox-openrouter-catalog-exclusion.test.ts
git commit -m "test(catalog): pin OpenRouter exclusion on env master key"
```

### Task 4: Catalog vs policy contract for quota keys

**Files:**
- Modify: `tests/unit/rox-openrouter-catalog-exclusion.test.ts` (or a sibling file)

**Interfaces:**
- Consumes: listed id from GET, then `enforceApiKeyPolicy` / `validateQuotaAccess`
- Produces: no `QUOTA_ONLY` for a listed `qtSd/*` id on that same key

- [ ] **Step 1: After reading the quota catalog, call policy on `models[0].id` with that key.** Assert rejection is null. Import the same policy helper chat uses, not a reimplementation.

- [ ] **Step 2: Run it.** Expected: PASS on the Task 1 production change; FAIL if someone restores `buildRoxPublicCatalog` for quota keys.

- [ ] **Step 3: Commit**

```bash
git commit -am "test(catalog): advertised quota ids must pass quota policy"
```

### Task 5: Focused suite + typecheck + patch export

**Files:**
- Verify only

- [ ] **Step 1: Focused suite**

```bash
npx cross-env DISABLE_SQLITE_AUTO_BACKUP=true node --import tsx/esm \
  --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts \
  --test --test-force-exit --test-concurrency=4 \
  tests/unit/rox-*.test.ts \
  tests/unit/openrouter-vision-sync-4264.test.ts \
  tests/unit/specialty-model-hidden-openrouter-9293.test.ts \
  tests/unit/catalog-response-openrouter-filter.test.ts
```

Expected: 0 fail. Record the `# tests` / `# pass` / `# fail` lines.

- [ ] **Step 2: `npm run typecheck:core`.** Expected: exit 0.

- [ ] **Step 3: Export a new patch** from `release/v3.8.50`..HEAD and copy into `rox-one` `docs/patches/` if write to `agisota/zed-api` is still denied.

- [ ] **Step 4: Commit the patch/docs on the handoff repo, not mixed with gateway history.**

### Task 6: Delivery (blocked on write + staging)

**Files:** none in this environment unless write appears

- [x] Open follow-up PR `hotfix/rox-catalog-honesty` -> `release/v3.8.50` on `agisota/zed-api` ([#4](https://github.com/agisota/zed-api/pull/4)). Exclusion itself already merged as [#2](https://github.com/agisota/zed-api/pull/2).
- [ ] Deploy that SHA to an isolated staging host (not `api.rox.one`, not the Swiss migration node).
- [ ] Smoke: unauthenticated `GET /v1/models` has no OpenRouter ids; quota key GET lists `qtSd/*` and POST of a listed id is not `QUOTA_ONLY`; process restart still serves the same catalog contract.

If write or staging is missing, stop and report the blocker. Do not claim AC-07/AC-08.

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Quota keys: callable `qtSd/*`, no `rox/*` | 1, 4 |
| OpenRouter absent on catalog paths | 1, 2, 3 (existing unauth/DB-key tests stay) |
| Isolated serialize-time strip | 2 |
| Master-key AC-01 | 3 |
| Policy agrees with catalog | 4 |
| Focused tests + typecheck | 5 |
| AC-07/08 | 6 |
| Tracks 2–3 | out of plan |

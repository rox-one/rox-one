# ROX-ONE Convergence Technical Specification

> **Status:** Evidence-bounded implementation specification; does not define external service APIs or prove product acceptance. **2026-10-08.**
> **Checkout:** `feat/convergence-20261007`, observed 288 commits ahead and 49 behind `origin/main` (`git rev-list --left-right --count origin/main...HEAD` prints behind then ahead). Do not treat this tree as `main`.
> **Toolchain observation:** Bun `1.4.2`; Node `v26.8.2`. Draft pins Bun `1.3.14` and Node `24.x` are historical documentation, not measurements or approval to change project pins. TypeScript `5.9.3` was not remeasured here.

## 1. Authority and evidence model

The PRD defines desired outcomes. This document specifies safe repository-local behavior and acceptance boundaries; actual implementation is established by current source inspection and exact-revision evidence only. Earlier topology diagrams, schema snippets, API examples, token/balance values and provider assumptions are withdrawn as normative contracts. Do not implement them as wire or database facts.

Statuses must distinguish: `IMPLEMENTED-LOCAL` (source present), `ALREADY-PRESENT` (source predates this work), `REMAINING`, `BLOCKED-EXTERNAL`, `UNVERIFIED`, `ACCEPTED`. Product acceptance requires observable runtime behavior on the integrated revision. An API/client type or mock is not live service acceptance; merge is not feature acceptance.

## 2. System boundaries

### 2.1 Repository-owned boundary

Repository-owned work may cover the current Electron/React desktop shell, local server/runtime, IPC/RPC transport, local storage, credential-store adapters, product-tour state and UI, and tests. Before modifying one, inspect its actual consumers, authority, persistence and failure handling; preserve current shell, routes, user data and unrelated work. Adapt existing seams rather than recreating historical architecture.

A local UI/client adapter may be prepared against an explicitly accepted interface, but must not make network calls to invented endpoints or infer provider responses. Unknown service availability is a visible blocked/unconfigured state, not fabricated success.

### 2.2 External service boundary

The following contracts are absent/unaccepted here and therefore outside implementation claims: OIDC discovery and issuer/client registration; Device Authorization Grant v2 protocol details; PKCE/state/polling/error semantics; token claims, refresh and revocation; JWKS algorithm/rotation/issuer/audience policy; account namespace/linking and email verification; signup credit; billing/reserve/settle/release and ledger semantics; OmniRoute credential issuance and inference charges.

**Gate:** before any service integration, authorized service owners must deliver versioned request/response/error contracts, compatibility and rollout expectations, credential/environment ownership, migration/rollback plan and test/live-acceptance environment. Keep secrets outside source and evidence. Implement only the supplied contract, then attach positive and negative live receipts. Until then label the capability `BLOCKED-EXTERNAL`; do not invent endpoint paths, payload fields, DB columns, token lifetimes, balances, keys, retry behavior or credentials.

## 3. Repository-local behavior contracts

### 3.1 Navigation and appearance

- Use the current application shell and route registry as source of truth; do not revive a historical secondary sidebar or replace current routes from a donor branch.
- Keyboard navigation must respect current focus, disabled/hidden destinations and platform conventions. Verify focus placement/return, route state, no duplicate surface ownership and accessible names in actual DOM.
- Theme/geometry tokens are design inputs, not accepted requirements until verified against current consumers and approved product intent. Theme changes preserve existing settings and have truthful fallback if native material is unavailable.
- Acceptance: actual current production components; relevant route/keyboard tests; actual macOS/Windows/web rendering on named target; light/dark, narrow layout, focus, contrast and reduced-motion cases. A stylesheet diff or screenshot of a mock is insufficient.

### 3.2 Product tour

- A step can complete only from its declared real user/domain outcome. Do not synthesize clicks to advance.
- Persisted state must distinguish not-started, in-progress, skipped and completed using current storage/profile authority; errors or missing services cannot produce completed state.
- Navigation, user cancellation, missing targets, repeated events and remount/restart must not duplicate or falsely complete steps.
- Acceptance: fresh profile and actual tour; per-step action/target/expected/observed; skip/reopen/restart; unavailable/error/retry/cancel; accessibility/focus and locale; prove a rejected/missing action does not advance. Existing test count (including the draft's “304”) is not proof by itself.

### 3.3 Local credentials and session security

- Keep renderer-facing data metadata-only; secrets remain within the established trusted main/service boundary.
- Local vault failures must follow currently approved custody policy and remain visible; no weaker plaintext or guessed fallback. Any encrypted fallback must have a defined key custody, atomic write, permissions, recovery and migration contract before use.
- Logout/revocation must not delete local workspace data unless a separate explicit, approved operation says so. Denied or stale async responses cannot re-establish authority after workspace/account change or unmount.
- Acceptance: exact integrated source; positive and negative authorization, cross-account/workspace, stale callback, duplicate/concurrent callback, logout/revoke, storage unavailable/corrupt/rotation and secret-redaction tests; independent security review. Static scan alone is insufficient.

### 3.4 Process and MCP lifecycle

- Child startup/close and stdio handling must settle through success, error, cancellation and shutdown. No resource, credential or output is leaked to an unrelated scope.
- Unconfigured optional integrations may be represented honestly without blocking unrelated startup; do not hide required service failures or claim provider readiness.
- Acceptance covers child exit and pipe draining under full/slow output, abrupt close, spawn failure, cancellation and bounded shutdown; actual MCP registration/config and current source ownership. Keep packaged/native OS acceptance distinct from unit/source evidence.

## 4. PR provenance and branch integration

Supplied PR state snapshot: #1448, #1481, #1496, #1497 are reported merged; #1469 and #1486 are open drafts. This is not independently refreshed here. Exact gates and scope are maintained in the [implementation plan](../plans/rox-one-convergence-plan.md). Every PR requires exact URL/state/head/base/merge SHA and parents, changed paths, required check runs/results, and proof that intended content is present in candidate and target `origin/main`.

A reviewed PR is the integration path. Preserve dirty/user-owned work and baseline. Never reset/clean/force-push, overwrite a worktree, or directly merge this 288-ahead/49-behind feature checkout wholesale into `main`. Resolve one owned slice at a time after fetching/reconciling main; obtain independent review, run required changed-scope verification on exact candidate, and read back the exact remote merge commit. Missing provenance/checks, stale head, unresolved conflict or unexplained user diff blocks integration.

## 5. Verification receipts

Each result records exact source revision/tree, command or user-visible action, environment/tool versions, expected/observed outcome, exit/result, evidence location and limitations. Keep these claims separate:

1. source present locally;
2. source/check present in merged target;
3. unit/type/build verification;
4. actual product UI/tour behavior;
5. platform behavior (macOS, Windows, web as applicable);
6. authorized live service/provider result;
7. authorized deployment.

Security and product tour receipts must be bound to the exact integrated source and include negative controls. A stale PR check, synthetic fixture/readback, local screenshot, anonymous health response or source-only test cannot promote another evidence class.

### 5.1 Observed receipts — session-owned test/locale slice (2026-10-08)

Bound to the working tree on `feat/convergence-20261007` while foreign sessions concurrently wrote the same tree; evidence class 3 (local checks) only — no product/platform/service acceptance is implied. Slice content is contained in commit `385aaf59d`; gates re-verified at frozen revision `3fd43af8c` (worktree clean).

- Wave-A regression batch (8 test files, including the repaired `runtime-map-panel-reconcile.test.ts`): `29 pass / 0 fail`, 131 expects, `[1494.00ms]`, exit 0.
- `native-file-dialog.browser.test.ts` standalone on a quiet tree: `10 pass / 0 fail [35.82s]`, exit 0.
- Locale gates: `lint:i18n:sorted` exit 0; `lint:i18n:coverage` exit 0; `lint:i18n:parity` exit 1 with 128 missing keys in each of `ar`/`ko` (`notes.*` 93, `apiSetup.*` 15, `onboarding.*` 14, `memory.*` 6), all in foreign-owned groups; own groups (`automations.context.`, `inspector.`, `navigation.`) have 0 missing keys.
- New macOS-executable test infrastructure: `apps/electron/src/renderer/test-utils/chromium-executable.ts` (environment-aware Chromium resolution for the browser-test harness).
- Product-tour suite on a verified quiet tree: phase 1 (`features/product-tour`, 35 files) `405 pass / 1 fail` — the sole failure is the foreign `VoiceDictationControl` defect; phases 2–4 standalone `8/0`, `5/0`, `4/0` (exit 0 each); `native-ui.browser.test.ts` standalone `8/0` exit 0. Whole-script exit 0 is not claimed while the foreign defect stands.
- Foreign regressions recorded, not patched: `VoiceDictationControl.tsx` stranded `starting` on denied microphone (owner-side fix recorded in the plan §7.2); earlier suite runs were interrupted by concurrent foreign source writes via the input-change guard (`hookFailed: Renderer input changed`), which is why the quiet-tree rerun was required.

## 6. Deployment and operator contract

This repository does not authorize deployment. Before an operator action, require named operator approval, target/environment/change window, artifact/source provenance, deployment prerequisites, protected backup/rollback point and a tested/executable rollback plan. After the action capture an immutable sanitized receipt binding source commit/tree and artifact digest/version to target/environment, operator and timestamps, approval, deployed observation/health/smoke result and rollback readiness/result. No artifact digest, approval, receipt or rollback path means `BLOCKED`, not deployed.

## 7. Explicit non-claims

No completion is claimed for Device Flow v2, OIDC, JWKS validation, account linking, welcome credits, transactional billing, or OmniRoute credential provisioning absent accepted service contracts and live acceptance. No global test/build/platform gate is claimed by this documentation work. Do not publish secrets, raw tokens, user data or private credentials in code, PRs or receipts.

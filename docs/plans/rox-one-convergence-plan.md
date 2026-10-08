# ROX-ONE Convergence Plan — Evidence-Bounded Execution

> **Status:** Active safe-recovery plan; all work and product/release acceptance remain incomplete unless an exact receipt below establishes otherwise. **2026-10-08.**
> **Checkout:** `feat/convergence-20261007`; `git rev-list --left-right --count origin/main...HEAD` observed `49 288` (49 behind, 288 ahead). Do not assume this branch equals target `main`.
> **Worktree:** preserve all user-owned changes. At initial inspection this checkout had changes across source/tests/docs and an untracked DPAPI regression test; the shared worktree later changed during concurrent work. Re-capture `git status` and owned diff before acting; never clean/reset/overwrite or treat a later clean status as permission to discard prior work.
> **Toolchain:** observed Bun `1.4.2`, Node `v26.8.2`; old plan pins Bun `1.3.14`, Node `24.x` are historical. This observation alone does not change project pins. No tests/build/format were run for this doc task.

## 1. Safety and execution rules

1. No direct or wholesale merge of this feature branch to `main`. No force push, reset, clean, branch overwrite, or destructive resolution. Integrate owned slices through a reviewed PR after reconciling with current remote `main`.
2. Do not call a merged PR “accepted” without exact provenance and content verification. Do not call local source “merged” or “deployed.”
3. Keep implementation and acceptance separate. Repo-local work may proceed only against observed current code/callers and accepted local contracts. External services and operator work require explicit prerequisites; no guessed contracts or credentials.
4. Every status has one of `IMPLEMENTED-LOCAL`, `ALREADY-PRESENT`, `REMAINING`, `BLOCKED-EXTERNAL`, `UNVERIFIED`, `ACCEPTED`. `ACCEPTED` requires evidence for the complete named criterion on exact integrated source and target.
5. Every implementation task owns exact paths. Shared routes, schemas, registries, localization catalogs, lockfiles and common UI have one owner at a time. Preserve dirty user work and retain baseline/failure evidence.

## 2. Exact PR gates

Status below is the supplied snapshot, not a newly fetched GitHub state. Before integration or closure, capture URL, state/draft, exact head SHA, base SHA, merge SHA and parents, changed paths, required check names/IDs/SHAs/results, and verify intended blobs in both candidate and target `origin/main`.

| PR | Reported state | Scope gate | Stop condition |
|---|---|---|---|
| #1448 | Merged | Reconcile exact provenance and intended route/resource/runtime/toolchain changes. Verify accepted current files in target `main`; run affected source and packaged-resource/pre-spawn/OS negative controls on exact candidate; separate native packaging/platform acceptance. | Stale/mismatched head, missing checks/content or untested platform-sensitive behavior. |
| #1469 | Open draft | Resolve current-main diff/conflicts and owner scope. Verify theme selection/persistence and cross-window behavior, geometry/hit-target/keyboard/accessibility, light/dark and actual native material behavior on named macOS/Windows targets. Complete required checks; owner promotes, merges, and target content is read back. | Remains draft, unresolved conflict, unknown ownership or absent real platform evidence. |
| #1481 | Merged | Reconcile exact provenance and execute its complete UI-001 route/read/recovery matrix on integrated source, retaining every scenario/negative-control result and evidence mapping. | A bounded screenshot/smoke or merged state substitutes for full matrix. |
| #1486 | Open draft | Reconcile navigation-rebuild head/base/checks and current-main conflicts. Re-run final native refresh/UI acceptance. Resolve deployment provider status; previously recorded Vercel status “Account is blocked” is an external blocker, not successful deployment. Promote/merge/read back exact merge only after owner approval. | Stale CI head, synthetic data readback in place of native UI, blocked deployment or missing exact artifact receipt. |
| #1496 | Merged | Reconcile exact provenance and intended workspace/data-model scope; inspect actual consumers, identity/persistence/auth behavior, migration compatibility and rollback where applicable. Verify model source and behavior on candidate and target. | Blindly cherry-picking “only models,” unreviewed schema change or no migration/rollback evidence. |
| #1497 | Merged | Reconcile exact provenance and stdio/subprocess lifecycle scope. Verify slow/full output, child close/exit, cancellation, spawn failure and cleanup without hangs or secret/output leakage on exact integrated runtime; native packaging remains separate. | Merged state or a happy-path test used as end-to-end/native acceptance. |

Any remote state different from this snapshot must be recorded with observation time and evidence; update this table before acting. No status alone authorizes code movement.

## 3. Draft task disposition and executable closure

The earlier seven-task draft contained stale branch commands, unsupported service contracts and unsafe direct merge/tag steps. The map below keeps its intent but supplies current status and exact closure evidence.

| Draft item | Current disposition | Work / dependency | Exact closure evidence |
|---|---|---|---|
| 1. Preflight/baseline | **Superseded; remaining.** The current checkout is divergent and dirty-state evidence changed during shared work. Do not manufacture a clean baseline. | Integration owner inventories current refs, all dirty/untracked changes, provenance and task/file ownership. Preserve copies/receipts without touching user content. Fetch/reconcile remote only in a non-destructive authorized workflow. | Timestamped status/diff and baseline commit/tree; exact `origin/main` SHA; branch ahead/behind and PR table with remote SHAs/checks; preservation confirmation for pre-existing user work. |
| 2. UI shell/themes/navigation | **Partly implemented/already present locally; exact accepted scope unverified.** Current source must be inspected; no claim that old PR branches describe current consumer behavior. | Inspect the actual shell, route registry, theme/settings consumers and owned dirty diff. Reconcile #1469/#1486 and relevant #1481/#1496/#1497 overlap. Implement only an identified gap with one owner. | Source revision and files; focused route/keyboard/accessibility/theme/persistence controls; real macOS/Windows/web product tour as applicable (OS/device, exact build, expected/observed screenshots/logs); PR provenance. |
| 3. Auth security and vault | **Local portions may exist; auth service flows externally blocked.** Do not implement endpoint/payload/JWKS/billing guesses. | Inspect current vault, session, callback and credential boundaries. Remediate only evidenced repo-local defects. Service integration waits on Section 4 prerequisites. | Independent security review of exact candidate; positive/negative authorization, cross-workspace/account, concurrency, logout/revocation, vault failure/corruption/rotation and secret-redaction evidence; service-contract/live receipts if claiming external flow. |
| 4. Product tour | **Remaining / acceptance unverified.** A test-count claim or catalog is insufficient. | From fresh supported profile, execute the real tour against live product screens; document per-step real action/domain trigger and outcome. Keep missing targets/errors truthful; no synthetic advancement. | Per-step action, target, expected/observed; skip/complete/reopen/restart; denial/error/retry/cancel; keyboard/focus/locale/reduced-motion; proof a missing/failed action does not advance; exact build/revision and sanitized evidence. |
| 5. CTN/RUS governance | **Artifact already present locally (`docs/governance/ctn-rus-matrix.md`); governance acceptance remains unverified.** | Reconcile source IDs, owners, task state, provenance, license/rights and open decisions; retain source-specific status. Do not edit that file under this docs/specs-and-plans-only assignment. | Readback/review record with verified references and unresolved gaps; no claims beyond documented source evidence. |
| 6. Convergence to main | **Unsafe old procedure withdrawn; remaining.** Never check out `main` and merge several local branches directly. | One integration owner stages only reviewed/owned changes; preserve user overlay; reconcile exact base; review candidate diff; resolve conflicts explicitly; run required changed-path checks; obtain independent review; merge via approved reviewed PR path. | Candidate source/tree, paths/ownership, preservation record, review/check receipts, PR SHA/base/merge parents, and exact target readback proving expected content/behavior. |
| 7. Post-merge/release | **Not authorized / not accepted.** Do not create a release tag or claim production. | After integration, close product/platform/security/service gates. Deployment only with named operator approval, exact environment and rollback readiness. | Receipt binds source commit/tree, PR merge SHAs, artifact digest/version, toolchain, checks and platform/product/security evidence, operator approval/name, target/environment, deployment timestamps/result, health/smoke observation, rollback point/procedure/result and sanitized logs. |

## 4. Backend/service/operator prerequisites

The repository and draft do not establish contracts for Pocket ID OIDC discovery/issuer/client registration; Device Flow v2 endpoints and PKCE/polling/errors; JWKS algorithms, rotation, issuer/audience/claims; token refresh/revocation; identity namespace/account linking/email verification; welcome credit; billing/ledger reserve/settle/release; or OmniRoute credential issuance/provisioning.

Before implementing or claiming any of these, the authorized service owner must supply: versioned protocol/error and compatibility contract; credential and environment ownership/access; data migration/idempotency/rollback requirements; security threat/rotation expectations; live test environment; and authorized acceptance procedure. Do not invent any credential, issuer/key, endpoint, field, balance, lifetime, retry rule or migration. Until supplied and verified live, report each as `BLOCKED-EXTERNAL`, not “implemented” or “complete.” Operator deployment additionally requires explicit approval, target/change window, artifact provenance, protected rollback point and receipt.

## 5. Required independent acceptance gates

### Product-tour gate

Run every required step in the actual current app on a fresh profile. Capture revision/build, target screen, user action, real domain event, expected/observed, persisted state after navigation/reopen/restart, skip/complete semantics, failure/retry/cancel behavior and accessibility. Verify no fake click, missing target, service denial or exception yields completion. Retain per-step results, not aggregate “tour passed.”

### Platform gate

Keep separate evidence for macOS native, Windows native and hosted/web where required. Each evidence record names the actual runner/device, OS/version, app version/build digest, exact source revision, scenario, expected/observed result and sanitized logs/screenshots. One platform cannot substitute for another; unavailable target is `BLOCKED` with prerequisite/owner.

### Security gate

Independent reviewer examines exact integrated revision and threat boundaries. Exercise valid/invalid auth, cross-account/workspace denial, callback state/race/duplicate, stale async response after switch/unmount, logout/revoke, credential custody/rotation and vault unavailable/corrupt/recovery; verify secrets do not cross renderer/log/document boundaries. Fixtures/static analysis are bounded evidence only. OIDC/JWKS/Device Flow live claims require accepted service contract and live provider evidence.

### Provenance and deployment receipt

Before deployment record PR source and merge SHAs/parents/checks, candidate source/tree, artifact digest/version and build provenance; record explicit operator authorization, target/environment/change window, backup/rollback point and tested rollback procedure. After deployment record operator, timestamps, deployed digest/version, observed health and real product smoke, outcome and rollback status. Scrub credentials/user content. Missing required field blocks deployment acceptance. This plan grants no production mutation authorization.

## 6. Execution sequence and failure handling

1. Preserve current worktree and reconstruct exact PR/source/status inventory. Unknown ownership or missing provenance blocks changes.
2. Inspect current implementation and consumers. Mark draft item `IMPLEMENTED-LOCAL`, `ALREADY-PRESENT` or `REMAINING` only with specific source/status evidence; local presence is not accepted behavior.
3. Resolve service contracts and operator prerequisites; external blockers do not stop independent repo-local work but may not be silently substituted.
4. Implement one bounded owned slice; record interface and failures. Run only its required verification when the authorized implementation owner does so; bind results to exact revision.
5. Independently review security/scope, reconcile current `main`, integrate through reviewed PRs serially, verify merge readback and expected files/behavior.
6. Execute full product tour, each applicable platform and issue-specific acceptance on the exact integrated revision.
7. Perform authorized deployment only after all applicable gates pass; capture immutable provenance/deployment receipt; release owner makes separate tag/release decision.

On conflict, missing check, provider failure, permission denial, unavailable platform, data migration risk, stale artifact, missing approval or rollback failure: retain evidence and status as `FAIL`/`BLOCKED`/`UNVERIFIED`; stop dependent work. Never suppress a failure, weaken acceptance, merge around it or report a partial pass as complete.

## 7. Observed worktree receipts — session-owned test/locale slice (2026-10-08, 05:00–06:20 MSK)

Scope: this section records slice-level receipts on the `feat/convergence-20261007` working tree while several foreign sessions were concurrently writing the same tree. It does not promote any Section 3 item above its recorded status and is evidence class “source-local checks” only — not product, platform, security or service acceptance. A concurrent integration session folded the slice (including these docs) into commit `385aaf59d`; the re-checked frozen revision is `3fd43af8c` (worktree clean, 2026-10-08 06:16 MSK).

Session-owned paths: 11 test-infrastructure files under `apps/electron/src/renderer/features/product-tour/**`; `apps/electron/src/renderer/test-utils/chromium-executable.ts` (new; environment-aware Chromium resolution: `LEARNING_CHROMIUM_PATH` → `CHROMIUM_EXECUTABLE` → `ROX_BROWSER_PATH` → `/usr/bin/chromium` → Playwright bundled binary, consumed by 10 browser-test call sites); `apps/electron/src/main/__tests__/pocket-account-store-dpapi.test.ts` (new; DPAPI portability so the suite is executable on macOS); 12 locale catalogs `packages/shared/src/i18n/locales/*.json` (own key groups only).

| Check | Command / scope | Result | Evidence |
|---|---|---|---|
| Wave-A regression batch (8 files incl. `runtime-map-panel-reconcile.test.ts`) | `bun test` on the 8 listed test files | `29 pass / 0 fail`, 131 expects, `[1494.00ms]`, exit 0 | `/tmp/wavea-final.log` |
| `native-file-dialog.browser.test.ts` standalone (quiet tree) | `bun test …/native-file-dialog.browser.test.ts` | `10 pass / 0 fail [35.82s]`, exit 0 | `/tmp/filedialog-rerun.log` |
| i18n sorted | `bun run lint:i18n:sorted` | exit 0 | `/tmp/i18n2-sorted.log` |
| i18n coverage | `bun run lint:i18n:coverage` | exit 0 | `/tmp/i18n2-coverage.log` |
| i18n parity | `bun run lint:i18n:parity` | exit 1 — `ar.json`/`ko.json` each 128 keys missing, all foreign-owned (7.2 item 1) | `/tmp/i18n2-parity.log` |

Own i18n groups verified complete in `ar`/`ko`: `automations.context.` 27/27, `inspector.` 71/71, `navigation.` 156/156; missing in own groups = 0.

### 7.1 Product-tour suite runs (final quiet-window result)

`bun run test:product-tour` is an `&&` chain whose first phase (`bun test apps/electron/src/renderer/features/product-tour`, 35 files) must pass before phases 2–4 run. Run 1 `400 pass / 6 fail` (`/tmp/pt-suite.log`) and run 2 `397 pass / 9 fail` (`/tmp/pt-suite-rerun2.log`) were disturbed mid-flight by concurrent foreign source writes (run 2: `hookFailed: Renderer input changed — packages/ui/src/components/annotations/block-markers.ts`, 05:02:18 MSK). Final run on a verified quiet tree (0 source writes in the preceding 10 minutes): **phase 1 `405 pass / 1 fail`** (`/tmp/pt-suite-rerun3.log`) — the single failure is the foreign `T-VOICE-HANDOFF` “denied microphone permission” case (7.2 item 2); all `native-file-dialog` cases pass. Phases 2–4 were then executed standalone and passed: `product-learning-input.browser.test.ts` `8 pass / 0 fail` exit 0 `[9.73s]`; `product-tour-layers.test.ts` `5 pass / 0 fail` exit 0 `[129.00ms]`; `native-process.test.ts` `4 pass / 0 fail` exit 0 `[844.00ms]` (`/tmp/pt-phases234.log`); `native-ui.browser.test.ts` standalone `8 pass / 0 fail` exit 0 `[3.65s]` (same log). A whole-script exit 0 cannot be observed while the foreign dictation defect stands; phase 1 is otherwise fully green.

### 7.2 Foreign-attributed observations (record only — do not patch from this slice)

1. **i18n parity gap — 128 keys missing in each of `ar.json`/`ko.json`.** Exact groups: `notes.document` 44, `notes.comments` 24, `notes.slash` 21, `apiSetup.*` 15, `onboarding.providerSelect` 8, `memory.ruleType` 4, `notes.inspector` 4, `onboarding.localProfile` 4, `onboarding.credentials` 2, `memory.onboardingAddAnother` 1, `memory.onboardingCustomLabelPlaceholder` 1. Referenced by other workstreams’ sources (`APISetupStep.tsx`, `ProviderSelectStep.tsx`, `onboarding-rule-model.ts`); the locale files carry a concurrent foreign layer (rewritten 04:23 and 04:39 MSK). Owner: locale/onboarding workstream. This slice must not translate or patch these keys.
2. **`VoiceDictationControl.tsx` stranded in `starting` on denied microphone.** Foreign worktree edit (mtime 04:20:59 MSK) nulls `activeDictationOwner` before the `isCurrentCapture(captureId)` guard in the `startRecording` catch; the guard then fails, `setStarting(false)` never runs, the control stays `busy` (label `common.loading`, disabled). Deterministic failure of the `T-VOICE-HANDOFF` “denied microphone permission” case. Owner-side fix: keep `activeDictationOwner` non-null until after the guard, or reset `starting`/cancel unconditionally in the catch.
3. **`NavigationContext.tsx` `reconcileFromUrlParams` collaborator drift (mtime 04:19:05 MSK).** Foreign edit added `workspaceId`, `panelStackAtom`, `primaryPanelIdAtom` and `decodeToolContexts` usage plus a `store.get(panelStackAtom)` read to the callback. The session-owned transcription fixture `runtime-map-panel-reconcile.test.ts` was updated test-side (bind the new collaborators; store stub handles the `primaryPanelIdAtom` write); 4/4 individually, Wave-A 29/0 after.

### 7.3 Broad local runs at frozen revision `3fd43af8c`

- `bun run typecheck:all`: exit 0, all packages (`/tmp/typecheck-all.log`).
- `bun run test` (`scripts/test-all.ts`, serial, 2051 suites, 1682 s): **1882 passed / 132 failed / 37 blocked** (`work/test-all/run-2C21KU/report.json`). No baseline run of this runner exists, so the classes below are failure-mode attributions, not diffs. Classes: 30 browser suites fail `No Chromium executable found` under the runner’s isolated `HOME` — the same convention CI satisfies by exporting `CHROMIUM_EXECUTABLE`/`ROX_BROWSER_PATH`/`LEARNING_CHROMIUM_PATH` (`.github/workflows/product-tour-native.yml:74`); 20 of the 30 are outside this session’s slice and use their own inline env-only resolution; 16 external-service (Postgres/DB) suites; 11 e2e Playwright specs; 9 timeouts; 6 foreign syntax/reference breakages; 58 mixed assertion failures in other workstreams’ areas (native notes/runtime, action-label i18n, app-shell); 2 Playwright launch errors. Blocked 37 = vendored skill directories without a local Vitest install. Session-owned suites in this run: `pocket-account-store-dpapi.test.ts`, `pocket-account-store.test.ts`, `runtime-map-panel-reconcile.test.ts` passed; slice browser suites appear only in the Chromium-env class; the known foreign `VoiceDictationControl` case is the sole slice-adjacent functional failure.

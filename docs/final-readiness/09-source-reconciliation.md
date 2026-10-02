# [RECONCILIATION] Canonical ROX source, progress and remaining work

Captured source state: 2026-10-02T22:56:35.644Z. Main baseline: `f63294ba4fffa7238b46b24e918925a313ad0b12`. Independently tested assembled candidate: `de805e0dc7103b49d4c7f0a092d88c8b4222367a` ([PR1322](https://github.com/rox-one/rox-one/pull/1322)). The previous main-only report is historical evidence; this report reconciles accumulated product work across source lines.

## [RECON-SOURCE] Correct repository and audit branch

- Canonical product and delivery destination: [rox-one/rox-one](https://github.com/rox-one/rox-one).
- Isolated documentation checkout: `/Users/t/Projects/rox-one-reconciled-audit-20261003`.
- Branch: `audit/reconciled-readiness-2026-10-03`, created directly from canonical `origin/main`.
- The earlier agisota/craft-agents-oss document is an older main-only audit artifact in the existing fork network; it is not the canonical accumulated ROX product source. Its original baseline/evidence is preserved here with explicit scope.
- Application branches and dirty product worktrees are preserved. Publishing this audit does not merge product implementations or create signed/deployed releases.

## [RECON-COVERAGE] Source coverage and evidence meaning

| Inventory | Captured quantity | Meaning |
| --- | ---: | --- |
| Local plus fetched origin refs | 779 | Every ref enumerated; aliases are retained. |
| Unique source heads | 735 | Deduplicated by immutable commit. |
| Heads outside main ancestry | 609 | Includes old squash-merged/rejected work and five unrelated histories; not a count of missing features. |
| Open PRs | 17 | Head/base, draft/conflict state and check scopes captured. |
| PR history records | 928 | GitHub all-state query returned17 open,602 merged,309 closed. Branch-name matches are discovery evidence. |
| Registered/current plus previous audit checkouts | 6 | Includes this audit and the clean test candidate; dirty path/status metadata only. |
| Original task blocks reconciled | 495 | Every original parent/subtask has source progress, remaining work and evidence limits. |
| Added task blocks | 123 | New feature hosts, service contracts and integration/test/recheck tasks. |

**Coverage is explicit:** all catalogued refs receive ancestry, changed paths, PR-name matches and original-task file ownership discovery. Semantic review concentrates on the active accumulated ROX candidates and source owners; path overlap alone is never interpreted as completed implementation. Historical/closed/unmatched branches have a required patch/behavior disposition under RECHECK-004.1. No claim is made that every old experiment was independently run.

The [complete branch catalog](reconciliation/branch-catalog.json) and [raw source snapshot](evidence/progress-snapshot.json) make all source lines inspectable. [PR history](evidence/pull-request-history.json) distinguishes merged, closed and open records; merged PR status does not alone establish current feature preservation. Private deployments, external submodule contents and provider account operations are outside this source inventory. The separate local registration audit belongs to rox-one-website and is not a ROX application checkout.

## [RECON-PRS] Every open pull request

| PR | Source head | Base | State | Observed checks |
| --- | --- | --- | --- | --- |
| [#1323 fix(projects): fence workspace and load generations ](https://github.com/rox-one/rox-one/pull/1323) | `ops/use-projects-scope-repair-20260930` / `3cc2483d61e5` | `cloud/all-surfaces-20260930` | Draft; CONFLICTING/DIRTY | SUCCESS, FAILURE |
| [#1322 R15: assemble UI, September and scoped Compound surfaces ](https://github.com/rox-one/rox-one/pull/1322) | `cloud/all-surfaces-20260930` / `de805e0dc710` | `main` | Draft; MERGEABLE/UNSTABLE | CANCELLED, SUCCESS, FAILURE, SKIPPED |
| [#1321 Restore styling and left navigation in current ROX build ](https://github.com/rox-one/rox-one/pull/1321) | `fix/rox-sidebar-launch-20260930` / `2c7a1fb01ec1` | `main` | MERGEABLE/UNSTABLE | CANCELLED, SUCCESS, FAILURE |
| [#1320 Reconcile unfinished ROX sessions and verified recovery delivery ](https://github.com/rox-one/rox-one/pull/1320) | `ops/rox-session-recovery-20260930` / `a69187c60989` | `main` | Draft; MERGEABLE/UNSTABLE | CANCELLED, SUCCESS, FAILURE |
| [#1319 Fix SQLite runtime compatibility on current September native source ](https://github.com/rox-one/rox-one/pull/1319) | `fix/september-sqlite-runtime-20260930` / `bdd28272856b` | `feat/september-program-20260930` | Draft; CONFLICTING/DIRTY | CANCELLED, SUCCESS, FAILURE |
| [#1318 fix(bases): validate inert own data at reference boundaries ](https://github.com/rox-one/rox-one/pull/1318) | `fix/utb-reference-strictness-20260930` / `8c1b8d95944c` | `feat/unified-tables-baserow-20260930` | Draft; MERGEABLE/UNSTABLE | CANCELLED, FAILURE, SUCCESS |
| [#1317 Restore main core and hosted CI validation with real server lifecycle proof ](https://github.com/rox-one/rox-one/pull/1317) | `fix/cloud-core-ci-recovery-20260930` / `bbb30156a075` | `main` | Draft; MERGEABLE/UNSTABLE | SUCCESS, FAILURE |
| [#1316 Inspect legacy Markdown migration state without activating native writes ](https://github.com/rox-one/rox-one/pull/1316) | `feat/compound-native-migration-fence-20260930` / `8afd289ac9e7` | `feat/rox-compound-workspace-20260930` | Draft; MERGEABLE/UNSTABLE | CANCELLED, QUEUED, FAILURE, SUCCESS |
| [#1315 fix(runtime): unblock Bun SQLite startup with safe durable operations ](https://github.com/rox-one/rox-one/pull/1315) | `fix/cloud-sqlite-runtime-20260930` / `450454908601` | `fix/webui-bridge-recovery-20260930` | Draft; MERGEABLE/UNSTABLE | CANCELLED, SUCCESS, FAILURE |
| [#1314 [UTB v2] Единые таблицы: 23 поверхности, свойства, формулы, UI/UX и verification gates ](https://github.com/rox-one/rox-one/pull/1314) | `feat/unified-tables-baserow-20260930` / `8619f908bcdb` | `main` | Draft; MERGEABLE/UNSTABLE | CANCELLED, SUCCESS, FAILURE |
| [#1313 feat(projects): recover roadmap with revision-safe saves ](https://github.com/rox-one/rox-one/pull/1313) | `fix/roadmap-recovery-20260930` / `5a9bf9cafd7d` | `main` | Draft; MERGEABLE/UNSTABLE | CANCELLED, SUCCESS, FAILURE |
| [#1294 fix(webui): expose optional native host-control types to shared renderer ](https://github.com/rox-one/rox-one/pull/1294) | `fix/webui-bridge-recovery-20260930` / `5f0df2522346` | `wip/september-cloud-snapshot-20260930` | Draft; MERGEABLE/UNSTABLE | CANCELLED, FAILURE, SUCCESS |
| [#1293 Integrate September native data, startup and runtime recovery ](https://github.com/rox-one/rox-one/pull/1293) | `feat/september-program-20260930` / `8f43e92d2a27` | `main` | Draft; MERGEABLE/UNSTABLE | QUEUED, SUCCESS, FAILURE, SKIPPED |
| [#1292 fix(core): restore cloud baseline tests and canonical type guards ](https://github.com/rox-one/rox-one/pull/1292) | `fix/cloud-core-baseline-20260930` / `01889b4a43a2` | `main` | MERGEABLE/UNSTABLE | CANCELLED, SUCCESS, FAILURE |
| [#1230 Fix OMP routing and transport, Projects data and Tasks note links ](https://github.com/rox-one/rox-one/pull/1230) | `feat/rox-program-20260930` / `f32863be2d22` | `main` | Draft; MERGEABLE/UNSTABLE | CANCELLED, SUCCESS, FAILURE |
| [#1087 build(deps): bump the npm_and_yarn group across 2 directories with 1 update ](https://github.com/rox-one/rox-one/pull/1087) | `dependabot/npm_and_yarn/apps/electron/npm_and_yarn-5f8b2b104c` / `2e444a1e7fb6` | `main` | MERGEABLE/UNSTABLE | CANCELLED, SUCCESS, FAILURE |
| [#1082 fix(shell): labelled activity rail expanded by default + no onboarding on transient startup RPC failure ](https://github.com/rox-one/rox-one/pull/1082) | `fix/rail-expanded-onboarding` / `518636a6cb6c` | `main` | MERGEABLE/UNSTABLE | CANCELLED, SUCCESS, FAILURE |

## [RECON-LOCAL] Dirty and clean source checkouts

| Checkout | Captured commit | Dirty path entries | Role / treatment |
| --- | --- | ---: | --- |
| `rox-one` | `f63294ba4fff` | 2 | Existing product/audit work preserved; uncommitted code is not credited as remote implementation. |
| `rox-one-compound-implementation` | `d141e962185f` | 92 | Existing product/audit work preserved; uncommitted code is not credited as remote implementation. |
| `rox-one-recheck-candidate-20261003` | `de805e0dc710` | 0 | Isolated clean candidate before checks; only own generated build outputs. |
| `rox-one-reconciled-audit-20261003` | `f63294ba4fff` | 34 | Generated audit work; excluded from product progress. |
| `rox-one-september-implementation` | `8f43e92d2a27` | 2 | Existing product/audit work preserved; uncommitted code is not credited as remote implementation. |
| `rox-one-final-audit-20261003` | `9fca38a52d34` | 42 | Existing product/audit work preserved; uncommitted code is not credited as remote implementation. |

These counts are a dated capture, not a promise that concurrently active worktrees stopped changing. Only paths/status were copied, no uncommitted file contents or credentials. Commit selection must recheck live worktree state.

## [RECON-FINDINGS] Material progress credited and work still open

1. **Compiler baseline improved materially:** candidate root typecheck passes and16/18 independent workspace checks pass; the older11/17 failure claim applies only to main. Viewer and messaging-gateway remain failing.
2. **Durable authority/state exists on branches:** native journal, single-writer Notes, encrypted replica outbox, scoped sync, scheduler occurrence state and budgets receive source/recorded-check credit. Complete hosted account identity and all-module synchronization remain separate work.
3. **Product surfaces expanded:** Search, roadmap/OKR, repository snapshots/context, shared native projections, Notes properties/Outline,23 UTB hosts and legal evidence are now explicitly covered. UTB01 codec is implemented; the23-host/grid/formula plan is not completed by that codec.
4. **Lineages must preserve features:** September is not a superset of the assembled cloud/Compound product. Whole-file imports can delete retained routes and supporting source. Integration requires contract/behavior comparison.
5. **Concrete Notes defects remain:** missing property-remove handler and header/body Folder mismatch have exact source references and acceptance steps.
6. **Built server is toolchain-sensitive:** Bun1.3.14 passes the real built lifecycle; Bun1.4.2 fails before readiness with exports_tmp undefined despite successful build.
7. **Existing browser evidence is bounded:** retained exact010 receipts cover99 browser passes,11 supplemental auth passes,22 routes,22 settings and64 screenshots; independent review records175 console errors, including denied/missing channels. These are earlier fixture receipts, not new installed native/live-provider acceptance.
8. **Release gaps remain:** Windows/native staging, Mac signing/artifact/update identity, Docker manifests, real browser uploads/capabilities, cloud execution truth, live providers, installed-target qualification and deployment evidence are still in the backlog.

## [RECON-ORDER] Practical implementation and qualification order

1. Select and pin one feature-preserving integrated candidate (INT-016), preserving active dirty work separately (INT-017/018).
2. Fix remaining workspace/toolchain failures (QA-011) and make actual CI coverage explicit (QA-012).
3. Close authority, identity, storage/migration and platform packaging prerequisites before full product journeys.
4. Run each surface/service acceptance on the combined commit; fix concrete functional failures rather than recreating existing implemented features.
5. Run the separate integration, security/performance/recovery and installed A/B/hosted C qualification gates.
6. Close RECHECK tasks using immutable source, actual artifacts/deployments and persisted/provider readback.

Task-specific details remain in02–05 and10–13; all original task descriptions now display reconciled implementation/integration/verification/remaining-work fields before their original ending acceptance requirements.

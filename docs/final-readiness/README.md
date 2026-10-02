# [ROX-FINAL] Reconciled final-readiness audit — Windows, macOS and hosted web

**Canonical repository:** [rox-one/rox-one](https://github.com/rox-one/rox-one). **Audit branch:** `audit/reconciled-readiness-2026-10-03`, created from canonical main `f63294ba4fffa7238b46b24e918925a313ad0b12`. **Independently rechecked candidate:** PR1322 `de805e0dc7103b49d4c7f0a092d88c8b4222367a`. **Language:** English.

This audit accounts for accumulated ROX source beyond main: active branches, PRs, registered worktrees and uncommitted progress. The earlier main-only report is preserved as historical baseline evidence. Each original task now separates branch implementation, integration, bounded verification and remaining work. 625 independently described tasks/subtasks cover A Windows10/11, B macOS and C hosted authenticated web.

## [ROX-FINAL-START] Read the current source and evidence first

1. [09 — Canonical source, all branches/PRs and reconciliation](09-source-reconciliation.md).
2. [15 — Fresh candidate compiler/build/runtime checks](15-candidate-verification.md).
3. [08 — Complete task navigation](08-task-index.md) or [machine-readable backlog](backlog.json).

**Current findings:** root typecheck passes on the assembled candidate;16/18 workspace checks pass, with viewer and messaging gateway still failing.69 durability/lifecycle tests and34 WebUI/bootstrap tests pass. Real built-server lifecycle passes on Bun1.3.14 (4 tests) and fails at startup on Bun1.4.2. Branches contain substantial durable state, authority, product and runtime improvements; integration, remaining concrete defects, signed installed targets, live providers and deployed hosted acceptance are still open.

## [ROX-FINAL-DOCUMENTS] Detailed architecture, completion and qualification work

| Document | Scope |
| --- | --- |
| [01 — Main architecture](01-architecture.md) | Historical pinned main topology, desktop/WebUI/viewer, dependencies and service boundaries. |
| [02 — Surfaces](02-surface-backlog.md) | Every original screen/settings/widget/function task, now with reconciled progress and remaining work. |
| [03 — Runtime/services](03-runtime-services-backlog.md) | Every original service/runtime/module task with branch progress and remaining work. |
| [04 — Platform/release](04-platform-release-backlog.md) | Windows10/11, macOS and hosted WebUI distribution/runtime/platform contracts. |
| [05 — Integration/tests/recheck](05-integration-test-recheck-backlog.md) | Original separate vertical, permission, persistence, security/performance/recovery and final release qualification. |
| [06 — Main dependency inventory](06-codebase-inventory.md) | All17 baseline workspaces and declared direct dependencies. |
| [07 — Historical main checks](07-verification.md) | Original baseline executions, exact failures and limits; not current branch verdicts. |
| [08 — Complete navigation](08-task-index.md) | All original and added task/subtask links. |
| [09 — Source reconciliation](09-source-reconciliation.md) | Full source catalog, all17 open PRs,928 PR history records, dirty-state boundary and integration order. |
| [10 — Added/reconciled surfaces](10-surface-reconciliation.md) | Search, roadmap/OKR, repository context, authority projections, Notes defects,23 UTB hosts and legal evidence. |
| [11 — Added/reconciled services](11-service-reconciliation.md) | Durable authority/Notes sync/budgets/SQLite, voice/privacy, browser credential custody and every original service disposition. |
| [12 — Platform progress](12-platform-reconciliation.md) | Actual branch/CI/browser receipts, remaining native/web/release risks and extra evidence/adoption tasks. |
| [13 — Integration completion](13-integration-reconciliation-backlog.md) | Feature-preserving source integration, dirty OMP/voice recovery, compiler/runtime closure and final source recheck. |
| [14 — Candidate architecture/dependencies](14-candidate-inventory.md) | All18 assembled workspaces including new workspace-service, changed architectural contracts and complete direct dependency declarations. |
| [15 — Fresh candidate checks](15-candidate-verification.md) | Independent18-workspace compilation, tests/build and Bun1.3.14/1.4.2 actual startup comparison. |

## [ROX-FINAL-COUNTS] Task scope

| Prefix | Parent tasks | Subtasks |
| --- | ---: | ---: |
| UI | 81 | 237 |
| SVC | 42 | 84 |
| WIN | 7 | 14 |
| MAC | 6 | 12 |
| WEB | 9 | 18 |
| INT | 18 | 36 |
| QA | 13 | 30 |
| REL | 2 | 4 |
| RECHECK | 4 | 8 |
| **Total blocks** | **182** | **443** |

Each task and subtask ends with **Requirements / DoD / Full functional verification / Test method**, and has its own immutable ROX code reference. Checkboxes remain unchecked until complete task acceptance is established. Source implementation, branch integration, scoped compiler/unit/fixture evidence and full target release DoD are independent. Do not recreate already implemented branch features merely because the baseline described their earlier absence.

## [ROX-FINAL-MACHINE] Machine-readable evidence

- [backlog.json](backlog.json): complete task descriptions, acceptance fields, source links and reconciled progress.
- [task-progress.json](reconciliation/task-progress.json): every task’s implementation/integration/verification/remaining-work disposition.
- [branch-catalog.json](reconciliation/branch-catalog.json): all735 unique heads,779 refs, changed paths, PR matches and discovery-only task ownership.
- [progress-snapshot.json](evidence/progress-snapshot.json): pinned source/PR/check/worktree state at capture.
- [candidate-recheck.json](evidence/candidate-recheck.json): actual independent command results and logs.
- [candidate-source-inventory.json](evidence/candidate-source-inventory.json): exact candidate manifests and changed paths.
- Original [main typecheck evidence](evidence/package-typechecks.json) remains separate.

## [ROX-FINAL-REPRODUCE] Validate and regenerate

```sh
bun scripts/final-readiness-reconcile.ts
bun scripts/final-readiness-candidate-inventory.ts
bun scripts/final-readiness-report.ts
bun scripts/final-readiness-audit.ts --validate --export
git diff --check
```

Source snapshots and reviewed dispositions are inputs; refreshing them is a separate read-only action via final-readiness-progress.ts and the recorded GitHub history query. The validator resolves every immutable code path/line against its exact Git commit, validates unique IDs/parents and concluding acceptance fields, and exports task progress and navigation. This audit branch changes documentation/evidence/tooling only; product branches and active dirty state are preserved.

## [DEPENDENCY-ALERTS] Fresh dependency security evidence

GitHub Dependabot reports **6 open High alerts / 5 distinct advisories**: four Electron alerts and the same Sharp advisory in desktop and server manifests. Candidate constraints remain Electron ^39.2.7 and Sharp0.35.0. These are version/dependency alerts; product exposure has not been demonstrated. [QA-013 and six explicit subtasks](13-integration-reconciliation-backlog.md#qa-013-resolve-and-qualify-the-six-open-high-dependency-alerts) specify patched version selection, actual applicability, native binary/ABI closure and installed/server regression tests. [Captured API evidence](evidence/open-dependency-alerts.json) includes advisory IDs, affected ranges and first patched versions; public official advisories were independently opened.

# ROX-ONE Production Convergence PRD

> **Status:** Draft requirements and evidence ledger; not a production-readiness claim or deployment authorization. **As of 2026-10-08.**
> **Repository:** `github.com/rox-one/rox-one`; working checkout `feat/convergence-20261007`.
> **Current divergence:** `origin/main...HEAD` was observed as 49 commits behind and 288 ahead (the output order of `git rev-list --left-right --count origin/main...HEAD`). This feature branch is not equivalent to target `main`.
> **Toolchain evidence:** This environment reported Bun `1.4.2` and Node `v26.8.2`. The older documented Bun `1.3.14` and Node `24.x` values are historical pins, not current measurements and not authorization to change pins. No test/build/format run is claimed by this doc update.

## 1. Goal and status

Converge the ROX desktop/web experience and local runtime through small, provenance-backed changes, then prove user-visible behavior on the integrated revision and supported platforms. A passing source test, local implementation, merged PR, fixture, build, or health response is not by itself product, provider, platform, security, or deployment acceptance.

This PRD supersedes the earlier speculative completion claims and user-journey/API examples. Session tables and status statements from the prior draft are historical only; use the PR and task gates below. Report each status as `IMPLEMENTED-LOCAL`, `ALREADY-PRESENT`, `REMAINING`, `BLOCKED-EXTERNAL`, `UNVERIFIED`, or `ACCEPTED` with exact evidence. Do not infer completion from intent or code presence.

### PR provenance snapshot (supplied status; not independently re-read here)

| PR | Reported status | Must not be inferred | Closure evidence required |
|---|---|---|---|
| #1448 | Merged | That all source scope is in current `main` or native/platform accepted | Exact URL, state, head/base/merge SHAs and parents, required check-run results, changed paths; verify intended route/resource/runtime/toolchain content in target `origin/main`; run changed-scope acceptance on candidate revision. |
| #1469 | Open draft | Merged themes, geometry, or conflict resolution | Owner-reviewed exact head and current-main diff; resolve conflicts; verify actual theme selection/persistence, cross-window behavior, geometry, keyboard/accessibility and named platform rendering; complete required checks, promote from draft, merge, and verify exact target content. |
| #1481 | Merged | Whole UI-001/product acceptance | Exact PR provenance and required checks; execute the full UI-001 route/read/recovery acceptance matrix on exact integrated source, retaining individual scenario outcomes, negative controls and provenance. |
| #1486 | Open draft | Merged navigation recovery or successful public deployment | Reconcile exact head/base/checks and current-main conflicts; resolve prior deployment block (recorded as “Account is blocked”) through authorized operator/provider; perform final native refresh/UI acceptance; promote, merge and verify target. Earlier CI or synthetic readback is insufficient. |
| #1496 | Merged | That data models alone are safe to cherry-pick or complete | Reconcile exact PR provenance, intended workspace/data-model scope, consumers, persistence/authorization behavior and migration/backward compatibility; document rollback where data shape changes; verify content on target. |
| #1497 | Merged | End-to-end process lifecycle/platform acceptance | Reconcile exact PR provenance and stdio/subprocess shutdown scope; verify drained pipes, child close/exit, cancellation and failure cleanup without hangs or unintended output on exact integrated runtime; separate native packaging acceptance. |

For all six PRs, “reported merged/open” is a supplied snapshot, not a live check. A gate is open until exact remote PR metadata, head/base/merge SHA and parents, changed paths, required check IDs/results, and target-main content are recorded. Missing/stale evidence is `UNVERIFIED` or `BLOCKED`, never PASS.

## 2. Users and outcomes

- **ROX desktop user:** reliable navigation and current surfaces, readable states and recovery, preserved local work, and honest indication when services are unavailable.
- **Developer/operator:** a traceable path from source change to tested integrated revision and an auditable deployment receipt without losing user work or bypassing authorization.
- **Identity/billing service owner:** supplies and accepts its own versioned protocol, credential ownership, migration and operations contract; repository code does not define these by assumption.

## 3. Scope and boundaries

### Repo-reachable scope

The repository can implement and verify source-local UI, navigation, product-tour mechanics, runtime lifecycle, storage adapters, credential-store error handling, client boundaries, local tests and documentation, provided actual current callers/contracts are inspected first. Work must preserve the current app shell and avoid broad old-branch replacement. Each change is scoped to owned files; shared routes, schemas, lockfiles, registries and common UI have one integration owner.

### External prerequisites — explicitly blocked

This repository snapshot establishes no approved backend contract or live acceptance for:

- Pocket ID OIDC discovery/issuer/client registration and identity namespace/account-linking policy;
- Device Authorization Flow v2 endpoints, payloads, PKCE/state rules, polling errors, token issuance/refresh/revocation and claims;
- JWKS algorithms, key rotation, issuer/audience/claim validation and operational key ownership;
- account creation, email verification, welcome credits, idempotency, ledger reservation/settlement/release or balance semantics;
- OmniRoute credential issuance/provisioning, custody, rotation or inference billing.

Do not implement guessed endpoints or schema, claim these capabilities complete, create credentials, or treat fixtures as live acceptance. External work is blocked until an authorized service owner provides a versioned contract, environment/credential ownership and access, migration/rollback obligations, and live positive/negative acceptance evidence. Never put secrets in this repository or receipts.

### Not authorized by this PRD

Direct or unsafe merge to `main`; force push/reset/clean; destructive worktree changes; public deployment or release tagging; production database/DNS/provider mutations; account/balance changes; copying donor code without provenance and licensing clearance; or weakening authentication/fail-closed behavior to hide a missing contract.

## 4. Product requirements

1. **Navigation and appearance:** preserve one coherent current shell; routes and keyboard controls must reach the actual intended surfaces, respect focus/accessibility, and retain current state. Theme and geometry proposals remain proposals until reconciled with current source and user-facing validation. Do not treat the prior 0/4/6 geometry or theme names as accepted without product evidence.
2. **Product tour:** advancement is bound to real user/domain outcomes, not synthetic DOM clicks. Skip/complete states persist and are recoverable; errors, unavailable prerequisites and cancellation remain truthful. A catalog/test suite alone does not prove a usable tour.
3. **Local auth/vault behavior:** preserve local workspace/history on logout or provider failure. Credential fallback is permitted only under the current security design and approved platform APIs; never silently weaken custody or authority. Validate denial/revocation and storage-failure paths.
4. **Runtime/process behavior:** startup failures degrade only where safe and visible; child processes and stdio lifecycles settle on success, failure, cancellation and shutdown without hangs or leaked secrets. MCP inventory and provider readiness claims require exact current implementation evidence.
5. **Identity, billing and inference:** no completion claim or implementation of unapproved wire semantics until the external prerequisites above are satisfied. A local client seam is not service integration.

## 5. Acceptance and release gates

Acceptance is per requirement, on an exact source revision, with expected and observed results. Status vocabulary: `PASS`, `FAIL`, `BLOCKED`, `UNVERIFIED`, `NOT_APPLICABLE` (with reason). `PASS` requires action, environment/version, revision/artifact identity and evidence. Never convert absent evidence into a green status.

- **Provenance/integration:** close all six PR gates; record exact heads, bases, merge SHAs/parents and required check receipts; verify intended content is on candidate and target `main`. Integration goes through reviewed PRs after current-main reconciliation and independent review. No direct wholesale branch merge.
- **Product tour:** perform from a fresh profile on the actual app, recording each real trigger, target, navigation, persistence/reopen, skip/complete, error/retry/cancel, keyboard/focus, locale and reduced-motion outcome. No mocked callback or synthetic action counts as product acceptance.
- **Platform/product verification:** retain separate macOS, Windows and hosted/web evidence where applicable. Each receipt names the supported OS/runner/device, app build/version/digest, exact revision, scenario, expected/observed result and sanitized logs/screenshots. Browser evidence cannot stand in for native behavior or vice versa.
- **Security:** obtain independent security review against the exact integrated revision; exercise valid/invalid identity, unauthorized/revoked access, cross-account/workspace boundaries, callback races, secret redaction, credential storage failure/rotation and logout/recovery. Device Flow/OIDC/JWKS tests require approved provider contract and live environment; fixtures prove only their boundary.
- **Operator/deployment:** deployment requires explicit operator authorization, named target/environment/change window, exact artifact digest/source provenance, pre-deployment backup/rollback point and executable rollback procedure. Retain a receipt with operator, timestamps, target, source commit/tree, artifact digest/version, approval, deployment result, health/smoke observation, rollback readiness/result and sanitized logs. No receipt means no deployment acceptance.
- **Release:** no tag or production claim until every applicable gate is PASS and an authorized release owner approves. A deployment provider block is an external blocker, not a reason to claim local build as deployed.

## 6. Evidence and reporting rules

Keep local implementation, merged-source presence, automated verification, live provider behavior, native/platform behavior and deployment as distinct evidence classes. Record limitations next to each result. Preserve original failure history; do not replace it with a successful rerun without linking both. Never include credentials, user content, private paths or personal data in public docs/PRs. Source hashes and sanitized receipts must bind to the exact delivered tree.

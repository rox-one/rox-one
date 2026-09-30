# Cloud core baseline repairs

## Scope

Repair the three core test failures reproduced during the `rox-one` Codex Cloud setup: two credential locator validation failures and a Things calendar failure caused by inconsistent clocks. Work starts from `f63294ba4fffa7238b46b24e918925a313ad0b12` in `/Users/t/Projects/rox-cloud-core-fixes-20260930` on `fix/cloud-core-baseline-20260930`.

## Acceptance

1. Credential locators reject inherited, non-enumerable, accessor, and symbol properties before registry mutation or accessor execution.
2. Plain locators with enumerable, readonly or frozen data properties remain valid.
3. `attachCredentialRef` reaches the same registry locator validation used by direct registration and provider updates.
4. `PersonalTaskStore.setWhen` supports an explicit clock for date classification while preserving the current two argument API and its wall clock default.
5. The focused regression tests and all `packages/core` tests pass with Bun 1.3.14. Package typecheck failures, if present outside these files, are reported with their baseline comparison.
6. The lead receives a local commit, evidence, and a checkpoint for review before push or PR.

## Ownership and constraints

- Worker: `cloud_recovery`; lead: `/root`, responsible for integration and Cloud UI.
- Owned source: credential locator validation and related tests; Things `setWhen` and related tests.
- Owned documentation: this specification, `docs/plan.md`, and `docs/cloud-core-validation.md`.
- Other worktrees, Cloud configuration, user credentials, and assertion strength are outside this change.
- No `.codegraph/` index exists in the assigned checkout; targeted `rg` reads cover the owned functions and their callers.

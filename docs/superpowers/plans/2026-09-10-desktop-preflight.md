# Desktop finalization preflight — 2026-09-10

Read-only live state for `docs/superpowers/plans/2026-09-01-rox-desktop-finalization.md` Задача 0.

## Origin main

- `origin/main`: `9acb4cce2383eb6b604a46d6c86bc6a71c31612c`
- Dated SHA `5797f431` and 2026-08-12 board numbers are evidence only.

## PR #1–#5 (`rox-one/rox-one`)

| PR | State | Head | Notes |
|---|---|---|---|
| #1 dependabot | OPEN | `fc5f6096` `dependabot/npm_and_yarn/packages/server-core/npm_and_yarn-e190a37596` | KEEP / excluded from this release (Задача 3) |
| #2 integration-audit | CLOSED unmerged 2026-08-19 | `eccec3f0` `cursor/integration-audit-7c33` | KEEP / human handoff |
| #3 archaeology | CLOSED unmerged 2026-08-19 | `4bbe6c24` `cursor/rox-program-p0-archaeology-env-a5eb` | KEEP / human handoff |
| #4 remediation | CLOSED unmerged 2026-08-13 | `ccabf68a` `cursor/rox-remediation-a5eb` | KEEP / human handoff |
| #5 remediation 8 WS | **MERGED** 2026-08-19 | `7afd7010` `rox-integration-remediation-7c33` | Branch **B**: not a live ship PR |

## Named current ship ref

- **Branch / SHA:** `feat/settings-command-center-finish` (this PR) off `origin/main` `9acb4cce`
- **Reviewable path:** successor PR from this branch into `main`
- PR #5 is merged; remaining required code lands here, not in #5.

## Ticket-13 on ship ref

Present on `origin/main` (inherited):

- `packages/server-core/src/sessions/permission-broker-gate.ts` — `admin_approval` gated only when `commandHash` is set
- `packages/server-core/src/sessions/permission-broker-gate.test.ts`
- `packages/shared/src/agent/live-turn-gate.ts` + tests

Live `ROX_API_KEY` re-check remains human; bun tests do not prove a live turn.

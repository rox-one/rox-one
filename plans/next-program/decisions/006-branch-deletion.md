# 006 — Remote branch deletion: do not execute

Ticket 14. Parent: [`plans/branch-disposition.md`](../../branch-disposition.md) **§5**.

**Status:** ACCEPTED — current binding is **PROPOSED — NOT executed**.

**Owner:** product (pzd). An agent must not delete remote branches.

## Context

Workstream H classified 94 branches (85 rox-one + 9 donor `SAFE_TO_DELETE`) and wrote proposed `git push --delete` commands in §5.

One donor residual is still open:

- `feat/shell-ext-activate2` on `agisota/craft-agents-oss`
- Unique file: `apps/electron/src/main/extension-host/__tests__/worker-list-commands.test.ts` (142 lines)
- Feature itself is already on `main` via PRs #42 / #44
- Human must **port or discard** that test before the donor branch is archived

Open / active lines listed under “Not proposed for deletion” stay: `main`, integration/audit branches, open PRs, dependabot.

## Decision

**Do not run §5.** The commands stay a proposal.

- No `git push --delete` against `rox-one/rox-one` or the donor remote from this program.
- No agent “cleanup” of `feature/pr-*`, knowledge/shell series, or donor branches.
- The 142-line worker test is **not** ported or discarded by this record.

## Considered options (not chosen)

- **Execute §5 now** — rejected. Ticket 14 is decision-only; the parent file already says NOT executed. The donor test is still untriaged.
- **Port the 142-line test in this ticket** — rejected. That is implementation, and a human still has to choose port vs discard.

## What would flip this

A human:

1. Ports or explicitly discards `worker-list-commands.test.ts`.
2. Reviews the §5 command lists against current remotes (open PRs must stay excluded).
3. Runs the deletes themselves.

Until then, `plans/branch-disposition.md` §5 remains the inventory, not a completed cleanup.

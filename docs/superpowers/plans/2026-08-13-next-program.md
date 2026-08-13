# Rox Next Program — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. This file is the **program orchestration** plan. Each ticket in `plans/next-program/tickets/` is a subsystem. Before coding a ticket, the assigned subagent writes a bite-sized plan with failing tests first (`writing-plans` + `test-driven-development`). Do not implement all 14 tickets in one context window.

**Goal:** Close the remaining first-run, public-surface security, and god-module seams so a clean Rox install reaches a real turn or one credential step, and the next feature does not serialize through a 10 000-line session file.

**Architecture:** Prefactor the session and config modules at their existing interfaces, then land vertical slices (credential step, callback escape, viewer bytes, knowledge mount, secrets settings, env resolver) on isolated branches that merge into one integration branch. Decision-only tickets never become code.

**Tech Stack:** Bun monorepo, Electron + webui + viewer Pages Functions, OMP NDJSON RPC, react-i18next (10 locales, `ru` default).

## Global Constraints

- Base: `rox-integration-remediation-7c33` (PR #5), not stale `main` @ `5797f431`.
- Never strand `~/.craft-agent` / `CRAFT_*` / `craftagents://` / `com.lukilabs.craft-agent`.
- i18n: all user-facing strings via `t()`; 10 locales; ASCII-sorted keys; `bun test packages/shared/src/i18n`.
- TDD: failing test first; RED evidence required in the subagent report.
- One owner for SessionManager, protocol DTOs, `config/storage.ts`.
- No managed SiYuan kernel. No production Cloudflare/R2 mutation from the agent.
- Every failure path: bounded + typed + idle + actionable.
- Branch names: `cursor/<descriptive-name>-7c33` or `rox/<name>` per repo PR policy.

---

## File map (program-level)

| Area | Create / modify | Owner ticket |
|---|---|---|
| OMP first-run UX | OmpAgent error surfacing, onboarding/connection settings | 01, 12 |
| OAuth callback | `packages/shared/src/auth/callback-page.ts` | 02 |
| Viewer share | `apps/viewer/functions/s/**` | 03 |
| Config defaults | `apps/electron/resources/config-defaults.json`, `packages/shared/src/config/storage.ts` | 04, 07 |
| Knowledge panel | `apps/electron/src/renderer/knowledge/**` | 05, 11 |
| Secrets settings | `packages/shared/src/secrets/**`, settings RPC | 06 |
| Session prefactor | `packages/server-core/src/sessions/**` | 09, 12 |
| MCP leftovers | `scripts/build/**`, `runtime-resolver.ts` | 10 |
| Webui / scripts | `apps/webui/**`, root `package.json`, `docs/cli.md` | 08 |
| Decisions | `docs/specs/**` ADRs | 14 |

---

## Waves

```
WAVE 0  09 session prefactor          (start immediately; unblocks 12)
WAVE 1  01 02 03 04 05 06 08 10       (parallel; 04/07 share config — 07 waits)
WAVE 2  07 11 12                      (07 after 04; 11 after 05; 12 after 09)
WAVE 3  13 live E2E                   (needs 01 + 12 + human credential)
        14 decisions                  (human, any time)
```

## Task 0: Lead setup

**Files:** none created yet; read the inventory and spec.

- [ ] **Step 1:** Read `plans/problem-inventory.md`, `plans/next-program-spec.md`, `plans/next-program-prompt.md`.
- [ ] **Step 2:** Confirm base is the integration branch with OMP hang + viewer owner-key already present (`settleReady` exists; `ownerKey` returned from `POST /s/api`).
- [ ] **Step 3:** Recreate the ownership map. SessionManager owner = ticket 09 only until extract lands.
- [ ] **Step 4:** Dispatch Wave 1 subagents with the prompt in `plans/next-program-prompt.md` §workstream briefs. Each subagent must name its skill and return the structured result block.

## Per-ticket execution (repeated)

For every ticket `NN`:

- [ ] Write a local `docs/superpowers/plans/2026-08-13-ticket-NN.md` with failing-test steps (no TBD).
- [ ] Implement on an isolated worktree/branch.
- [ ] Run the ticket’s tests + the nearest existing suite.
- [ ] Lead re-runs the suite; rejects “tests exist” without RED evidence.
- [ ] Merge to the next-program integration branch, not `main`.

## Self-review

1. **Spec coverage:** Stories 1–3 → 01/07/08; 4–7 → 03; 8 → 02; 9–11 → 05; 12–13 → 06; 15–16 → 08; 18–19 → 07; 20–21 → 09/04; 22 → 10; 23–24 → 08; 25–27 → 14; 28 → 11; 29–30 → lead + 13.
2. **Placeholder scan:** none in tickets; detailed test code is written per-ticket at execution, not here — this is the program plan, not a 200-step file.
3. **Type consistency:** OMP codes stay the six names already in `OmpStartupErrorCode`. Secret error `SECRET_ENVVAR_DENIED` already exists. Viewer codes stay the SECURITY.md taxonomy.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-13-next-program.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per ticket, review between tickets.
2. **Inline Execution** — one session, `executing-plans`, checkpoints after each wave.

The prompt in `plans/next-program-prompt.md` is the dispatch document for option 1.

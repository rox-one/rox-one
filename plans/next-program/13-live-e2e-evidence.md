# Ticket 13 — Live-credential first-turn E2E evidence

Date: 2026-08-13  
Branch: `rox/next-program-t13-e2e-7c33` (from `rox/next-program-wave1-7c33` @ `0ffb165c`)  
Gate: `packages/shared/src/agent/live-turn-gate.ts`  
Runner log: [`13-live-e2e-gate.log`](./13-live-e2e-gate.log)

## Verdict

**BLOCKED — missing secret `ROX_API_KEY`.**

This is not a live turn. The suite does **not** claim stream / host tool / MCP tool / permission / restart-after-live-turn as VERIFIED. `claim: live-turn-not-claimed`.

A later human run with a real `ROX_API_KEY` must produce:

1. A session log that shows `text_delta` (stream), one host tool, one MCP tool, and a permission prompt.
2. A browser trace of that same turn.
3. A restart that restores the same session.

Then call `claimLiveTurnVerified` with those two files. The gate refuses VERIFIED without both files, and refuses VERIFIED from a BLOCKED gate even if files are invented.

## Environment probe (2026-08-13)

| Check | Result |
|---|---|
| `ROX_API_KEY` | unset |
| `CRAFT_SERVER_TOKEN` / `ROX_SERVER_TOKEN` | unset (not required for this gate) |
| `~/.omp/agent/models.yml` | absent |
| `~/.omp/agent/config.yml` | absent |
| `~/.omp/agent/` other | `agent.db`, `models.db`, `sessions/` (no providers) |

Runner output (verbatim):

```
status: BLOCKED
claim: live-turn-not-claimed
missingSecret: ROX_API_KEY
reason: Live first-turn E2E is BLOCKED — missing secret ROX_API_KEY. Do not claim stream / host tool / MCP tool / permission as VERIFIED.
steps:
  stream_answer: BLOCKED
  host_tool: BLOCKED
  mcp_tool: BLOCKED
  permission_prompt: BLOCKED
  restart_restore: BLOCKED
```

**Browser trace:** not produced. There was no live turn to record. Naming the missing secret is the evidence, not a screenshot of a failed claim.

## Wave 5 steps (re-check)

Original run: 2026-08-12, pristine `CRAFT_CONFIG_DIR`, no credentials (`plans/remediation-board.md`).

| Step | 2026-08-12 | 2026-08-13 |
|---|---|---|
| install → build → boot | VERIFIED | unchanged (not re-booted this ticket) |
| onboarding → identity/provider | VERIFIED (server-side) | unchanged |
| runtime readiness | VERIFIED | unchanged |
| create session → send prompt | VERIFIED — typed `OMP_NO_MODELS` | still the honest no-credential path (ticket 01 + 12) |
| stream / host tool / MCP / permission | BLOCKED — live LLM credential | **BLOCKED — missing secret `ROX_API_KEY`** |
| restart → restore | VERIFIED (no-credential sessions) | unchanged; live-turn restart stays BLOCKED |
| web login → same workspace/session | VERIFIED | unchanged |

## Negative paths remain bounded

Re-run on this branch, 2026-08-13 (not a claim that the 2026-08-12 live server was rebooted):

| Suite | Result |
|---|---|
| `live-turn-gate.test.ts` | 11 pass — BLOCKED names `ROX_API_KEY`; VERIFIED refused without log+trace |
| `omp-first-run.test.ts` | 12 pass — `OMP_NO_MODELS` / provision-without-raw-key |
| `error-code-omp.test.ts` | 3 pass — six OMP codes on the agent union |
| `errors.test.ts` | 18 pass — typed mapping + stderr scrub |
| `omp-lifecycle-hardening.test.ts` | 4 pass — A1/A2/A4/A6 bounded (incl. `OMP_NO_MODELS` under stderr flood) |
| `share-capability.test.ts` | 12 pass — owner capability / 401 / 403 / legacy-immutable |
| `share-owner-key.test.ts` | 7 pass — same matrix through SessionManager |

Wave 5 negative-path codes still members of `AGENT_ERROR_CODES`: `OMP_NO_MODELS`, `OMP_AUTH_REQUIRED`, `OMP_NOT_CONFIGURED`, `OMP_START_FAILED`, `OMP_PROTOCOL_ERROR`, `mcp_unreachable`, `invalid_credentials`.

## How to un-block

1. Export a real `ROX_API_KEY` (do not commit it).
2. `bun packages/shared/src/agent/live-turn-e2e.ts` should print `status: READY` and `claim: live-turn-not-claimed`.
3. Fresh-machine path: boot → onboarding/credential step → one prompt that streams, calls one host tool, one MCP tool, and hits a permission prompt (ask/safe).
4. Restart the server; same session id restores.
5. Keep the session log and a browser trace; pass both to `claimLiveTurnVerified`.
6. Replace this file’s verdict with VERIFIED only after that claim succeeds.

Until then, **do not fake green.**

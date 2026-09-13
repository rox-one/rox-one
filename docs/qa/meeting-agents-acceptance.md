# Meeting-agents acceptance (RMA-I034 / #390)

Native M0–M3 release gate. Documents, fixtures, type definitions, and HTTP 202 are **not** default-ready.

Parent **#356 is not closed** by this document or by merged PR count.

## This host

Linux cloud agent. Native Mail/CRM/Calendar shells and unsigned linux resource staging exist. Live Mail/CRM/Calendar Conation, packaged macOS/Windows smoke, native mic, and SFU rooms are **blocked**, not passed.

## Capability honesty

| Capability | Issue | Status |
|---|---|---|
| GitHub/Linear handoff stubs | #373 | unit **passed** (fail-closed; fixture ≠ live) |
| Follow-up schedules | #374 | unit **passed** (no production send) |
| Recipes / readiness model | #375 | unit **passed** |
| Conation capability matrix | #376 | unit **passed** |
| Notes/Projects identity | #377 | unit **passed**; Conation writes **blocked** |
| Board/Fund identity | #378 | unit **passed**; iframe not native |
| DSS files | #379 | unit **passed**; upload/move **blocked** |
| Mail/Channels | #380 | native shells + RPC stubs **passed** (U1); live send **blocked** |
| CRM | #381 | native card shell **passed** (U1); live mutation **blocked** |
| Calendar/Calls | #382 | native occurrence/reminder ledger **passed** (U1); live write **blocked** |
| Sync checkpoints | #383 | unit **passed** |
| Adversarial security | #384 | unit **passed** |
| Electron E2E harness | #385 | contract **passed**; real Electron **not_run** |
| Eval/budgets | #386 | unit **passed**; live holdout **not_run** |
| Packaged app / locales | #387 | unsigned linux resource stage **passed**; packaged OS **blocked** |
| Sharing/retention | #388 | unit **passed** |
| Rooms / SFU | #389 | native join stub **passed**; SFU **blocked** (no provider decision) |
| AUD #333 source/license | #333 | **blocked** (not taken by this work) |

## Rollout rule

Any `blocked` / `failed` / `not_run` case forbids rollout of that capability. Kill switch stops new effects and does not erase ledgers.

See `docs/qa/meeting-agents-evidence.json`.

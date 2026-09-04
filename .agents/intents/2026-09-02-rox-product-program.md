# Intent: ROX Product Program

id: intent-2026-09-02-rox-product-program
date: 2026-09-02
status: active
owner: rox-one/rox-one (Craft Agents fork, OMP/Rox integration)
default_ui_language: ru
fallbackLng: [ru, en]

## Feature

ROX ships a local-first agent desktop (Electron) with session collections,
local Markdown Notes, Canvas, embedded browser chrome, and the OMP (`omp`)
backend. This program tracks remaining product work after the completed
baseline. It does **not** reopen shipped P0 surfaces as new product work.

## Background

Given the completed baseline already in tree:

| Surface | Status | Do not recreate |
|---------|--------|-----------------|
| Canvas P0 | shipped | yes |
| Local Markdown Notes | shipped | yes |
| Browser retention | shipped | yes |
| Onboarding | shipped | yes |
| Geist | shipped | yes |
| Provider badges | shipped | yes |
| SiYuan opt-in | shipped | yes |
| Localized column resize | shipped | yes |

And given Wave 0 Issue 00 keeps `HEAD` even with `origin/main` without
dropping Rox commits
And given Wave 0 Issue 03 lands a headless performance/observability
harness before any DG-gated product decisions
And given tracker GitHub issues are **not** bulk-created unless an
existing tracker convention and write access clearly intend it

## Completed Baseline (non-goals)

These are already product. New issues must not duplicate them as greenfield
work. Residual latency, i18n, or scale follow-through may appear as later
numbered issues; they extend the baseline, they do not replace it.

## Decision gates (do not implement product)

DG-01 through DG-05 are product/legal/policy decisions. This intent forbids
implementing gated product work in Wave 0. A checklist stub may live in the
master plan for execution tracking only — not legal copy.

## Scenarios

### Scenario: Cached session switch meets budget

Given 2,000 indexed sessions and a warm renderer cache
When the user switches to another cached session
Then p95 interaction-to-content is below 120ms
And no full collection reload occurs

### Scenario: Collection load does not fan out permission metadata

Given a workspace with N indexed sessions
When the renderer loads the session collection
Then `sessions:get` is invoked at most once
And `sessions:getPermissionModeState` is not invoked once per session
And IPC counters record the fan-out so CI can fail on N+1 regressions

### Scenario: Cold ready is observable

Given a deterministic 500-session fixture
When the renderer reaches first interactive ready
Then the harness records `cold-ready` with payload-size telemetry
And secrets, paths, emails, and message bodies are redacted locally

### Scenario: Surface switches stay on the harness

Given the existing renderer session-switch marks in `lib/perf.ts`
When the user opens Notes, browser chrome, a dropdown, a view tab, or a
Canvas layout pass
Then each interaction is marked with a stable kind
And long-task plus React commit telemetry is attached
And bundle/minification hangs are profiled on a separate track

### Scenario: CI fails on declared budget regressions

Given the headless benchmark script and fixture set
When `bun run test:perf` runs without a display
Then the human-readable report is written
And the process exits non-zero if a declared budget regresses

### Scenario: Wave 0 does not ship gated product

Given Issues 01, 02, and 04–34 remain in the master plan
When Wave 0 lands
Then only Issue 00 hygiene, Issue 03 harness, and tiny supporting hooks
are in the change set
And DG-01..DG-05 product decisions stay unimplemented

## Out of scope

- OMP RPC transport changes (`docs/omp-rpc-notes.md`)
- Resume from the OMP session store (craft transcript remains source of truth)
- Speculative cloud/sync/voice
- Bulk-creating 35 GitHub tracker issues
- Feature UI ownership inside `apps/electron/src/renderer/perf/**`

## Evidence

- Plan: `.agents/plans/2026-09-02-rox-master-backlog.md`
- Harness: `apps/electron/src/renderer/perf/**`
- Run: `bun run test:perf`

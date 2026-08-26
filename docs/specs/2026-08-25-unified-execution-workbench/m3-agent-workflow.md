# M3 agent workflow (path D / slice C)

- **Status:** In Review
- **Date:** 2026-08-26
- **Pattern:** orchestrator + terminal evaluator (not a single prompt)
- **Machine config:** [m3-agent-workflow.json](./m3-agent-workflow.json)
- **Binds to:** [m3-first-slice.md](./m3-first-slice.md) (**Approved**), [m3-surface-graph.md](./m3-surface-graph.md)
- **Does not authorize:** product implementation until writing-plans is invoked after this file is Approved

## Why orchestrator

M3 has a real DAG: G1 is independent of the twin-union change; the byte plane depends on G1; Electron UI depends on types + plane; QA is a quality gate. `max_parallel: 2` keeps `types-union` and `g1-spike` from fighting. A single agent would thrash `SurfaceTab` and `WsRpcServer` in one context window.

## File ownership (non-overlap)

| Agent | Owns | Must not touch |
| --- | --- | --- |
| g1-spike | `spikes/pty-g1/`, `g1-decision.md` | Electron, `WsRpcServer` |
| types-union | core `SurfaceTab` + renderer `SurfaceTabLike` + parse/describe + routes | `SessionManager`, `WsRpcServer` |
| coordinator | **new** `packages/server-core/src/execution/` | identity `workgraph.ts`, `WsRpcServer` |
| data-plane | `execution/terminal/` + shared execution types | `transport/server.ts` |
| electron-surface | contribution + main/preload attach | `surfaces/types.ts` (already owned) |
| evaluator / critic | tests only if AC gap | product design changes |

Handoff payload MUST include: `workflow_id`, `step_id`, `task`, `constraints`, `upstream_artifacts`, `acs`, `owns`, `forbidden`, `budget_tokens`, `timeout_seconds`.

Always-on constraints: no WorkItem, no parent-81 merge, no PTY bytes on JSON-RPC, no new Session task fields, flags default false.

## Failure

- One retry on test-fail, then stop the step and return to orchestrator.
- Evaluator fails closed if any AC-1…AC-14 lacks a test or if `serializeEnvelope` gained byte-stream variants.
- g1-spike is throwaway. Keeping spike code as product is a **new** request (brainstorming).

## What this slice is not

Not writing-plans. Not M3 code. Not G1 execution. After this file is Approved, the next authorized step is the writing-plans skill, then implementation under this DAG.

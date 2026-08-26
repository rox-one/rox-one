# M3 First Vertical Slice — First-class local terminal

## 1. Title and Metadata

| Field | Value |
| --- | --- |
| Author | Operator session 2026-08-26 (path D / slice B) |
| Date | 2026-08-26 |
| Status | **Approved** (2026-08-26) |
| Reviewers | Product owner (Mark) |
| Parent | [architecture.md](./architecture.md) (Accepted, M0) |
| Graph | [m3-surface-graph.md](./m3-surface-graph.md) (merged PR #56) |
| Ground | `rox-one/rox-one` `main` @ `b57d32e` |
| Reviewers note | Product code MUST NOT start until path D slice C is reviewed and writing-plans is invoked |

## 2. Context

Users can talk to an agent in a Session and can open browser/cloud-run surfaces, but they cannot attach a first-class terminal to that Session. Agent Bash (`craft-exec`) is a sidecar tool that dumps text into the conversation. That is not a Resource Surface: no detach, no fencing, no valid reconnect snapshot.

ADR-0001 already forbids stuffing tasks into Session and forbids a second layout SoT. The architecture spec forbids terminal bytes on JSON-RPC and forbids a mandatory WorkItem. The surface graph shows a **twin** `SurfaceTab` / `SurfaceTabLike` union: any new kind must land in both or URL restore drops the tab.

This slice exists so a local Electron user can open, detach, and reattach a terminal on an **existing** Session, with control on RPC and bytes on a binary plane. It is the smallest proof of the execution program.

Success: all AC-* below pass on local Electron with flags default OFF. Failure to pick a PTY in G1 blocks implementation of FR-8–FR-12, not the writing of this spec.

## 3. Functional Requirements

- **FR-1** The system MUST add `SurfaceTab` variant `{ kind: 'terminal'; terminalId: string; sessionId?: string }` in `packages/core/src/platform/surfaces/types.ts`.
- **FR-2** The renderer twin `SurfaceTabLike` in `apps/electron/src/renderer/platform/layout-snapshot.ts` MUST gain the same variant in the same change.
- **FR-3** `surfaceTabToDescriptor`, `surfaceTabDurableKey`, `parseWorkbenchTab`, and `describeWorkbenchTab` MUST handle `terminal` (descriptor MAY be `null` if no host-descriptor variant is added in this slice; durable key MUST be `terminal:${terminalId}`).
- **FR-4** URL / `layout-snapshot` MUST round-trip a terminal tab. A snapshot that contains only a terminal tab MUST restore that tab; unknown kinds MUST continue to drop as `null`.
- **FR-5** Opening a terminal MUST be possible against an existing Session and MUST NOT create a WorkItem, WorkflowRun, or CloudRun.
- **FR-6** `SessionManager` MUST NOT gain new `taskSlug` / `taskRunId` / `taskNodeId` fields. Optional attach is `executionRunId` and/or `terminalId` only if stored outside those leftover keys.
- **FR-7** Control operations (create, attach, detach, resize, signal, destroy, snapshot, take_control) MUST use the existing RPC / WS control plane.
- **FR-8** PTY bytes MUST NOT be encoded in JSON-RPC envelopes (`WsRpcServer` / `serializeEnvelope`).
- **FR-9** A separately framed binary data plane MUST carry `{ seq, epoch, kind: 'out'\|'in'\|'resize'\|'snapshot', payload }`.
- **FR-10** Flow control MUST be credit-based. A sender with zero credits MUST stop.
- **FR-11** Reconnect / renderer reload MUST deliver a server-owned VT snapshot frame and then only deltas with `seq` greater than the snapshot barrier. Partial scrollback replay MUST NOT occur.
- **FR-12** `take_control` MUST increment a monotonic fencing `epoch` starting at 1. Commands carrying a stale epoch MUST return `FENCE_MISMATCH` and MUST NOT apply.
- **FR-13** Closing the surface tab (D0) MUST detach by default (PTY keeps running) unless the user (or API) requests destroy.
- **FR-14** Renderer crash or reload (D1) MUST reattach via FR-11 without requiring a new `terminalId`.
- **FR-15** Desktop restart (D2) MUST either restore the detached PTY or return explicit `unsupported`. It MUST NOT silently report success.
- **FR-16** Feature flags `workbench.terminal.v1` and `execution.coordinator.v1` MUST default to `false`. With both false, behavior MUST match pre-slice Electron (no terminal tab, no PTY process spawned by this feature).
- **FR-17** `ExecutionCoordinator` in this slice MUST only admit local Electron (`ExecutionHost.kind === 'local-electron'`). SSH and relay MUST be rejected.
- **FR-18** Pause of a terminal resource MUST return one of `paused | partial | unsupported | failed`. If the chosen PTY cannot pause, the result MUST be `unsupported`, not `paused`.
- **FR-19** An `ExecutionRun` MAY be created for the terminal, but WorkItem MUST remain absent. Names MUST NOT overload `WorkflowRun` or `CloudRun`.
- **FR-20** G1 MUST be recorded before FR-8–FR-12 ship: compare extend `craft-exec` vs new native PTY crate vs `node-pty` vs external multiplexer. `craft-pty` MUST NOT be assumed.

## 4. Non-Functional Requirements

- **NFR-1 Security.** Binary and RPC logs MUST NOT contain PTY contents, tokens, or absolute host paths. GRANT-style APIs in this slice MUST NOT accept secret fields.
- **NFR-2 Fail-closed flags.** Missing, malformed, or non-boolean flag values MUST behave as `false` (FR-16).
- **NFR-3 Compatibility.** Existing session/browser/cloud-run surfaces MUST keep current routes and snapshot tests green.
- **NFR-4 Transport isolation.** Adding a terminal MUST NOT require `WsRpcServer` to accept a new payload type for byte streams.
- **NFR-5 Determinism.** Fence epoch and `seq` MUST be strictly monotonic per terminal. Equal-time ties MUST NOT reorder applied commands.
- **NFR-6 Performance.** This slice MUST NOT invent latency or size percentages. Packaged-build numbers are G7 / M6, out of slice.
- **NFR-7 Accessibility.** If the terminal view is DOM (`hostKind: 'dom'`), existing keyboard focus of the panel stack MUST remain. If `bounds-managed`, the host frame MUST keep the panel’s accessible name from the contribution `title()`.
- **NFR-8 Testability.** Every AC MUST be implementable without network or a second machine.

## 5. Acceptance Criteria

### AC-1 Twin union (FR-1, FR-2, NFR-3)

Given a checkout with this slice  
When `SurfaceTab` and `SurfaceTabLike` are compared  
Then both include `kind: 'terminal'` with `terminalId`  
And `surfaces-registry` / `layout-snapshot` tests that enumerate kinds include the eighth kind.

### AC-2 Durable key and parse (FR-3)

Given tab `{ kind: 'terminal', terminalId: 't1', sessionId: 's1' }`  
When `surfaceTabDurableKey` and `parseWorkbenchTab` run  
Then the key is `terminal:t1`  
And parse of the same JSON returns the same tab  
And parse of `{ kind: 'terminal' }` (missing id) returns `null`.

### AC-3 URL round-trip (FR-4, NFR-3)

Given a layout snapshot whose only surface tab is that terminal  
When it is encoded to URL params and decoded  
Then the terminal tab is present with the same `terminalId`  
And a pre-slice snapshot with seven kinds still round-trips.

### AC-4 No WorkItem (FR-5, FR-19)

Given an existing Session `s1` and flags enabled  
When the user opens a terminal on `s1`  
Then no WorkItem record is created  
And no `tasks:*` RPC is invoked  
And `taskSlug` / `taskRunId` on the session header are unchanged.

### AC-5 Control vs bytes (FR-7, FR-8, NFR-4)

Given an attached terminal producing output  
When transport traces are inspected  
Then create/attach/resize/take_control appear as RPC  
And PTY output bytes do not appear inside `serializeEnvelope` payloads.

### AC-6 Credits (FR-9, FR-10)

Given a client with remaining credits `0`  
When more `out` frames are generated  
Then the server stops sending until credits are replenished  
And `seq` of the next delivered `out` is previous+1.

### AC-7 Snapshot barrier (FR-11, FR-14, NFR-5)

Given an attached terminal that has printed more than one screen  
When the renderer is reloaded (D1)  
Then the first data-plane frame is `kind: 'snapshot'`  
And subsequent `out` frames have `seq` greater than the snapshot seq  
And the client does not replay pre-snapshot bytes.

### AC-8 Fence (FR-12)

Given controller A holds epoch `n`  
When controller B calls `take_control`  
Then epoch becomes `n+1`  
And a resize from A with epoch `n` returns `FENCE_MISMATCH`  
And the PTY size does not change from A’s command.

### AC-9 Detach D0 (FR-13)

Given an attached terminal  
When the user closes the tab without destroy  
Then the PTY process is still alive  
And reopening the same `terminalId` attaches without spawn.

### AC-10 D2 honesty (FR-15)

Given a detached terminal and a desktop restart  
When the app starts  
Then the UI either restores that `terminalId` or shows `unsupported`  
And it does not show a live terminal that has no process.

### AC-11 Flags default off (FR-16, NFR-2)

Given a fresh profile (no flag keys)  
When the app starts  
Then no terminal contribution is mounted  
And no PTY is spawned by this feature  
And existing session tests pass.

### AC-12 Local host only (FR-17)

Given `ExecutionHost.kind` is `ssh` or `relay`  
When `ExecutionCoordinator.start` / `attachTerminal` is called  
Then the call is rejected  
And no PTY is created.

### AC-13 Pause honesty (FR-18)

Given the chosen PTY implementation  
When `pause` is invoked on the terminal resource  
Then the result is one of the four allowed strings  
And if the implementation cannot pause, the result is `unsupported`.

### AC-14 G1 recorded (FR-20)

Given the PR that first enables FR-8–FR-12  
When its description and tree are reviewed  
Then a G1 decision note exists (path under this directory or ADR addendum)  
And it names the chosen option and the three rejected options.

## 6. Edge Cases

- **EC-1** `sessionId` omitted: scratch terminal is allowed (FR-5).
- **EC-2** `sessionId` points at a missing session: open MUST fail closed; no orphan PTY.
- **EC-3** Duplicate `terminalId` open: focus existing panel (`singletonPer` = durable key).
- **EC-4** Flag turns off while a PTY is detached: new attaches MUST refuse; existing process MUST be destroyed or explicitly listed as leftover with destroy API — MUST NOT spawn new ones. Preferred: destroy on flag-off.
- **EC-5** Snapshot larger than client window: client MUST still apply snapshot then deltas; MUST NOT request “scrollback from seq 0”.
- **EC-6** Credit underflow / wrap: credits are unsigned; underflow MUST clamp to 0, not wrap.
- **EC-7** `WsRpcServer` disconnect mid-stream: control reconnects; data plane MUST resume only after a new snapshot barrier.
- **EC-8** Twin union drift: CI MUST fail if `SurfaceTab` kinds and `SurfaceTabLike` kinds differ.
- **EC-9** `craft-exec` used as PTY without G1 note: forbidden (FR-20).
- **EC-10** Renderer `SurfaceRegistry` not fully wired: terminal MUST still persist via URL/`SurfaceTabLike` even if contribution resolve falls back to legacy. `[INFERENCE]` from graph §3.

## 7. API Contracts

```ts
// Control RPC (existing plane). Names are normative; path prefix MAY be execution.*
export type TerminalControl =
  | { op: 'create'; sessionId?: string; cwd?: string }
  | { op: 'attach'; terminalId: string; epoch: number }
  | { op: 'detach'; terminalId: string; epoch: number }
  | { op: 'destroy'; terminalId: string; epoch: number }
  | { op: 'resize'; terminalId: string; epoch: number; cols: number; rows: number }
  | { op: 'signal'; terminalId: string; epoch: number; name: 'INT' | 'TERM' | 'KILL' }
  | { op: 'snapshot'; terminalId: string; epoch: number }
  | { op: 'take_control'; terminalId: string; epoch: number }

export type TerminalControlOk =
  | { terminalId: string; epoch: number }
  | { terminalId: string; epoch: number; cols: number; rows: number }

export type TerminalControlErr =
  | { code: 'FENCE_MISMATCH'; epoch: number }
  | { code: 'NOT_FOUND' }
  | { code: 'FLAG_OFF' }
  | { code: 'HOST_UNSUPPORTED' } // ssh/relay
  | { code: 'UNSUPPORTED' }      // pause etc.

// Data plane frame
export type TerminalFrameKind = 'out' | 'in' | 'resize' | 'snapshot'
export interface TerminalFrame {
  seq: number
  epoch: number
  kind: TerminalFrameKind
  payload: Uint8Array
}
```

No HTTP `/api/terminal`. No WorkGraph RPC. Success/error as above.

## 8. Data Models

| Entity | Field | Type | Constraints |
| --- | --- | --- | --- |
| Surface tab | `kind` | `'terminal'` | Required |
| Surface tab | `terminalId` | string | Non-empty opaque id |
| Surface tab | `sessionId` | string? | Existing session or omitted |
| ResourceControlLease | `epoch` | number | ≥ 1, monotonic |
| ResourceControlLease | `resource` | `'terminal'` | This slice |
| ExecutionHost | `kind` | `'local-electron'` | Only admitted value |
| ExecutionRun | `id` | string | Optional; not WorkflowRun/CloudRun |
| Flag | `workbench.terminal.v1` | boolean | Default false |
| Flag | `execution.coordinator.v1` | boolean | Default false |
| Frame | `seq` | number | Strictly increasing per terminal |
| D2 result | restore or `unsupported` | enum | No silent success |

No WorkItem table. No Turso schema.

## 9. Out of Scope

- **OS-1** WorkItem UI/kernel and parent WB-ADR-000 first vertical — M8 / rejected for this slice.
- **OS-2** Parent 81-commit merge, WorkGraph/Turso, PR #69 `workgraph.*` — import policy.
- **OS-3** SSH, relay, Web, iOS, CLI attach — M7.
- **OS-4** Cross-host handoff and reproducibility grades — M7 / D7.
- **OS-5** Packaged-build performance targets — G7 / M6.
- **OS-6** Choosing the PTY implementation inside this document — G1 (FR-20) is a gate, not a choice here.
- **OS-7** Replacing URL/panel-stack SoT or merging the two hosts — ADR-0001.
- **OS-8** Putting PTY bytes on `WsRpcServer` — forbidden, not deferred.
- **OS-9** Growing Session task leftover fields — forbidden.
- **OS-10** Agent workflow / orchestrator config — path D slice C, after this spec is Approved.

---

## Traceability

| AC | FR / NFR |
| --- | --- |
| AC-1 | FR-1, FR-2, NFR-3 |
| AC-2 | FR-3 |
| AC-3 | FR-4, NFR-3 |
| AC-4 | FR-5, FR-19 |
| AC-5 | FR-7, FR-8, NFR-4 |
| AC-6 | FR-9, FR-10 |
| AC-7 | FR-11, FR-14, NFR-5 |
| AC-8 | FR-12 |
| AC-9 | FR-13 |
| AC-10 | FR-15 |
| AC-11 | FR-16, NFR-2 |
| AC-12 | FR-17 |
| AC-13 | FR-18 |
| AC-14 | FR-20 |

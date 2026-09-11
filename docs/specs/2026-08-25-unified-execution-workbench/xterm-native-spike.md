# Xterm mount + native crate wiring spike

## 1. Title and Metadata

| Field | Value |
| --- | --- |
| Author | InfraXtermSpike (UEW slice 1+3) |
| Date | 2026-08-27 |
| Status | **Approved** (2026-08-27) — spike docs + flag-off stub only |
| Reviewers | Product owner (Mark); parent UEW orchestrator |
| Parent | [architecture.md](./architecture.md) (Accepted, M0) |
| Slice | [m3-first-slice.md](./m3-first-slice.md) FR-8, FR-15, FR-16, FR-20 |
| G1 | [g1-decision.md](./g1-decision.md) (`chosen: native-crate`) |
| Ground | `rox-one/rox-one` `origin/main` @ `4e956554c93c2e75457be60b14db050295bb5bee` |
| m4697 | `/root/Git/rox-one` pulled `--ff-only` to the same SHA on 2026-08-27 |
| Reviewers note | This PR MUST NOT ship a live PTY, enable flags, or put bytes on `WsRpcServer` |

## 2. Context

M3 landed the terminal `SurfaceContribution` (D0 / D1 / D2 honesty) with `render()` returning `null` and `createPty()` throwing until the G1 native crate exists. G1 chose `native-crate` and rejected `craft-exec-extended`, `node-pty`, and `multiplexer`. Architecture §8 already says the client xterm is a view over a server-owned VT projector. Architecture §29 still gates whether D2 restore is implemented or declared `unsupported`.

Today D2 is honesty-only: the desktop-restart test accepts `unsupported` and does not prove restore. A napi addon loaded into Electron main dies with the desktop process, so a silent “restored” tab after quit would be a live xterm over a dead PTY. That is the lie FR-15 forbids.

This spike exists so the next implementation slice can replace the placeholder host with xterm.js and wire `pty.rs` without re-litigating adapter shape or D2. Success for this PR: Approved spec, spike README with risk/rollback, and a flag-gated stub that mounts nothing when flags are default-false. Failure: any default-on flag, any PTY byte on JSON-RPC, any WorkItem, or a D2 path that reports success without a live host process.

Evidence: `terminal-contribution.ts` `render()` is null; `packages/server-core/src/execution/terminal/pty.ts` throws; `g1-decision.md` records native-crate and “D2 desktop restart stays explicit `unsupported` in M3”; m4697 `main` is `4e95655` after ff-only pull.

## 3. Functional Requirements

- **FR-1** This spike MUST document how `terminalContribution.render()` replaces the current null / placeholder host with an xterm.js view. The view MUST be a client projector only; the server-owned VT snapshot remains canonical (architecture §8).
- **FR-2** The xterm host MUST mount if and only if both `workbench.terminal.v1` and `execution.coordinator.v1` are requested and resolve enabled. Both flags MUST keep `defaultValue: false`.
- **FR-3** With flags off, the stub MUST NOT create a DOM host, MUST NOT import a live `@xterm/xterm` Terminal, and MUST NOT spawn a PTY.
- **FR-4** This spike MUST record the native crate wiring plan: a new workspace crate (name TBD; MUST NOT assume `craft-pty`) exposing `pty.rs` spawn / write / resize / kill / process-group teardown.
- **FR-5** The crate MUST be reachable by exactly one of two adapters, compared in this spec: (a) napi addon loaded by Electron main, or (b) Unix-socket sidecar next to `native/apps/craft-native`. This PR MUST NOT add the crate or either adapter.
- **FR-6** PTY bytes MUST NOT enter `serializeEnvelope` / `WsRpcServer`. Control stays on existing RPC (`TerminalControl`). Bytes stay on the framed binary plane (`TerminalFrame`).
- **FR-7 D2 restore hardening.** After desktop restart the system MUST run a liveness check against the native host process (sidecar pid, or explicit “main-owned / dead”). It MUST then return exactly one of: `restore` (live process + snapshot barrier) or `unsupported` (process gone / napi-in-main). It MUST NOT paint a live xterm for a dead PTY.
- **FR-8** napi-in-main MUST declare D2 `unsupported`. Only a sidecar that outlives Electron quit MAY return `restore`.
- **FR-9** A D2 restore, when allowed, MUST reattach the same `terminalId`, emit `kind: 'snapshot'` first, and only then `out` frames with `seq` greater than the snapshot barrier (M3 FR-11).
- **FR-10** This spike MUST NOT create a WorkItem, touch parent PR 81, or change `WsRpcServer`.
- **FR-11** The shipped stub (`apps/electron/src/renderer/platform/terminal-xterm.tsx`) MUST implement FR-2 / FR-3 as a mount planner plus optional host factory. `terminal-contribution.ts` MAY stay unwired in this PR.
- **FR-12** Rollback MUST be flag-off: deleting the requested flag keys returns pre-spike Electron behavior.

## 4. Non-Functional Requirements

- **NFR-1 Security.** Spike docs, stub logs, and later crate logs MUST NOT contain PTY contents, tokens, or absolute host home paths. Restore ledgers MUST store `terminalId`, `epoch`, and a host pid / adapter kind only.
- **NFR-2 Fail-closed flags.** Missing, malformed, or non-boolean flag values MUST behave as `false` (M3 NFR-2).
- **NFR-3 Compatibility.** Existing `terminal-surface` D0 / D1 / D2 honesty tests MUST stay green. This spike MUST NOT flip D2 honesty to silent success.
- **NFR-4 Isolation.** No PTY payload MAY be JSON-encoded onto the control plane. Credit framing stays on the binary plane.
- **NFR-5 Performance.** A later live mount SHOULD attach the xterm addon in under 100 ms on a local Electron renderer after flags are on. This spike MUST NOT claim that number; it is a target for the implementation slice.
- **NFR-6 Accessibility.** A later live xterm host SHOULD expose an `aria-label` of `Terminal {terminalId}`. This spike’s stub MAY omit ARIA because it does not mount when flags are off.
- **NFR-7 Rollback.** The stub and docs MUST be revert-safe: `git revert` of this commit plus flags default false leaves no native process and no xterm host.

## 5. Acceptance Criteria

### AC-1 Flag-off skip (FR-2, FR-3, FR-11, NFR-2)

Given a fresh requested flag set (`new Set()`)  
When `planXtermMount` / `isXtermMountEnabled` run  
Then the result is `{ kind: 'skipped', reason: 'flag-off' }`  
And `isXtermMountEnabled` is `false`  
And no host factory is invoked.

### AC-2 Flag-on stub plan (FR-1, FR-2, FR-11)

Given requested flags `{ workbench.terminal.v1, execution.coordinator.v1 }`  
When `planXtermMount` runs  
Then the result is `{ kind: 'stub', adapter: 'xterm.js', pty: 'native-crate-unwired' }`  
And the plan MUST NOT imply a live `@xterm/xterm` import in this PR.

### AC-3 Single-flag still off (FR-2, NFR-2)

Given only `workbench.terminal.v1` or only `execution.coordinator.v1`  
When `isXtermMountEnabled` runs  
Then it is `false`.

### AC-4 D2 napi honesty (FR-7, FR-8, NFR-3)

Given adapter kind `napi` and a desktop restart  
When `planD2Restore` runs  
Then the result is `{ status: 'unsupported', reason: 'napi-main-died' }`  
And the UI MUST NOT receive a live mount plan.

### AC-5 D2 sidecar restore vs dead (FR-7, FR-8, FR-9)

Given adapter kind `sidecar`  
When the sidecar pid is live  
Then `planD2Restore` is `{ status: 'restore', terminalId, via: 'snapshot-barrier' }`  
And when the sidecar pid is missing  
Then `planD2Restore` is `{ status: 'unsupported', reason: 'sidecar-dead' }`.

### AC-6 No RPC bytes (FR-6, FR-10, NFR-4)

Given this spike tree  
When `WsRpcServer` / `serializeEnvelope` are inspected  
Then this PR does not modify them  
And the stub never writes a `Uint8Array` PTY payload onto an RPC envelope.

### AC-7 No WorkItem / parent 81 (FR-10)

Given this spike tree  
When the diff is reviewed  
Then no WorkItem type, table, or RPC appears  
And no parent-81 merge commit is included.

### AC-8 Docs + rollback (FR-4, FR-5, FR-12, NFR-7)

Given `spikes/xterm-native/README.md`  
When a reviewer reads risk and rollback  
Then napi vs sidecar is compared  
And rollback is “flags default false + revert this commit”  
And D2 hardening (liveness check, no silent success) is stated.

### AC-9 Flags remain default false (FR-2, FR-12, NFR-2)

Given `packages/core/src/platform/workbench/flags.ts`  
When this PR is applied  
Then `workbench.terminal.v1` and `execution.coordinator.v1` still have `defaultValue: false`.

## 6. Edge Cases

- **EC-1** Partial flag set → treat as off (AC-3).
- **EC-2** `document` missing (unit test / main process) → planner still works; host factory MUST return `null` rather than throw.
- **EC-3** Sidecar pid file present but process not running → D2 `unsupported` / `sidecar-dead`, not `restore`.
- **EC-4** napi adapter after renderer reload only (D1, main still alive) → D2 planner is not consulted; D1 stays snapshot-barrier reattach (M3 FR-14).
- **EC-5** Restore ledger row with unknown `terminalId` → `unsupported` / `NOT_FOUND`, no new spawn.
- **EC-6** Host kind `ssh` or `relay` → coordinator already rejects (M3 FR-17); this spike MUST NOT add a remote PTY path.
- **EC-7** Future `@xterm/xterm` import failure with flags on → mount MUST fail closed (placeholder or error), never a fake live session. Not implemented in this PR.

## 7. API Contracts

```ts
type XtermMountPlan =
  | { kind: 'skipped'; reason: 'flag-off' }
  | { kind: 'stub'; adapter: 'xterm.js'; pty: 'native-crate-unwired' }

type PtyAdapterKind = 'napi' | 'sidecar'

type D2RestoreDecision =
  | { status: 'restore'; terminalId: string; via: 'snapshot-barrier' }
  | { status: 'unsupported'; reason: 'napi-main-died' | 'sidecar-dead' | 'not-found' }

function isXtermMountEnabled(requested: ReadonlySet<string>): boolean
function planXtermMount(requested: ReadonlySet<string>): XtermMountPlan
function mountTerminalXterm(
  parent: HTMLElement | null,
  requested: ReadonlySet<string>,
): { host: HTMLElement; dispose(): void } | null

function planD2Restore(input: {
  adapter: PtyAdapterKind
  terminalId: string
  sidecarAlive?: boolean
}): D2RestoreDecision
```

Success: flag-off → skipped; flag-on → stub plan; D2 napi → unsupported; D2 sidecar live → restore.

Error: missing `terminalId` on a restore attempt → `{ status: 'unsupported', reason: 'not-found' }`. No HTTP `/api/terminal`. No WorkGraph RPC.

Later crate surface (not in this PR):

```rust
// native/crates/<name-tbd>/src/pty.rs  (name MUST NOT be assumed craft-pty)
pub struct PtyHandle { /* pid, master fd */ }
pub fn spawn(cols: u16, rows: u16) -> Result<PtyHandle, PtyError>;
impl PtyHandle {
    pub fn write(&self, bytes: &[u8]) -> Result<(), PtyError>;
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError>;
    pub fn kill(&self) -> Result<(), PtyError>;
}
```

napi maps those methods into Electron main. Sidecar maps them onto a Unix-socket request next to `craft-native`. Neither adapter may call `serializeEnvelope`.

## 8. Data Models

| Entity | Field | Type | Constraints |
| --- | --- | --- | --- |
| XtermMountPlan | `kind` | `'skipped' \| 'stub'` | Required |
| XtermMountPlan | `reason` | `'flag-off'` | Required when skipped |
| XtermMountPlan | `adapter` | `'xterm.js'` | Required when stub |
| XtermMountPlan | `pty` | `'native-crate-unwired'` | Required when stub; this PR never flips to live |
| D2RestoreLedger | `terminalId` | string | Durable id; not a React key |
| D2RestoreLedger | `epoch` | number | Monotonic fence; start 1 |
| D2RestoreLedger | `adapter` | `PtyAdapterKind` | `napi` or `sidecar` |
| D2RestoreLedger | `sidecarPid` | number \| null | Null for napi; liveness input only |
| D2RestoreDecision | `status` | `'restore' \| 'unsupported'` | No third “success” |
| Flag | `workbench.terminal.v1` | boolean | default `false` |
| Flag | `execution.coordinator.v1` | boolean | default `false` |

No WorkItem table. No Turso schema. No PTY byte column.

## 9. Out of Scope

- **OS-1** Live `@xterm/xterm` dependency and `Terminal.open()` — next implementation slice after this spike.
- **OS-2** Adding the native crate, napi bindings, or sidecar binary — documented only.
- **OS-3** Wiring `terminalContribution.render()` — MAY stay `null` in this PR (FR-11).
- **OS-4** WorkItem / parent 81 / M8.
- **OS-5** Enabling either flag by default.
- **OS-6** PTY bytes on `WsRpcServer` / `serializeEnvelope`.
- **OS-7** D3–D7 durability (server restart, native runtime restart, host reboot, partition, cross-host).
- **OS-8** SSH / relay hosts.
- **OS-9** Assuming crate name `craft-pty`.
- **OS-10** Changing M3 D0 / D1 behavior.

---

## Traceability

| AC | FR / NFR |
| --- | --- |
| AC-1 | FR-2, FR-3, FR-11, NFR-2 |
| AC-2 | FR-1, FR-2, FR-11 |
| AC-3 | FR-2, NFR-2 |
| AC-4 | FR-7, FR-8, NFR-3 |
| AC-5 | FR-7, FR-8, FR-9 |
| AC-6 | FR-6, FR-10, NFR-4 |
| AC-7 | FR-10 |
| AC-8 | FR-4, FR-5, FR-12, NFR-7 |
| AC-9 | FR-2, FR-12, NFR-2 |

| EC | FR / NFR |
| --- | --- |
| EC-1 | FR-2, NFR-2 |
| EC-2 | FR-11 |
| EC-3 | FR-7, FR-8 |
| EC-4 | FR-9 / M3 FR-14 |
| EC-5 | FR-7 |
| EC-6 | M3 FR-17 |
| EC-7 | FR-3, NFR-2 |

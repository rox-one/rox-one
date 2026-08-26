# M7 Handoff and later surfaces — SSH / relay

## 1. Title and Metadata

| Field | Value |
| --- | --- |
| Author | Operator session 2026-08-27 (M7 handoff spec) |
| Date | 2026-08-27 |
| Status | **In Review** |
| Reviewers | Product owner (Mark) |
| Parent | [architecture.md](./architecture.md) §§12–15, D7 (Accepted, M0) |
| Local slice | [m3-first-slice.md](./m3-first-slice.md) FR-17 / AC-12 (Approved; local-only) |
| Plan | Session `agisota/2026-08-26-m4697-rox-one-sync` `WORK-PLAN.md` §M7 |
| Ground | `rox-one/rox-one` `origin/main` @ `4e95655` (M3 merged) |
| Reviewers note | Product code MUST NOT start until this spec is **Approved**. Flags stay default `false`. |

## 2. Context

The local first vertical slice is now real. M3 is merged on `origin/main` (`4e95655`). A local Electron user can attach a first-class terminal to an existing Session: control on RPC, bytes on a binary plane, fencing epoch, D0 detach, D1 snapshot+delta reattach. M3 **FR-17** still stands as the fail-closed default: `ExecutionCoordinator` admits only `ExecutionHost.kind === 'local-electron'`. SSH and relay MUST be rejected while their flags are off.

M7 exists because that local proof is no longer enough. Operators need the reserved host kinds (`ssh`, `relay`) and a honest cross-host continuation (D7). Architecture §13 already forbids the fiction of live process migration: handoff freezes a content-addressed manifest, mints a **new** `ExecutionRun` linked by `supersedes`, publishes a reproducibility grade, and fences the old controller. Architecture §12 orders routes: local Electron first, then SSH, then relay. Architecture §15 orders later viewers: CLI attach to a local host, then Web view of snapshot/deltas. iOS (OSS #966) is not a start.

WORK-PLAN M7 is the same cut: “Direct / SSH / relay routes after local slice is real” plus “artifact integrity + cross-host handoff with explicit grade.” Two deferred security imports become load-bearing here: TLS pin / local client bind, and parent vault quarantine (`6dde2607`, adapt — security, not PTY). The M3 prohibition on PTY bytes on `WsRpcServer` does not relax for relay.

Success: all AC-* below pass with every new flag default OFF (SSH/relay still rejected, matching FR-17). Implementation MUST NOT begin while Status is In Review.

## 3. Functional Requirements

- **FR-1** `ExecutionHost.kind` MUST include `'local-electron' | 'ssh' | 'relay'` as reserved in architecture §3.2. This slice MAY admit `ssh` and `relay` only when the matching flag is `true`.
- **FR-2** Feature flags `execution.host.ssh.v1`, `execution.host.relay.v1`, and `execution.handoff.v1` MUST default to `false`. Missing, malformed, or non-boolean values MUST behave as `false`.
- **FR-3** When `execution.host.ssh.v1` is not `true`, `ExecutionCoordinator.start` / `attachTerminal` / any admit path with `ExecutionHost.kind === 'ssh'` MUST be rejected with `FLAG_OFF` or `HOST_UNSUPPORTED`. No SSH session, PTY, or remote process MUST be created.
- **FR-4** When `execution.host.relay.v1` is not `true`, the same reject MUST apply to `kind === 'relay'`.
- **FR-5** M3 FR-17 remains the default: with both remote flags false, only `kind === 'local-electron'` is admitted.
- **FR-6** Route order MUST be local Electron → SSH → relay. Relay MUST NOT be the first implemented remote route. APIs MAY reserve relay types before the relay flag ships.
- **FR-7** A handoff MUST be an explicit coordinator command (normative name `handoff`). It MUST NOT be implied by detach, pause, or a network drop.
- **FR-8** A successful handoff MUST:
  1. Freeze a content-addressed manifest (cwd digest policy, command, policy id, stream snapshot hash).
  2. Transition the source `ExecutionRun` `any non-terminal → handoff_pending → superseded`.
  3. Mint a **new** `ExecutionRun` id. `stopped → running` remains illegal.
  4. Link the successor with `supersedes = <source ExecutionRunId>`.
  5. Publish a reproducibility grade: `bit_identical | input_reproducible | best_effort | not_reproducible`.
  6. Increment the fencing `epoch` of the handed-off resource.
- **FR-9** Handoff MUST NOT claim or implement live process migration. The source process is not moved. The successor is a new run reconstructed from the manifest.
- **FR-10** The successor `ResourceControlLease.epoch` MUST equal the post-increment epoch. Commands carrying the pre-handoff epoch MUST return `FENCE_MISMATCH` and MUST NOT apply on the source (if still reachable) or the successor.
- **FR-11** `handoff` MUST require `execution.handoff.v1 === true`. When the flag is off, the command MUST return `FLAG_OFF` and MUST NOT change run state or epoch.
- **FR-12** Relay control MUST use the existing JSON-RPC / WS control plane. Relay MUST NOT encode PTY bytes in JSON-RPC envelopes (`WsRpcServer` / `serializeEnvelope`).
- **FR-13** Relay PTY bytes MUST use the same separately framed binary data plane as M3: `{ seq, epoch, kind: 'out'|'in'|'resize'|'snapshot', payload }`.
- **FR-14** A relay (and SSH) command or frame whose `epoch` is stale MUST be rejected with `FENCE_MISMATCH` and MUST NOT apply. Credit-zero senders MUST stop.
- **FR-15** Reconnect on a remote host MUST deliver a server-owned VT snapshot then only deltas with `seq` greater than the snapshot barrier. Partial scrollback replay MUST NOT occur.
- **FR-16** `CredentialLease` (fabric broker) MUST remain distinct from `ResourceControlLease` (fence epoch). Secret material MUST NOT cross RPC. GRANT-style APIs MUST NOT accept secret fields.
- **FR-17** WorkItem MUST remain absent. Handoff, SSH, and relay MUST NOT create a WorkItem, WorkflowRun, or CloudRun, and MUST NOT grow `SessionManager` leftover `taskSlug` / `taskRunId` / `taskNodeId` fields.
- **FR-18** Names MUST stay distinct: `ExecutionRun` ≠ `WorkflowRun` ≠ `CloudRun`; `ClientDevice` ≠ `ExecutionHost` ≠ `Environment`.
- **FR-19** CLI attach (architecture §15) MAY attach to a **local** host using the same control RPC + binary plane. CLI MUST NOT become a second agent runtime.
- **FR-20** Web view (architecture §15) MAY render snapshot + ordered deltas of an existing run. Web MUST NOT take control unless it holds the current epoch via `take_control`.
- **FR-21** Every mutating coordinator command, including `handoff` and remote `take_control`, MUST carry `commandId` and `expectedEpoch`. Duplicate `commandId` MUST return the original result.

## 4. Non-Functional Requirements

- **NFR-1 TLS pin.** Every SSH and relay control or data connection MUST pin the expected identity before any PTY or secret metadata is exchanged: SSH host-key fingerprint, or TLS SPKI SHA-256 pin for relay TLS. A mismatch MUST fail closed with `TLS_PIN_MISMATCH` (relay) or `HOST_KEY_MISMATCH` (SSH). TOFU without a stored pin MUST NOT be treated as pinned. Pin comparison MUST be exact (no hostname-only trust).
- **NFR-2 Local client bind.** A relay listener started by this product MUST bind loopback (`127.0.0.1` / `::1`) unless an explicit, non-default bind config is set. Wildcard `0.0.0.0` / `::` MUST NOT be the default.
- **NFR-3 Vault quarantine.** Parent vault quarantine (`6dde2607`) MUST be adapted, not skipped. Vault material originating from or destined for an `ssh` / `relay` host MUST enter a quarantine state before use. Unquarantined refs MUST be rejected (`VAULT_QUARANTINED`). `ExecutionPolicy.secrets` on remote runs MUST be `'none'` or `'brokered'` — never implicit export into the PTY environment.
- **NFR-4 Redaction.** Binary, RPC, audit, and activity logs MUST NOT contain PTY contents, tokens, vault plaintext, pin private material, or absolute remote paths.
- **NFR-5 Fail-closed flags.** Same rule as M3 NFR-2 applied to FR-2 flags.
- **NFR-6 Transport isolation.** Adding SSH or relay MUST NOT require `WsRpcServer` to accept a new payload type for byte streams.
- **NFR-7 Compatibility.** With all M7 flags false, existing M3 local-terminal tests and session/browser/cloud-run routes MUST stay green. M3 AC-12 MUST still pass.
- **NFR-8 Determinism.** Fence epoch and `seq` MUST stay strictly monotonic per resource. Handoff is one fence event (epoch becomes `n+1`, never `n` and never a decrease).
- **NFR-9 Performance.** This spec MUST NOT invent latency or size percentages. Packaged-build numbers remain G7 / M6.
- **NFR-10 Testability.** AC-1 through AC-3 MUST be implementable with in-process fakes (no live SSH server or public network). TLS-pin and quarantine tests MAY use fixtures.

## 5. Acceptance Criteria

### AC-1 Handoff increments epoch (FR-7, FR-8, FR-10, NFR-8)

Given a running `ExecutionRun` on an admitted host whose terminal lease epoch is `n`  
And `execution.handoff.v1` is `true`  
When `handoff` succeeds toward a target `ExecutionHost`  
Then the source run is `superseded`  
And a new `ExecutionRun` exists with `supersedes` equal to the source id  
And a content-addressed manifest and a grade in the allowed set are stored  
And the successor lease epoch is `n+1`  
And a control command carrying epoch `n` returns `FENCE_MISMATCH`  
And no live process is reported as migrated.

### AC-2 Relay rejects stale epoch (FR-12, FR-13, FR-14)

Given a relay-attached terminal whose current epoch is `n+1`  
When a controller sends resize, signal, `in`, or `take_control` with epoch `n`  
Then the call returns `FENCE_MISMATCH`  
And the PTY size / process / stream is unchanged  
And no PTY payload appears inside `serializeEnvelope` for that call.

### AC-3 SSH host rejected when flag off (FR-2, FR-3, FR-5, NFR-5, NFR-7)

Given a fresh profile (no flag keys) or `execution.host.ssh.v1` set `false`  
When `ExecutionCoordinator.start` / `attachTerminal` is called with `ExecutionHost.kind === 'ssh'`  
Then the call is rejected with `FLAG_OFF` or `HOST_UNSUPPORTED`  
And no SSH connection, remote PTY, or local helper process for that host is created  
And M3 AC-12 still holds for `relay` when its flag is also off.

### AC-4 Relay bytes stay off JSON-RPC (FR-12, FR-13, NFR-6)

Given a relay-attached terminal producing output and `execution.host.relay.v1` is `true`  
When transport traces are inspected  
Then create / attach / resize / take_control / handoff appear as RPC  
And PTY output bytes do not appear inside `serializeEnvelope` payloads  
And data-plane frames carry `seq`, `epoch`, and `kind`.

### AC-5 Handoff flag off (FR-11, NFR-5)

Given a running local `ExecutionRun` at epoch `n` and `execution.handoff.v1` is not `true`  
When `handoff` is invoked  
Then the result is `FLAG_OFF`  
And the run state is unchanged  
And the epoch is still `n`.

### AC-6 TLS pin fail-closed (NFR-1)

Given a relay or SSH target whose stored pin / host-key fingerprint does not match the presented identity  
When the client attempts connect or handoff to that host  
Then the attempt fails with `TLS_PIN_MISMATCH` or `HOST_KEY_MISMATCH`  
And no PTY is attached  
And no vault material is sent.

### AC-7 Vault quarantine (FR-16, NFR-3)

Given a remote `ExecutionPolicy` that names a vault secret which is not quarantined  
When start, attach, or handoff would inject that secret  
Then the call is rejected with `VAULT_QUARANTINED`  
And the PTY environment does not contain the secret  
And the renderer RPC payload does not contain the secret.

### AC-8 No WorkItem (FR-17, FR-18)

Given a successful SSH admit, relay attach, or handoff  
When stores and RPCs are inspected  
Then no WorkItem record exists  
And no `tasks:*` RPC was used to start the run  
And `taskSlug` / `taskRunId` / `taskNodeId` on the session header are unchanged.

### AC-9 Manifest and grade (FR-8, FR-9)

Given a successful handoff  
When the successor run is read  
Then `manifestRef` is a content address of `{ cwdDigestPolicy, command, policyId, snapshotHash }`  
And `grade` is one of `bit_identical | input_reproducible | best_effort | not_reproducible`  
And the API does not expose a `migratedPid` or equivalent live-migration field.

### AC-10 Web does not steal the fence (FR-20, FR-14)

Given a Web viewer attached to a run whose controller epoch is `n`  
When the Web client sends a mutating control command without a successful `take_control`  
Then the command returns `FENCE_MISMATCH` or `NOT_CONTROLLER`  
And epoch remains `n`.

## 6. Edge Cases

- **EC-1** Handoff of a `stopped` or `failed` run → reject (`ILLEGAL_STATE`). Do not mint a successor. (FR-8)
- **EC-2** Handoff while already `handoff_pending` with the same `commandId` → return the original in-flight / completed result. A different `commandId` → reject (`HANDOFF_IN_PROGRESS`). (FR-21)
- **EC-3** Target host kind `ssh` while `execution.host.ssh.v1` is false → `FLAG_OFF` / `HOST_UNSUPPORTED`; source epoch unchanged. (FR-3, FR-11)
- **EC-4** Network partition mid-handoff (D6) → source MUST leave `handoff_pending` only by completing to `superseded` with a recorded successor, or by failing back to the previous non-terminal state with epoch unchanged. Silent `superseded` without a successor MUST NOT occur.
- **EC-5** Manifest snapshot hash does not match the last committed snapshot seq → fail closed (`MANIFEST_MISMATCH`); no successor.
- **EC-6** Relay presents a new TLS cert after a pin was stored → `TLS_PIN_MISMATCH`; do not update the pin implicitly. (NFR-1)
- **EC-7** SSH host key changed → `HOST_KEY_MISMATCH`; do not fall back to password/keyboard-interactive as a pin substitute. (NFR-1)
- **EC-8** Relay listener default bind → MUST be loopback. A test that starts relay with empty config and connects via a non-loopback address MUST fail. (NFR-2)
- **EC-9** Unquarantined vault ref on a local-electron run is out of this spec’s admit path; on `ssh`/`relay` it MUST fail as AC-7. (NFR-3)
- **EC-10** `WsRpcServer` handler that decodes a PTY byte payload on a relay method → forbidden; tests MUST fail the change. (FR-12)
- **EC-11** Stale epoch `0` or omitted epoch on relay → `FENCE_MISMATCH` or validation error; MUST NOT treat as “any epoch”. (FR-14)
- **EC-12** Credit underflow on relay data plane → clamp to 0; MUST NOT wrap. (FR-14)
- **EC-13** Flag turns off while an SSH/relay resource is live → new admits MUST refuse; existing resources MUST be destroyed or listed as leftover with a destroy API. Preferred: destroy on flag-off. (FR-2)
- **EC-14** Duplicate `commandId` after success → original result, including the already-incremented epoch. (FR-21)
- **EC-15** CLI attach to `kind === 'ssh'` when only CLI-to-local is implemented → `HOST_UNSUPPORTED`. (FR-19)
- **EC-16** Grade `bit_identical` MUST NOT be published unless snapshot hash, policy id, command, and cwd digest all match the source exactly. Otherwise the implementation MUST pick a weaker allowed grade. (FR-8)

## 7. API Contracts

```ts
// Flags — all default false
export type M7Flags = {
  'execution.host.ssh.v1': boolean
  'execution.host.relay.v1': boolean
  'execution.handoff.v1': boolean
}

export type ExecutionHostKind = 'local-electron' | 'ssh' | 'relay'

export interface ExecutionHost {
  id: string
  kind: ExecutionHostKind
  deviceId?: string
  // Present for ssh/relay. Pin material is a public fingerprint / SPKI hash, never a private key.
  pin?: { alg: 'sha256'; fingerprint: string }
}

export type ReproGrade =
  | 'bit_identical'
  | 'input_reproducible'
  | 'best_effort'
  | 'not_reproducible'

export interface HandoffManifest {
  cwdDigestPolicy: string
  command: string
  policyId: string
  snapshotHash: string
}

export type HandoffCmd = {
  op: 'handoff'
  commandId: string
  runId: string
  expectedEpoch: number
  targetHostId: string
}

export type HandoffOk = {
  sourceRunId: string
  successorRunId: string
  epoch: number            // post-increment; successor lease
  manifestRef: string      // content address
  grade: ReproGrade
}

export type RemoteControlErr =
  | { code: 'FENCE_MISMATCH'; epoch: number }
  | { code: 'FLAG_OFF' }
  | { code: 'HOST_UNSUPPORTED' }
  | { code: 'TLS_PIN_MISMATCH' }
  | { code: 'HOST_KEY_MISMATCH' }
  | { code: 'VAULT_QUARANTINED' }
  | { code: 'MANIFEST_MISMATCH' }
  | { code: 'ILLEGAL_STATE' }
  | { code: 'HANDOFF_IN_PROGRESS' }
  | { code: 'NOT_FOUND' }
  | { code: 'NOT_CONTROLLER' }
  | { code: 'UNSUPPORTED' }

// Relay / SSH reuse M3 TerminalControl. Bytes stay off this plane.
export type TerminalFrameKind = 'out' | 'in' | 'resize' | 'snapshot'
export interface TerminalFrame {
  seq: number
  epoch: number
  kind: TerminalFrameKind
  payload: Uint8Array
}
```

No HTTP `/api/terminal`. No WorkGraph RPC. No PTY field on JSON-RPC success or error bodies.

## 8. Data Models

| Entity | Field | Type | Constraints |
| --- | --- | --- | --- |
| ExecutionHost | `kind` | `'local-electron' \| 'ssh' \| 'relay'` | `ssh`/`relay` admitted only if flag true |
| ExecutionHost | `pin` | `{ alg, fingerprint }`? | Required before first remote connect; public only |
| ExecutionRun | `id` | string | New id on handoff; not WorkflowRun/CloudRun |
| ExecutionRun | `state` | enum | Includes `handoff_pending`, `superseded` |
| ExecutionRun | `supersedes` | string? | Set on successor; source id |
| ExecutionRun | `workItemId` | string? | MUST remain unset in this slice |
| HandoffManifest | `snapshotHash` | string | Content address; required |
| HandoffManifest | `grade` | ReproGrade | One of four literals |
| ResourceControlLease | `epoch` | number | ≥ 1, monotonic; +1 on handoff |
| CredentialLease | secret material | — | Never on RPC; quarantine first |
| Flag | `execution.host.ssh.v1` | boolean | Default false |
| Flag | `execution.host.relay.v1` | boolean | Default false |
| Flag | `execution.handoff.v1` | boolean | Default false |
| Frame | `payload` | Uint8Array | Binary plane only |

No WorkItem table. No Turso schema. No parent 81-commit types.

## 9. Out of Scope

- **OS-1** WorkItem UI/kernel and parent WB-ADR-000 first vertical — M8. Never required for terminals or handoff.
- **OS-2** iOS / iPadOS client (OSS #966) — later adapt, not an M7 start. Architecture §15 names it after Web.
- **OS-3** Parent 81-commit merge, WorkGraph/Turso, origin PR #8, OSS `v0.12.0` — import policy SKIP.
- **OS-4** Transparent live process migration — rejected (architecture §24).
- **OS-5** Putting PTY bytes on `WsRpcServer` — forbidden, not deferred.
- **OS-6** Growing Session leftover task fields — forbidden.
- **OS-7** Packaged-build performance targets — G7 / M6.
- **OS-8** Choosing the PTY implementation — G1; M7 reuses the M3 owner.
- **OS-9** Replacing URL/panel-stack SoT or importing parent `WorkspaceSurfaceHost` — ADR-0001.
- **OS-10** PR #69 convert/unbind onto `workgraph.*` — M4 adapts onto `fabric*` instead.
- **OS-11** Encryption-at-rest for a later graph — architecture §29 still gated.
- **OS-12** Public / LAN default bind for relay — rejected (NFR-2).

---

## Traceability

| AC | FR / NFR |
| --- | --- |
| AC-1 | FR-7, FR-8, FR-10, NFR-8 |
| AC-2 | FR-12, FR-13, FR-14 |
| AC-3 | FR-2, FR-3, FR-5, NFR-5, NFR-7 |
| AC-4 | FR-12, FR-13, NFR-6 |
| AC-5 | FR-11, NFR-5 |
| AC-6 | NFR-1 |
| AC-7 | FR-16, NFR-3 |
| AC-8 | FR-17, FR-18 |
| AC-9 | FR-8, FR-9 |
| AC-10 | FR-20, FR-14 |

| FR / NFR | AC |
| --- | --- |
| FR-1 | AC-3 (kind reserved; admit gated) |
| FR-4 | AC-3 (relay still rejected when off) |
| FR-6 | (order constraint; EC-15) |
| FR-15 | AC-4 (snapshot kind on data plane) |
| FR-19 | EC-15 |
| FR-21 | EC-2, EC-14 |
| NFR-2 | EC-8 |
| NFR-4 | AC-4, AC-7 |
| NFR-9 | (process: no invented %) |
| NFR-10 | AC-1, AC-2, AC-3 |

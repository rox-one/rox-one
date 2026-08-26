# Unified Execution Workbench

- **Document:** `docs/specs/2026-08-25-unified-execution-workbench/architecture.md`
- **Status:** Accepted for implementation (M0 landed 2026-08-26)
- **Grounded SHA:** `49afde6a46fe0619bef6adbcc9c65f11143ef670` (20 August 2026)
- **Does not replace:** [ADR-0001](../../architecture/adr/0001-rox-workbench-convergence.md)
- **Does not adopt:** parent `WB-ADR-000` first vertical (`WorkItem ↔ Session ↔ AgentRun`)
- **Provenance:** owner-corrected 2026-08-25 specification, reconstructed into this tree because no prior file existed on origin, parent, or named workbench branches. Claims below are tagged. This file is the contract; it is not a claim that packaged builds, PTY spikes, or soak tests have already run.

RFC 2119: MUST / MUST NOT / SHOULD / MAY.

---

## 1. Claim classes

| Tag | Meaning |
| --- | --- |
| `[VERIFIED]` | Confirmed on `49afde6a` by path or symbol |
| `[LOCKED]` | Owner decision; change requires a superseding ADR |
| `[GATED]` | Hypothesis until the named gate (G0–G7) exits |
| `[DEFERRED]` | Intentional later milestone |
| `[OUT OF SCOPE]` | Other program; MUST NOT appear in the first slice |

If this document and the code disagree about a fact, the code wins for the fact. If they disagree about a locked decision, the decision wins and the code is debt.

---

## 2. Architectural invariants

`[LOCKED]`

1. There is **no second agent runtime**. `ExecutionCoordinator` sits above existing `AgentBackend`, `SessionManager`, Task/Workflow runner, Cloud Run / `craft-rund`, and a future `TerminalManager`.
2. There is **no premature global event store**. Existing Session JSONL, task run-log, and Cloud Run registry remain authoritative. Rox MAY add a rebuildable `ExecutionActivity` projection via idempotent adapters, outboxes, and reconciliation.
3. Terminal **bytes MUST NOT** travel on the existing JSON-RPC / WS control plane. Control stays on RPC. Bytes use a separately benchmarked binary data plane.
4. `craft-pty` is **not** predetermined. A PTY spike MUST compare: extend `craft-exec`, a separate native PTY crate, `node-pty`, and an external multiplexer.
5. Reconnect MUST deliver a **valid screen snapshot** plus ordered deltas. Partial scrollback replay is forbidden.
6. Terminal ownership uses a **monotonically increasing fencing epoch**, not TTL-only leases. Delayed commands from a former controller MUST be rejected.
7. Names MUST stay distinct: `ExecutionRun`, `WorkflowRun`, `CloudRun`, `ClientDevice`, `ExecutionHost`, `Environment`, `CredentialLease`, `ResourceControlLease`.
8. WorkItem is **optional**. Scratch terminals, ad hoc Sessions, debug runs, and imports MAY exist without a WorkItem.
9. Pause returns `paused | partial | unsupported | failed` per resource capability. There is no fake universal pause.
10. Durability is D0–D7 (section 11). “Survives restart” without a D-code is not a requirement.
11. Cross-host continuation MUST create a **new linked** `ExecutionRun` from a content-addressed manifest with an explicit reproducibility grade. Transparent live migration is fiction.
12. New workflow / unattended paths MUST carry an explicit `ExecutionPolicy`. Implicit `allow-all` is forbidden.
13. Performance percentages MUST NOT be invented. Gates exist only after a reproducible packaged-build baseline.
14. Delivery is eight decision gates and nine milestones. There is no “18 PR” roadmap.
15. The first vertical slice is **only**: local Electron, an existing Session, first-class terminals, binary streaming, Resource Surfaces, detach, renderer-reload reattach.
16. URL + `NavigationContext` + panel-stack remain layout SoT. `WorkbenchLayoutHost` is a parallel seam, not the authoritative renderer. `[VERIFIED]` ADR-0001 addendum.

---

## 3. Domain boundaries and contracts

### 3.1 Existing authorities `[VERIFIED]`

| Concern | Owner | Path |
| --- | --- | --- |
| Conversation | `SessionManager` | `packages/server-core/src/sessions/SessionManager.ts` |
| Layout write path | URL + panel-stack | `NavigationContext`, `panel-stack.ts` |
| Parallel layout seam | `WorkbenchLayoutHost` | `packages/core/src/platform/workbench/` (flags default OFF) |
| Surface contributions | `SurfaceRegistry` | `packages/core/src/platform/surfaces/` |
| Tab kinds today | `SurfaceTab` | session, knowledge, browser, database, cloud-run, extension, diff |
| Workflow / task files | `WorkflowSpec` / `WorkflowRun` aliases | `packages/shared/src/tasks/` ; RPC `tasks:*` unchanged |
| Native runs | `craft-rund` + `run:*` | `native/crates/craft-rund` |
| Host bash sidecar | `craft-exec` | `native/crates/craft-exec` — **not** a PTY |
| Connection fabric | `fabric*` IPC + `ConnectionWorkGraph` | identity `workgraph.ts` is fabric, not parent WorkItem kernel |

`SessionManager` still carries leftover `taskSlug` / `taskRunId` / `taskNodeId`. `[LOCKED]` New task fields MUST NOT be added there.

### 3.2 New aggregates `[LOCKED]`

```ts
export type ExecutionRunId = string
export type ExecutionHostId = string
export type ClientDeviceId = string
export type EnvironmentId = string
export type ResourceControlLeaseId = string
export type CredentialLeaseId = string
export type FenceEpoch = number // monotonic, unsigned, starts at 1

export type ExecutionRunState =
  | 'created' | 'admitted' | 'running'
  | 'pausing' | 'paused' | 'stopping' | 'stopped'
  | 'failed' | 'handoff_pending' | 'superseded'

export interface ExecutionRun {
  id: ExecutionRunId
  sessionId?: string          // optional attach; Session stays conversation
  workItemId?: string         // optional; never required
  hostId: ExecutionHostId
  environmentId: EnvironmentId
  state: ExecutionRunState
  policyId: string
  createdAt: number
  updatedAt: number
}

export interface ExecutionHost {
  id: ExecutionHostId
  kind: 'local-electron' | 'ssh' | 'relay'
  deviceId?: ClientDeviceId
}

export interface Environment {
  id: EnvironmentId
  cwd: string                 // host-resolved; never a renderer path
  worktreeRef?: string
}

export interface ResourceControlLease {
  id: ResourceControlLeaseId
  resource: 'terminal' | 'browser' | 'run'
  resourceId: string
  holder: ClientDeviceId
  epoch: FenceEpoch
}

export interface CredentialLease {
  id: CredentialLeaseId
  connectionId: string
  // metadata only in renderer; secret material never crosses RPC
}

export interface ExecutionPolicy {
  id: string
  filesystem: 'none' | 'workspace' | 'allowlist'
  network: 'none' | 'allowlist'
  process: 'none' | 'allowlist'
  secrets: 'none' | 'brokered'
  capabilities: string[]
  timeMs?: number
  tokenBudget?: number
  costBudget?: number
  artifactMaxBytes?: number
}

export type PauseResult = 'paused' | 'partial' | 'unsupported' | 'failed'

export interface ExecutionCoordinator {
  start(cmd: StartExecution): Promise<ExecutionRun>
  pause(id: ExecutionRunId): Promise<PauseResult>
  stop(id: ExecutionRunId): Promise<void>
  attachTerminal(id: ExecutionRunId, opts: AttachTerminal): Promise<TerminalHandle>
}
```

### 3.3 SurfaceTab extension `[LOCKED]`

First slice MUST add one kind only:

```ts
| { kind: 'terminal'; terminalId: string; sessionId?: string }
```

S-00 already names a future console surface. `[VERIFIED]` No `terminal` kind exists on `49afde6a`.

---

## 4. Lifecycle state machines

### 4.1 ExecutionRun

```
created → admitted → running ⇄ pausing → paused
running → stopping → stopped
running → failed
paused  → running | stopping
any non-terminal → handoff_pending → superseded
stopped | failed | superseded are terminal
```

Illegal: `stopped → running` (that is a new run). `handoff_pending` MUST mint a new `ExecutionRun` id.

### 4.2 Terminal resource

```
allocated → attached → detached ⇄ attached
attached → snapshotting → attached
any → fenced (epoch++)
fenced holder’s in-flight commands → rejected
attached → destroyed
```

### 4.3 Pause `[LOCKED]`

Coordinator MUST query each resource. Mixed capabilities yield `partial`. A resource with no pause support yields `unsupported` for that resource and MUST NOT be reported as paused.

---

## 5. Command deduplication and concurrency

`[LOCKED]`

- Every mutating coordinator command carries `commandId` (client-generated opaque id) and `expectedVersion` or `expectedEpoch`.
- Duplicate `commandId` MUST return the original result (at-least-once safe).
- Stale `expectedEpoch` on a terminal command MUST return `FENCE_MISMATCH` and MUST NOT apply.
- Renderer Jotai MUST NOT be the domain write path (ADR-0001 decision 9).

---

## 6. Streams vs records

`[LOCKED]` four planes, not one bus:

| Plane | Transport | Contents |
| --- | --- | --- |
| Control | existing RPC | allocate, resize, attach, fence, pause |
| Binary stream | new data plane | PTY bytes, seq, credits |
| Activity | rebuildable projection | allowlisted metadata, hashes, refs |
| Audit | append-only, redacted | actor, commandId, epoch, outcome |

Presence stays ephemeral and server-authoritative (ADR-0001 decision 12). Audit MUST NOT store prompts, tokens, absolute paths, or artifact bytes.

---

## 7. Resource Surface and presenter

`[LOCKED]`

- A Resource Surface is a presenter over an existing domain object (Session, terminal, cloud-run, browser). It is **not** a domain entity.
- Detach keeps the resource alive on the host. The tab may close (D0) without destroying the PTY.
- Reattach after renderer reload (D1) MUST use the server projector snapshot, not a client scrollback buffer.
- `WorkbenchLayoutHost` MAY persist surface ids. It MUST NOT become write-path SoT.
- Parent two-key `WorkspaceSurfaceHost` MUST NOT be imported as the renderer owner.

---

## 8. PTY, projector, flow control

`[GATED:G1]` until the spike exits. Constraints that are already `[LOCKED]`:

- Control RPC: create, attach, resize, signal, destroy, snapshot, take_control.
- Data plane: framed records `{ seq, epoch, kind: 'out'|'in'|'resize'|'snapshot', payload }`.
- Credit-based flow control. Sender MUST stop when credits are 0.
- Snapshot barrier: a snapshot frame is a sync point; later deltas are invalid until the client acks that seq.
- Server-side VT projector owns canonical screen + scrollback bound. Client xterm is a view.
- Resize is a control command that also emits a barrier on the data plane.
- Process-tree kill MUST be host-owned (process group / job object). Destroying the surface tab is not sufficient.
- `native/crates/craft-exec` is a Bash sidecar today. Using it as the PTY is a G1 outcome, not a given.

---

## 9. ExecutionCoordinator adapters

`[LOCKED]`

| Adapter | Direction | MUST NOT |
| --- | --- | --- |
| Session | attach optional `executionRunId` | grow task fields on Session |
| Workflow / TaskRunner | project status into `ExecutionActivity` | become WorkItem |
| Cloud Run / craft-rund | project `run:*` status | let graph RPCs start/stop provider runs |
| TerminalManager | first-class resource | send bytes on JSON-RPC |
| Connection fabric | `CredentialLease` metadata | leak secrets to renderer |

Coordinator is a facade + policy + activity projection. It is not a new agent.

---

## 10. Permissions, leases, trust

`[LOCKED]`

- `CredentialLease` (fabric broker) ≠ `ResourceControlLease` (fence epoch).
- Terminal take_control increments epoch. Old epoch commands fail closed.
- Defaults for first-slice local terminals: workspace cwd, no implicit network allow-all, no implicit secret export into the PTY environment except brokered, allowlisted vars.
- Origin Connections already speak `fabric*`. Parent PR #69 convert/unbind MUST be adapted onto `fabric*`, not `workgraph.*`.
- `LOCAL_ONLY` is a routing class, not authorization. WorkGraph-style remote advertisement of local channels MUST NOT be copied.

---

## 11. Durability matrix D0–D7

| Code | Event | First-slice bar |
| --- | --- | --- |
| D0 | Surface close | Resource may detach; PTY remains until explicit destroy |
| D1 | Renderer failure | Snapshot + deltas restore the view |
| D2 | Desktop restart | Restore **or** explicit `unsupported`; never a silent lie |
| D3 | Server restart | `[DEFERRED]` M5 |
| D4 | Native runtime restart | `[DEFERRED]` M5 |
| D5 | Host reboot | `[DEFERRED]` M5 |
| D6 | Network partition | `[DEFERRED]` M5 |
| D7 | Cross-host continuation | `[DEFERRED]` M7; new linked run + manifest + grade |

---

## 12. Routes

| Route | First slice | Later |
| --- | --- | --- |
| Direct local Electron | REQUIRED | — |
| SSH | `[DEFERRED]` | After D3/D6 defined |
| Relay | `[DEFERRED]` | After SSH |

First slice MUST NOT implement SSH or relay. APIs MAY reserve `ExecutionHost.kind` values.

---

## 13. Artifacts and handoff

`[DEFERRED]` M7.

Handoff MUST:

1. Freeze a content-addressed manifest (cwd digest policy, command, policy id, stream snapshot hash).
2. Create a new `ExecutionRun` linked by `supersedes`.
3. Publish a reproducibility grade: `bit_identical | input_reproducible | best_effort | not_reproducible`.
4. Never claim live process migration.

---

## 14. Worktrees, agents, admission

`[DEFERRED]` after M3.

- Worktrees are `Environment` records, not Sessions.
- Agent admission is coordinator policy (`ExecutionPolicy` + host capacity).
- No WorkItem ceremony to start a terminal.

---

## 15. Web, iOS, CLI

`[DEFERRED]` M7.

Order: local Electron → CLI attach to local host → Web view of snapshot/deltas → iOS (OSS #966 is not a start). Each stage reuses the same control RPC + binary plane contracts.

---

## 16. Benchmark methodology

`[GATED:G7]`

Required measurements after a **packaged** local Electron build, not `bun dev`:

- PTY spawn p50/p95
- Resize to first paint
- Snapshot size at 10k lines bounded scrollback
- Credit stall recovery
- Renderer reload reattach time (D1)
- CPU/RSS of projector over 30 min soak

No percentage targets until this baseline exists.

---

## 17. Observability

Correlation tuple MUST appear on control, stream, activity, and audit:

`sessionId? + executionRunId + terminalId? + commandId + epoch + seq`

Diagnostics expose health, epoch, credit window, last snapshot seq, D-code support. They MUST NOT emit PTY contents, secrets, or absolute paths.

---

## 18. Migration, flags, rollback

`[LOCKED]`

- New flags: `workbench.terminal.v1`, `execution.coordinator.v1`. Default **false**.
- ADR-0001 `workbench.*` chrome flags stay independent.
- Flag off: legacy Session/chat/browser unchanged; no PTY process left running unless the user detached and the host policy says keep.
- Rollback of M1–M3 is flag-off + destroy detached terminals. No schema reverse migration in first slice.
- Parent WorkGraph / Turso MUST NOT be introduced as a side effect.

---

## 19. Decision gates

| Gate | Question | Exit |
| --- | --- | --- |
| G0 | Spec in tree and consistent with ADR-0001 | This file + addendum |
| G1 | PTY implementation choice | Written spike + chosen owner |
| G2 | Binary data plane design | Seq, credits, barriers specified **and** prototyped |
| G3 | Server VT projector | Reconnect = snapshot + deltas |
| G4 | Fencing epoch | Former controller rejected |
| G5 | Distinct type names | Types compile; no overloaded Run/Host/Lease |
| G6 | ExecutionPolicy required | No implicit allow-all on new paths |
| G7 | Packaged baseline | Numbers from a packaged build |

---

## 20. Milestones

| ID | Name | Exit |
| --- | --- | --- |
| M0 | Land spec | G0 |
| M1 | Types + coordinator skeleton | G5; pause matrix tests; no PTY |
| M2 | PTY spike (throwaway-capable) | G1 |
| M3 | First vertical slice | Section 21 |
| M4 | Policy + leases; PR #69 adapt onto `fabric*` | G6 |
| M5 | D3–D6 honesty + implementation | D-codes declared and tested |
| M6 | Observability + G7 baseline | Soak + packaged metrics |
| M7 | SSH/relay/handoff/Web/CLI | Section 12–15 |
| M8 | Optional WorkItem | Never required for terminals |

---

## 21. First vertical-slice acceptance

All MUST be true, local Electron only:

1. Open a terminal on an existing Session without creating a WorkItem.
2. Control uses existing RPC; bytes do not.
3. Renderer reload shows a valid snapshot then ordered deltas.
4. Takeover increments epoch; old controller commands fail.
5. D0 detach and D1 reattach work. D2 is restore or explicit `unsupported`.
6. Flags default OFF.
7. No WorkGraph/Turso, no parent SurfaceHost owner rewrite, no Web/iOS/CLI, no cross-host handoff.

---

## 22. Testing

| Kind | First required at |
| --- | --- |
| Unit (types, fence, pause matrix, parse) | M1 |
| Property (seq monotonic, credit never negative) | M2/M3 |
| Integration (Electron attach/detach) | M3 |
| Protocol (frame codec, barrier) | M3 |
| Fuzz (decoder) | M3 |
| Fault injection (kill renderer, drop credits) | M3 |
| Soak (30 min projector) | M6 |
| Security (no secret in RPC logs, GRANT rejects secret fields) | M4 |

---

## 23. Risks and kill criteria

| Risk | Mitigation |
| --- | --- |
| Four meanings of “workbench” | This spec = execution; ADR-0001 = layout; parent WB-ADR-000 = WorkItem graph; session memo-rail = other |
| `craft-exec` temptation | G1 forbids predetermined PTY |
| Parent 81-commit merge | Forbidden; 49-file conflict already observed |
| Session leftover task fields | No new writes |
| Missing original 11.2k draft | This file is the in-tree contract |

**Kill:** if G1 cannot produce snapshot+delta PTY in one local Electron process, stop. Do not start Resource Surfaces, handoff, or iOS.

---

## 24. Rejected designs

- Second `AgentBackend` / parallel SessionManager
- Global event sourcing as the first store
- Terminal bytes on JSON-RPC
- Predetermined `craft-pty`
- Invalid partial scrollback replay
- TTL-only control lease
- Overloaded `Run` / `Host` / `Lease`
- Mandatory WorkItem
- Fake universal pause
- Vague “survives restart”
- Transparent cross-host migration
- Implicit unattended allow-all
- Invented performance percentages
- 18-PR roadmap
- Giant first slice (Web + iOS + SSH + WorkItem + PTY together)
- Merge of parent `5797f431..151ffca6`
- Merge of origin PR #8 `rox-workbench-convergence-bb11`
- Cherry-pick OSS `abdc281a` (`v0.12.0`) as load-bearing

---

## 25. Milestone Definition of Done

A milestone is done only when:

- its exit table row is true,
- required tests from section 22 exist and were run,
- flags default remains false unless the milestone explicitly ships on,
- a short evidence note lists SHA + commands run (no secret values).

M0 DoD: this file and the ADR-0001 addendum are on a reviewable branch from `49afde6a`.

---

## 26. Repository evidence map

| Fact | Evidence |
| --- | --- |
| Ground SHA | `49afde6a46fe0619bef6adbcc9c65f11143ef670` |
| Layout SoT | ADR-0001; `WorkbenchLayoutHost` parallel |
| No terminal tab | `packages/core/src/platform/surfaces/types.ts` 7-variant union |
| No ExecutionCoordinator | code search empty on origin |
| craft-exec ≠ PTY | `native/crates/craft-exec` Bash sidecar |
| Connection fabric already on origin | `fabric*` IPC; `ConnectionWorkGraph` |
| Parent WorkGraph kernel | `agisota/craft-agents-oss` `packages/server-core/src/workgraph` — not origin |
| Parent +81 / origin +222 | compare `rox-one:main...agisota:main` |
| OSS +1 | `abdc281a` v0.12.0 docs/version |
| Parent PR #69 | open, stale base, adapt-only onto `fabric*` |

---

## 27. Relationship to ADR-0001

ADR-0001 remains the layout/domain-naming ADR. This spec adds the **execution** program. Conflicts are resolved as:

- WorkItem ≠ Run — both agree; WorkItem stays unimplemented until M8.
- Session = conversation — both agree.
- WorkGraph kernel — ADR-0001 keeps it out; this spec agrees for M0–M7.
- First vertical — this spec **overrides** parent WB-ADR-000; it does **not** override ADR-0001.

---

## 28. Import policy (parent and OSS)

See session plan `agisota/2026-08-26-m4697-rox-one-sync` `WORK-PLAN.md` for the full table.

Summary: SKIP parent 81-commit merge; SKIP OSS `v0.12.0`; ADAPT PR #69 onto `fabric*` after M3; SKIP origin PR #8.

---

## 29. Still gated (not decided here)

- Which of the four PTY options wins (G1)
- Exact binary framing library / port binding
- Packaged baseline numbers (G7)
- Whether D2 restore is implemented or declared `unsupported` in M3
- Encryption-at-rest for any later graph

---

## 30. History

| Date | Change |
| --- | --- |
| 2026-08-25 | Owner-corrected specification (external draft) |
| 2026-08-26 | Landed in this path from `49afde6a`; reconstruction tagged |

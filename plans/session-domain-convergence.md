# Session domain convergence

- **Date:** 2026-08-12 · **Repo:** `rox-one/rox-one` @ `main` `5797f431`
- **Grounding evidence:** `packages/shared/src/sessions/types.ts` (`SessionHeader`),
  `packages/core/src/types/session.ts`, `packages/shared/src/protocol/dto.ts`,
  `packages/server-core/src/sessions/SessionManager.ts`,
  `packages/cloud-runner/*`, Tasks Conductor fields, and `plans/integration-audit.md`.

## 1. Current model (as implemented)

A "session" is a single append-only JSONL file per session. **Line 1 is
`SessionHeader`** — a god-object — followed by `StoredMessage` lines. There is
**one** persisted entity; everything hangs off the header.

`SessionHeader` (from `sessions/types.ts`) currently conflates at least seven
distinct concerns:

| Concern | Fields on `SessionHeader` today |
|---|---|
| **Conversation identity + read state** | `id`, `name`, `preview`, `messageCount`, `lastMessageRole`, `lastMessageAt`, `lastReadMessageId`, `lastFinalMessageId`, `hasUnread` |
| **Run configuration** (per session, mutable, "locked after first message") | `model`, `llmConnection`, `connectionLocked`, `thinkingLevel`, `permissionMode`, `previousPermissionMode`, `memoryMode`, `enabledSourceSlugs`, `workingDirectory`, `sdkCwd`, `sdkSessionId` |
| **Run state / budget** | `tokenUsage`, `pendingPlanExecution`, `transferredSessionSummary(+Applied)` |
| **Collection / ops metadata** | `sessionStatus`, `labels`, `isFlagged`, `isArchived`, `archivedAt`, `hidden`, `rank`, `priority`, `dueDate`, `kanbanColumn`, `projectId` |
| **Task-DAG orchestration** | `parentSessionId`, `taskSlug`, `taskRunId`, `taskNodeId`, `taskNodeCount`, `taskDraft` |
| **Sharing** | `sharedUrl`, `sharedId` |
| **Provenance** | `triggeredBy` (automation name/event/timestamp) |

### The "run" concept is already fragmented into three things

There is no unified `AgentRun`. Instead a "run" means different things in
different places:

1. **A turn** inside a session (`SessionManager.sendMessage` → agent turn,
   `tokenUsage`, `wasInterrupted`, mid-stream steer/queue) — ephemeral, not a
   persisted entity.
2. **A Cloud Run** (`packages/cloud-runner` provider contract + `cloudRuns:*`
   RPC, `<configDir>/cloud-runs.env`) — a persisted, provider-executed run with
   status/events/artifacts, but a *parallel* store, not tied to the session
   entity.
3. **A Task node run** (`taskRunId` / `taskNodeId` / `taskNodeCount` on the
   header, Tasks Conductor DAG) — orchestration IDs smuggled onto the header.

Similarly there is **no** `ContextSnapshot`, `RunAuthorizationSnapshot`,
`SandboxLease`, or first-class `Artifact` entity (audit §3.8: "artifact" today
means build tarballs / cloud-run outputs / rich chat markdown blocks, not a
durable product entity).

## 2. Semantic collisions (why this hurts)

- **Config vs conversation lifetime.** `connectionLocked` exists precisely
  because run config is welded to the conversation: you cannot re-run the same
  conversation under a different model/permission scope without mutating (and
  "locking") the single header. A conversation should be re-runnable.
- **Reproducibility is impossible.** The exact context (sources, working dir,
  soul.md/rules.md, memory, model, permissions) at the moment a turn ran is not
  snapshotted — the header only holds the *current* values, which drift. There is
  no way to reproduce or audit "what authorization/context produced this output".
- **Three run notions don't compose.** A Cloud Run, a local turn, and a Task node
  are not the same type, so queueing/retry/budget/checkpoint logic cannot be
  shared; each surface reimplements status.
- **Ops metadata pollutes the runtime record.** `rank`/`priority`/`dueDate`/
  `kanbanColumn`/`labels` are board concerns living on the same object the agent
  runtime reads/writes, so every collection change rewrites the session header.
- **Sandbox/isolation is implicit.** `workingDirectory`/`sdkCwd`/SSH-remote
  workdir/`agent-browser` panes are lifecycle-managed ad hoc with no lease entity,
  so isolation guarantees and cleanup are not modeled.

## 3. Target mapping (current → intended)

| Target entity | Composed from today | New vs refactor |
|---|---|---|
| **Conversation** | `SessionHeader` identity/read fields + `StoredMessage[]` | Refactor: the JSONL file becomes the Conversation record |
| **AgentRun** | a turn's runtime + Cloud Run + Task-node run, unified | **New unifying entity**; wrap the 3 existing notions behind one contract |
| **ContextSnapshot** | the assembled prompt context (sources, cwd, context-docs, memory, model) at run start — currently unpersisted | **New** (immutable, referenced by AgentRun) |
| **RunAuthorizationSnapshot** | effective `permissionMode` + `permissions.json` layers + host-tool scopes at run start | **New** (immutable, referenced by AgentRun) |
| **SandboxLease** | `workingDirectory`/`sdkCwd`, worktree, SSH-remote workdir, `agent-browser` pane, cloud sandbox | **New** (leased/lifecycled per AgentRun) |
| **Artifact / RunOutput** | cloud-run artifacts + shared-session output + (promote) rich chat blocks | **New** first-class entity |
| **CollectionItem** (ops) | `rank`/`priority`/`dueDate`/`kanbanColumn`/`labels`/`sessionStatus`/`isFlagged`/`isArchived`/`hidden`/`projectId` | Refactor out of the runtime header into an ops projection |

## 4. Migration strategy — compatibility layer first, no big-bang

**Principle:** the JSONL-per-session store, `SessionHeader` shape, and all
`sessions:*` RPC/DTO contracts must keep working unchanged while the new entities
are introduced as *derived views* and then, only later, as *owners*.

### Stage 0 — Types + read-side projections (no schema/behavior change)
- Introduce TS types `Conversation`, `AgentRun`, `ContextSnapshot`,
  `RunAuthorizationSnapshot`, `SandboxLease`, `Artifact` in `packages/core`.
- Add pure **projection functions** `SessionHeader → { Conversation, latest
  AgentRun view, CollectionItem }`. No persistence changes; header stays canonical.
- Tests: golden projections over existing session fixtures. **Rollback:** delete
  the new types (nothing consumes them yet).

### Stage 1 — AgentRun as the unifying read contract
- Define one `AgentRun` contract and back it by the three existing notions
  (turn / Cloud Run / Task node) via adapters — **no new store yet**. Expose a
  read-only `agentRuns:list/get` RPC computed from existing data.
- Tests: adapter conformance (a local turn, a Cloud Run, and a Task node all
  satisfy the `AgentRun` contract). **Rollback:** unregister the RPC.

### Stage 2 — Context + Authorization snapshots (write, additive)
- At turn start, persist a `ContextSnapshot` + `RunAuthorizationSnapshot` sidecar
  (e.g. `sessions/<id>/runs/<runId>.json`) capturing the exact context/permissions.
  Header remains source of truth for *current* config; snapshots are additive and
  immutable.
- Tests: snapshot captured once per turn (reuse the "call the volatile-context
  builder exactly once per turn" invariant from `packages/shared/CLAUDE.md`);
  reproduce-from-snapshot smoke. **Rollback:** stop writing sidecars; readers
  tolerate their absence.

### Stage 3 — SandboxLease
- Model `workingDirectory`/`sdkCwd`/worktree/SSH-remote/`agent-browser`/cloud
  sandbox acquisition + release as a `SandboxLease` owned by an `AgentRun`; wire
  cleanup to lease end. Start with the local worktree/cwd case; keep existing
  fields as the lease's persisted anchor.
- Tests: lease acquire/release, orphan cleanup. **Rollback:** leases wrap but do
  not replace current cwd handling.

### Stage 4 — Ops projection split
- Move collection/ops fields (`rank`/`priority`/`dueDate`/`kanbanColumn`/
  `labels`/status/flags/archive/`hidden`/`projectId`) to a `CollectionItem`
  projection persisted in the existing `collection/` workspace store; keep header
  fields as deprecated mirrors written through a single adapter until all readers
  migrate. (The collection system already has its own store — audit §3.6 — so
  this is consolidation, not new infra.)
- Tests: existing collection suites stay green; board/table/list read the
  projection. **Rollback:** header mirrors remain authoritative.

### Stage 5 — Artifact / RunOutput
- Promote cloud-run artifacts + shared-session outputs to a first-class
  `Artifact` entity referenced by `AgentRun`; optionally capture selected rich
  chat blocks. Additive store.

### Stage 6 — Flip ownership (guarded)
- Behind a feature flag (pattern: `packages/shared/src/feature-flags.ts`, same as
  `CRAFT_FEATURE_KNOWLEDGE` / `featureUnifiedShellAtom`), make Conversation +
  AgentRun the owners and derive `SessionHeader` for legacy readers via a
  serializer. Ship OFF; enable after burn-in. **Rollback:** flip the flag OFF —
  the legacy header path is still fully intact.

## 5. Cross-cutting requirements

- **Schema changes:** additive sidecars first (`runs/`, snapshots, artifacts);
  the JSONL header shape is only *reduced* in Stage 4+ and only after mirrors are
  proven redundant. Provide a `SessionHeader`-v→v+1 reader migration (there is
  precedent: `storage-migrations`, `jsonl-permission-mode-normalization`).
- **Event changes:** existing `sessions:*` / `permission_mode_changed` /
  `sessions:bulkChanged` events keep firing; add `agentRun:*` events derived from
  the same emissions in Stage 1; do not remove legacy events until Stage 6.
- **UI changes:** none through Stage 4 (projections feed the same components); a
  "Run" inspector (reusing the Cloud Runs / runtime-inspector surfaces) can render
  `AgentRun` + snapshots in Stage 2+; ops views already consume a collection store.
- **Tests:** projection goldens (S0), adapter conformance (S1), snapshot
  once-per-turn + reproduce (S2), lease lifecycle (S3), collection-suite parity
  (S4), flag-off/flag-on equivalence (S6). Gate each stage on `typecheck:all` +
  `test:shared:all` + i18n lints staying green.
- **Rollback:** every stage is additive or flag-guarded; the legacy
  single-`SessionHeader` path remains the fallback until Stage 6 burn-in
  completes.

## 6. Explicitly out of scope for now

- No migration of the on-disk JSONL layout in this plan's early stages.
- No removal of Tasks Conductor / Cloud Runs stores — they become `AgentRun`
  adapters, not casualties.
- The control-plane build-out (queue/runtime-gateway/policy-gateway/sandbox-broker
  from the brief) depends on the SOURCE_GAP resolution in
  `plans/repository-archaeology.md` §6 and on `AgentRun` existing first (Stage 1),
  so it is sequenced after this convergence, not before.

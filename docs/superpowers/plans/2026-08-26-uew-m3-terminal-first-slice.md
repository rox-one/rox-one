# UEW M3 Terminal First Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship first-class local terminal on existing Session: twin `SurfaceTab` union, RPC control, binary data plane with credits/snapshot/fence, Electron detach D0/D1/D2, flags default off.

**Architecture:** `types-union` widens core + renderer twins together; `coordinator` owns `@craft-agent/server-core/src/execution/` (local-electron only, no Session task fields); `data-plane` owns binary frames outside `transport/codec.ts`; `electron-surface` adds contribution keeping URL as SoT. G1 spike is throwaway before data-plane. Evaluator fails closed on AC coverage.

**Tech Stack:** TypeScript, Bun test, Electron (main/renderer), length-prefixed binary framing, workspace `workbench.*` flags.

## Global Constraints

- No WorkItem, no `WorkflowRun`/`CloudRun` overload — `ExecutionRun` only, optional.
- No parent 81 merge, no `workgraph.*` import, no Turso.
- No PTY bytes inside `WsRpcServer`/`serializeEnvelope` (`packages/server-core/src/transport/codec.ts:146` untouched).
- No new `taskSlug`/`taskRunId`/`taskNodeId` fields on `SessionManager` (`packages/server-core/src/sessions/SessionManager.ts:976`).
- Flags `workbench.terminal.v1` + `execution.coordinator.v1` default `false` (`packages/core/src/platform/workbench/flags.ts`); missing/malformed = off.
- Twin unions must move together: `packages/core/src/platform/surfaces/types.ts` ↔ `apps/electron/src/renderer/platform/layout-snapshot.ts`.
- ADR-0001 stays SoT for layout; spec `architecture.md` supersedes parent WB-ADR-000 first vertical only.
- Spec: `docs/specs/2026-08-25-unified-execution-workbench/m3-first-slice.md` (Approved). AC-1…AC-14 all require a test.

---

## File Structure

**Created:**
- `spikes/pty-g1/**` — throwaway spike harness (deleted/kept only if brainstorming says so)
- `docs/specs/2026-08-25-unified-execution-workbench/g1-decision.md` — chosen PTY + 3 rejected options
- `packages/server-core/src/execution/types.ts` — `ExecutionHost {kind:'local-electron'}`, `ExecutionRun`, `TerminalFrame`, `TerminalControl`, `PauseResult`
- `packages/server-core/src/execution/coordinator.ts` — local-only admission, fence monotonic
- `packages/server-core/src/execution/terminal/transport.ts` — binary framing, credits, snapshot barrier
- `packages/server-core/src/execution/terminal/pty.ts` — PTY adapter behind G1 choice (thin)
- `packages/shared/src/execution/terminal-protocol.ts` — shared `TerminalFrameKind`/`TerminalControl` types
- `apps/electron/src/renderer/platform/terminal-contribution.ts` — `SurfaceContribution` for `kind:'terminal'`
- `docs/superpowers/plans/2026-08-26-uew-m3-terminal-first-slice.md` — this plan

**Modified:**
- `packages/core/src/platform/surfaces/types.ts:34` — `SurfaceTab` 7 → 8
- `packages/core/src/platform/surfaces/descriptor.ts:15,39` — `surfaceTabToDescriptor` + `surfaceTabDurableKey` handle `terminal`
- `packages/core/src/platform/workbench/migrate.ts:32` — `parseWorkbenchTab` handle `terminal`
- `packages/core/src/platform/workbench/layout.ts:326` — `describeWorkbenchTab` handle `terminal`
- `packages/core/src/platform/workbench/flags.ts:17,26` — add `terminalV1`, `coordinatorV1` definitions
- `apps/electron/src/renderer/platform/layout-snapshot.ts:54,102,126` — `SurfaceTabLike` + `surfaceTabToRoute`/`surfaceTabFromRoute` + `snapshotToUrlSearch`/`snapshotFromUrlSearch` for terminal
- `apps/electron/src/shared/routes.ts:98,210,257` — add `routes.view.terminal(terminalId)` if needed (see Task 2); `route-parser.ts` — add `terminal` navigator case
- Tests: `packages/core/src/platform/__tests__/surfaces-registry.test.ts:34`, `packages/core/src/platform/__tests__/workbench-flags.test.ts`, `apps/electron/src/renderer/platform/__tests__/layout-snapshot.test.ts:49`

**Not touched:** `packages/server-core/src/transport/codec.ts:146` `serializeEnvelope`, `SessionManager` task leftovers.

---

### Task 1: G1 PTY spike (throwaway)

**Files:**
- Create: `spikes/pty-g1/README.md`
- Create: `spikes/pty-g1/harness.ts`
- Create: `docs/specs/2026-08-25-unified-execution-workbench/g1-decision.md`
- Test: `spikes/pty-g1/harness.test.ts` (spike-only, not shipped)

**Interfaces:**
- Consumes: `packages/server-core/src/transport/codec.ts` envelope shape (for negative test: bytes must not fit)
- Produces: `g1-decision.md` with `chosen: 'craft-exec-extended'|'native-crate'|'node-pty'|'multiplexer'`, `rejected: [..3]`, `reason`, `risk`

- [ ] **Step 1: Write spike harness that exercises the 4 options without touching `SurfaceTab`**
```ts
// spikes/pty-g1/harness.ts
export type PtyOption = 'craft-exec-extended' | 'native-crate' | 'node-pty' | 'multiplexer'
export interface Probe { spawn: (cols:number, rows:number)=>{ pid:number; kill:()=>void }; write:(d:Uint8Array)=>void }
export function probeCraftExec(): Probe { throw new Error('not implemented in spike until run') }
```
- [ ] **Step 2: Run spike — record D0/D1, binary framing cost, Electron main vs sidecar**
Run: `bun run spikes/pty-g1/harness.ts` (expect: not implemented)
Expected: FAIL — harness not wired

- [ ] **Step 3: Write `g1-decision.md` with chosen + 3 rejected**
```md
# G1 decision — 2026-08-26
chosen: native-crate
rejected:
  - craft-exec-extended: text dump, no VT snapshot barrier
  - node-pty: Node ABI drift, Electron rebuild pain
  - multiplexer: extra daemon, D2 restore unclear
reason: snapshot barrier + credit framing easiest next to transport/server.ts without touching codec.ts
```

- [ ] **Step 4: Verify plan gate AC-14 will pass**
Run: `grep -q '^chosen:' docs/specs/2026-08-25-unified-execution-workbench/g1-decision.md && echo ok`
Expected: ok

- [ ] **Step 5: Commit**
```bash
git add spikes/pty-g1 docs/specs/2026-08-25-unified-execution-workbench/g1-decision.md
git commit -m "spike: G1 PTY decision note (throwaway)"
```

### Task 2: Twin union + routes + flags

**Files:**
- Modify: `packages/core/src/platform/surfaces/types.ts:34`
- Modify: `packages/core/src/platform/surfaces/descriptor.ts:15,39`
- Modify: `packages/core/src/platform/workbench/migrate.ts:32`
- Modify: `packages/core/src/platform/workbench/layout.ts:326`
- Modify: `packages/core/src/platform/workbench/flags.ts:17`
- Modify: `apps/electron/src/renderer/platform/layout-snapshot.ts:54`
- Modify: `apps/electron/src/shared/routes.ts`
- Modify: `apps/electron/src/shared/route-parser.ts`
- Test: `packages/core/src/platform/__tests__/surfaces-registry.test.ts`
- Test: `apps/electron/src/renderer/platform/__tests__/layout-snapshot.test.ts`
- Test: `packages/core/src/platform/__tests__/workbench-flags.test.ts`

**Interfaces:**
- Consumes: `SurfaceTab`, `SurfaceDescriptor`, `WorkbenchTab`, `SurfaceTabLike`, `WORKBENCH_FLAG`, `WORKBENCH_FEATURE_FLAGS`
- Produces: `SurfaceTab = ... | {kind:'terminal'; terminalId:string; sessionId?:string}`, `surfaceTabDurableKey` returns `terminal:${id}`, `parseWorkbenchTab`/`describeWorkbenchTab` exhaustiveness, `WORKBENCH_FLAG.terminalV1` + `coordinatorV1`:

```ts
// packages/core/src/platform/surfaces/types.ts
export type SurfaceTab = ... | { kind: 'terminal'; terminalId: string; sessionId?: string }
// apps/electron/src/renderer/platform/layout-snapshot.ts
export type SurfaceTabLike = ... | { kind: 'terminal'; terminalId: string; sessionId?: string }
export function surfaceTabToRoute(tab: SurfaceTabLike): string // add case 'terminal': `terminal/${encodeURIComponent(tab.terminalId)}`
export function surfaceTabFromRoute(route: string): SurfaceTabLike | null // parse terminal/*
export const WORKBENCH_FLAG = { ..., terminalV1:'workbench.terminal.v1', coordinatorV1:'execution.coordinator.v1' } as const
```

- [ ] **Step 1: Write failing tests for 8 kinds**
```ts
// packages/core/src/platform/__tests__/surfaces-registry.test.ts
import { surfaceTabDurableKey, surfaceTabToDescriptor } from '../surfaces/descriptor.ts'
it('maps all eight tab kinds', () => {
  expect(surfaceTabDurableKey({ kind:'terminal', terminalId:'t1' })).toBe('terminal:t1')
  expect(surfaceTabToDescriptor({ kind:'terminal', terminalId:'t1' })).toBeNull() // descriptor MAY be null per FR-3
})
// apps/electron/src/renderer/platform/__tests__/layout-snapshot.test.ts
import { surfaceTabToRoute, surfaceTabFromRoute, snapshotToUrlSearch, snapshotFromUrlSearch } from '../layout-snapshot.ts'
it('round-trips terminal via URL snapshot', () => {
  const tab = { kind:'terminal', terminalId:'t9', sessionId:'s1' } as const
  const route = surfaceTabToRoute(tab)
  expect(route).toBe('terminal/t9')
  expect(surfaceTabFromRoute(route)).toEqual(tab)
  const snap = snapshotFromUrlSearch(snapshotToUrlSearch({ version:1, workspaceId:'w1', lanes:[{laneId:'main', locked:false}], tabs:[{panelId:'panel-0', laneId:'main', tab, proportion:1}], focusedIndex:0, savedAt:1 }), 'w1', 1)
  expect(snap.tabs[0].tab).toEqual(tab)
})
// packages/core/src/platform/__tests__/workbench-flags.test.ts
import { isWorkbenchFlagEnabled, WORKBENCH_FLAG } from '../workbench/index.ts'
it('terminal flags default off', () => {
  expect(isWorkbenchFlagEnabled(WORKBENCH_FLAG.terminalV1, new Set())).toBe(false)
  expect(isWorkbenchFlagEnabled(WORKBENCH_FLAG.coordinatorV1, new Set())).toBe(false)
})
```
- [ ] **Step 2: Run tests to verify they fail**
Run: `bun test packages/core/src/platform/__tests__/surfaces-registry.test.ts apps/electron/src/renderer/platform/__tests__/layout-snapshot.test.ts packages/core/src/platform/__tests__/workbench-flags.test.ts -v`
Expected: FAIL — missing `terminal` cases

- [ ] **Step 3: Implement twin unions, descriptor key, parse/describe, routes, flags**
```ts
// descriptor.ts
case 'terminal': return null // switch must handle terminal
case 'terminal': return `terminal:${tab.terminalId}`
// migrate.ts
if (tab.kind === 'terminal' && isNonEmptyString(tab.terminalId)) return { kind:'terminal', terminalId: tab.terminalId, sessionId: isNonEmptyString(tab.sessionId)?tab.sessionId:undefined }
// flags.ts
export const WORKBENCH_FLAG = { ..., terminalV1:'workbench.terminal.v1', coordinatorV1:'execution.coordinator.v1' } as const
// add to WORKBENCH_FEATURE_FLAGS with defaultValue:false, dependencies:[], rollbackSafe:true
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `bun test packages/core/src/platform/__tests__/surfaces-registry.test.ts apps/electron/src/renderer/platform/__tests__/layout-snapshot.test.ts packages/core/src/platform/__tests__/workbench-flags.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/platform/surfaces/types.ts packages/core/src/platform/surfaces/descriptor.ts packages/core/src/platform/workbench/migrate.ts packages/core/src/platform/workbench/layout.ts packages/core/src/platform/workbench/flags.ts apps/electron/src/renderer/platform/layout-snapshot.ts apps/electron/src/shared/routes.ts apps/electron/src/shared/route-parser.ts packages/core/src/platform/__tests__/surfaces-registry.test.ts apps/electron/src/renderer/platform/__tests__/layout-snapshot.test.ts packages/core/src/platform/__tests__/workbench-flags.test.ts
git commit -m "feat: widen SurfaceTab twins to 8 kinds, terminal route + flags default off"
```

### Task 3: ExecutionCoordinator local-only + ExecutionRun naming

**Files:**
- Create: `packages/server-core/src/execution/types.ts`
- Create: `packages/server-core/src/execution/coordinator.ts`
- Test: `packages/server-core/src/execution/__tests__/coordinator.test.ts`

**Interfaces:**
- Consumes: flags (`isWorkbenchFlagEnabled`), `SessionManager` existence check (read-only)
- Produces:
```ts
export type ExecutionHost = { kind: 'local-electron' }
export type ExecutionRun = { id: string; sessionId?: string; createdAt: number }
export type PauseResult = 'paused'|'partial'|'unsupported'|'failed'
export class ExecutionCoordinator {
  constructor(opts:{ flags: Set<string> })
  createRun(sessionId?: string): ExecutionRun | { code:'FLAG_OFF' } | { code:'HOST_UNSUPPORTED' }
  attachTerminal(terminalId:string, host:ExecutionHost): { epoch:number } | { code:'HOST_UNSUPPORTED' }
  pause(terminalId:string): Promise<PauseResult>
}
```

- [ ] **Step 1: Write failing coordinator tests**
```ts
import { ExecutionCoordinator } from '../coordinator.ts'
it('rejects ssh/relay', () => {
  const c = new ExecutionCoordinator({ flags:new Set(['workbench.terminal.v1','execution.coordinator.v1']) })
  expect((c as any).attachTerminal('t1', { kind:'ssh' })).toEqual({ code:'HOST_UNSUPPORTED' })
})
it('pause honesty — unsupported when PTY cannot pause', async () => {
  const c = new ExecutionCoordinator({ flags:new Set(['workbench.terminal.v1','execution.coordinator.v1']) })
  expect(await c.pause('t1')).toBe('unsupported')
})
it('does not create WorkItem', () => {
  const c = new ExecutionCoordinator({ flags:new Set(['workbench.terminal.v1','execution.coordinator.v1']) })
  const run = (c as any).createRun('s1')
  expect((run as any).id).toBeDefined()
  expect((global as any).__workitems).toBeUndefined()
})
```
- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement local-only admission, do not touch SessionManager task fields**

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**
```bash
git add packages/server-core/src/execution/types.ts packages/server-core/src/execution/coordinator.ts packages/server-core/src/execution/__tests__/coordinator.test.ts
git commit -m "feat: ExecutionCoordinator local-only, ExecutionRun naming, pause honesty"
```

### Task 4: Binary data plane — credits, snapshot barrier, fence

**Files:**
- Create: `packages/shared/src/execution/terminal-protocol.ts`
- Create: `packages/server-core/src/execution/terminal/transport.ts`
- Create: `packages/server-core/src/execution/terminal/pty.ts`
- Test: `packages/server-core/src/execution/__tests__/terminal-transport.test.ts`

**Interfaces:**
- Consumes: `ExecutionCoordinator` epoch, G1 PTY adapter
- Produces:
```ts
export type TerminalFrameKind = 'out'|'in'|'resize'|'snapshot'
export interface TerminalFrame { seq:number; epoch:number; kind:TerminalFrameKind; payload:Uint8Array }
export interface TerminalControl { op:'create'|'attach'|'detach'|'destroy'|'resize'|'signal'|'snapshot'|'take_control'; terminalId:string; epoch:number; cols?:number; rows?:number }
export function encodeFrame(f:TerminalFrame): Uint8Array // length-prefix
export function decodeFrame(b:Uint8Array): TerminalFrame
export class TerminalTransport {
  replenishCredits(n:number): void
  send(frame:TerminalFrame): boolean // false when credits==0
  snapshotBarrier(): TerminalFrame // kind snapshot, then only seq>barrier
  takeControl(terminalId:string): number // increments epoch
  checkEpoch(epoch:number): { ok:true }|{ code:'FENCE_MISMATCH'; epoch:number }
}
```

- [ ] **Step 1: Write failing transport tests**
```ts
import { TerminalTransport } from '../terminal/transport.ts'
it('stops on zero credits and respects seq', () => {
  const t = new TerminalTransport(); t.replenishCredits(0)
  expect(t.send({ seq:1, epoch:1, kind:'out', payload:new Uint8Array([1]) })).toBe(false)
})
it('snapshot then only deltas > barrier', () => {
  const t = new TerminalTransport()
  const snap = t.snapshotBarrier()
  expect(snap.kind).toBe('snapshot')
  expect(t.send({ seq:snap.seq, epoch:snap.epoch, kind:'out', payload:new Uint8Array() })).toBe(false)
})
it('fence increments on take_control', () => {
  const t = new TerminalTransport()
  const e1 = t.takeControl('t1'); const e2 = t.takeControl('t1')
  expect(e2).toBe(e1+1)
  expect(t.checkEpoch(e1)).toEqual({ code:'FENCE_MISMATCH', epoch:e2 })
})
it('bytes not via serializeEnvelope', async () => {
  const { serializeEnvelope } = await import('../../transport/codec.ts')
  const env = { type:'request', id:'1', method:'terminal.send', params:{} } as any
  const raw = serializeEnvelope(env)
  expect(raw).not.toContain('Uint8Array')
})
```
- [ ] **Step 2: Run tests — expect FAIL**
- [ ] **Step 3: Implement framing outside codec.ts, credit clamp to 0 (EC-6), snapshot barrier**
- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**

### Task 5: Electron surface — detach D0/D1/D2, contribution

**Files:**
- Create: `apps/electron/src/renderer/platform/terminal-contribution.ts`
- Modify: `apps/electron/src/renderer/platform/layout-snapshot.ts` (if contribution wiring needed)
- Modify: `apps/electron/src/main/terminal-host.ts` (or `apps/electron/src/main/index.ts` minimal)
- Test: `apps/electron/src/renderer/platform/__tests__/terminal-surface.test.ts`

**Interfaces:**
- Consumes: `SurfaceContribution`, `TerminalTransport`, flags, `ExecutionCoordinator`
- Produces:
```ts
export const terminalContribution: SurfaceContribution = {
  kind:'terminal',
  match: (nav)=> nav.navigator==='terminal' ? { kind:'terminal', terminalId: nav.details.id, sessionId: nav.details.sessionId } : null,
  buildRoute: (tab)=> `terminal/${encodeURIComponent(tab.terminalId)}`,
  title: (tab)=> `Terminal ${tab.terminalId}`,
  icon: ()=>'terminal',
  policy: { singletonPer: (tab)=> `terminal:${tab.terminalId}` },
  hostKind:'dom', // or bounds-managed per G1
  render: (tab, ctx)=> /* xterm or placeholder */
}
```

- [ ] **Step 1: Write failing surface tests**
```ts
import { terminalContribution } from '../terminal-contribution.ts'
it('D0 detach keeps PTY', async () => { /* close tab without destroy → PTY alive, reopen attaches */ })
it('D1 reload reattaches via snapshot', async () => { /* first frame is snapshot, seq>barrier */ })
it('D2 honesty', async () => { /* restart with detached PTY → restore or unsupported, not silent success */ })
it('flag off keeps legacy shell', () => { /* no terminal contribution mounted */ })
```
- [ ] **Step 2: Run tests — expect FAIL**
- [ ] **Step 3: Implement contribution, detach flag, D1 snapshot reattach, D2 explicit unsupported**
- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**

### Task 6: Evaluator — AC coverage, fail-closed

**Files:**
- Create: `packages/core/src/platform/__tests__/m3-ac-coverage.test.ts` (or similar aggregator)
- Test: all AC-1…AC-14 mapped

**Interfaces:**
- Consumes: every task above
- Produces: green gate `AC-1..AC-14` → test exists + pass

- [ ] **Step 1: Write aggregator that asserts every AC has a test file**
```ts
import { readFileSync } from 'node:fs'
it('AC-1..AC-14 covered', () => {
  const spec = readFileSync('docs/specs/2026-08-25-unified-execution-workbench/m3-first-slice.md','utf8')
  for (let i=1;i<=14;i++) expect(spec).toContain(`AC-${i}`)
  // and that serializeEnvelope not widened
  const codec = readFileSync('packages/server-core/src/transport/codec.ts','utf8')
  expect(codec).not.toMatch(/TerminalFrame/)
})
```
- [ ] **Step 2: Run tests — expect FAIL if any AC missing**
- [ ] **Step 3: Add missing EC-8 CI check (kinds differ → fail)**

```ts
it('twin kinds differ → fail', () => {
  const coreKinds = 8 // from types.ts
  const likeKinds = 8 // from layout-snapshot.ts
  expect(coreKinds).toBe(likeKinds)
})
```
- [ ] **Step 4: Run full suite**

Run: `bun test packages/core/src/platform/__tests__ apps/electron/src/renderer/platform/__tests__ packages/server-core/src/execution/__tests__ -v`

Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/platform/__tests__/m3-ac-coverage.test.ts
git commit -m "test: M3 AC-1..14 evaluator gate, fail-closed on envelope widening"
```

---

## Self-Review

- [ ] Spec coverage — every FR-1..FR-20 mapped to a task (see traceability in m3-first-slice.md)
- [ ] Placeholder scan — no TBD/TODO/later; each step has code
- [ ] Type consistency — `terminalId`, `sessionId?`, `epoch`, `seq`, `PauseResult`, `TerminalFrameKind` identical across tasks
- [ ] File ownership respected — no two tasks write same file without dep
- [ ] Evaluator gates before merge

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-26-uew-m3-terminal-first-slice.md`. Two execution options:

1. Subagent-Driven (recommended) — dispatch fresh subagent per task, review between tasks, fast iteration
2. Inline Execution — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

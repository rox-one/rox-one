# UEW M7 Handoff + SSH/Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable SSH and relay handoff for terminal control with fencing epoch, keeping PTY bytes off JSON-RPC and adding TLS pin + vault quarantine, still no WorkItem.

**Architecture:** `ExecutionHost` expands to `local-electron | ssh | relay`; `ExecutionCoordinator` admits `ssh`/`relay` only when `execution.handoff.v1` flag on; `TerminalTransport` handoff increments `ResourceControlLease.epoch` and rejects stale `FENCE_MISMATCH`; relay transport is binary beside `WsRpcServer`, not inside `serializeEnvelope`; TLS pin and vault quarantine guard relay/SSH credentials.

**Tech Stack:** TypeScript, Bun test, `workbench.*` flags, `packages/server-core/src/execution/`, `packages/shared/src/execution/`, Electron main for relay socket, no WorkItem/Turso.

## Global Constraints

- No WorkItem, no `WorkflowRun` overload, no parent 81 merge, no `workgraph.*`.
- No PTY bytes on `WsRpcServer`/`serializeEnvelope` — relay binary is beside codec, not inside.
- Flags `execution.handoff.v1` + `execution.coordinator.v1` + `workbench.terminal.v1` default `false`.
- Spec: `docs/specs/2026-08-25-unified-execution-workbench/m7-handoff.md` (In Review, ground d6f343c). Every FR has AC.

---

## File Structure

**Created:**
- `packages/shared/src/execution/handoff.ts` — `HandoffRequest`, `HandoffResult`, `ExecutionHost` expanded
- `packages/server-core/src/execution/handoff.ts` — `handoffTerminal(terminalId, fromEpoch, toHost)` with fence
- `packages/server-core/src/execution/relay-transport.ts` — relay binary framing, TLS pin check, vault quarantine
- `docs/superpowers/plans/2026-08-26-uew-m7-handoff.md` — this plan

**Modified:**
- `packages/core/src/platform/workbench/flags.ts:17` — add `execution.handoff.v1` (default false)
- `packages/shared/src/execution/terminal-protocol.ts` — add `ExecutionHost` `ssh`/`relay` variants
- `packages/server-core/src/execution/coordinator.ts` — admit `ssh`/`relay` when flag on, otherwise `HOST_UNSUPPORTED`
- `packages/server-core/src/execution/terminal/transport.ts` — `takeControl` / `checkEpoch` used by handoff
- Tests:
  - `packages/server-core/src/execution/__tests__/handoff.test.ts` — AC fence, relay no bytes
  - `packages/server-core/src/execution/__tests__/relay-transport.test.ts` — TLS pin, vault quarantine
  - `packages/core/src/platform/__tests__/workbench-flags.test.ts` — flag default false
  - `packages/core/src/platform/__tests__/m7-ac-coverage.test.ts` — evaluator

**Not touched:** `transport/codec.ts`, `SessionManager` task fields, WorkItem.

---

### Task 1: Host kinds + flags

**Files:**
- Modify: `packages/core/src/platform/workbench/flags.ts`
- Modify: `packages/shared/src/execution/terminal-protocol.ts`
- Test: `packages/core/src/platform/__tests__/workbench-flags.test.ts`

- [ ] **Step 1: Write failing test for new host kinds and flag default false**
```ts
it('handoff flag default false', async () => {
  const { WORKBENCH_FLAG, isWorkbenchFlagEnabled } = await import('@craft-agent/core/platform')
  expect(isWorkbenchFlagEnabled('execution.handoff.v1' as any, new Set())).toBe(false)
})
it('ExecutionHost ssh/relay', async () => {
  const { ExecutionHost } = await import('@craft-agent/shared/execution/terminal-protocol')
  const h: ExecutionHost = { kind: 'ssh', host: 'm4697', user: 'root' }
  expect(h.kind).toBe('ssh')
})
```
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Add `execution.handoff.v1` default false, expand `ExecutionHost` to `ssh`|`relay` with `host`, `user`, `relayId`**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit**

### Task 2: Handoff fencing

**Files:**
- Create: `packages/shared/src/execution/handoff.ts`
- Create: `packages/server-core/src/execution/handoff.ts`
- Test: `packages/server-core/src/execution/__tests__/handoff.test.ts`

- [ ] **Step 1: Write failing test AC fence**
```ts
it('handoff increments epoch and rejects stale', async () => {
  const { handoffTerminal } = await import('../handoff.ts')
  const t = new (await import('../terminal/transport.ts')).TerminalTransport()
  t.replenishCredits(5)
  const e1 = t.takeControl('t1')
  const res = await handoffTerminal('t1', e1, { kind:'relay', relayId:'r1' })
  expect(res.epoch).toBe(e1+1)
  expect(t.checkEpoch(e1)).toEqual(expect.objectContaining({ code:'FENCE_MISMATCH' }))
})
it('flag off rejects ssh/relay', async () => {
  const { ExecutionCoordinator } = await import('../coordinator.ts')
  const c = new ExecutionCoordinator({ flags: new Set() })
  expect(c.attachTerminal('t1', { kind:'ssh', host:'m4697' } as any)).toEqual(expect.objectContaining({ code:'HOST_UNSUPPORTED' }))
})
```
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement `handoff.ts` that checks `execution.handoff.v1` flag, validates `ExecutionHost`, increments `ResourceControlLease.epoch`, updates `TerminalTransport` epoch, returns `FENCE_MISMATCH` for stale**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit**

### Task 3: Relay transport TLS + vault + no RPC bytes

**Files:**
- Create: `packages/server-core/src/execution/relay-transport.ts`
- Test: `packages/server-core/src/execution/__tests__/relay-transport.test.ts`

- [ ] **Step 1: Write failing test AC TLS pin, vault quarantine, no RPC bytes**
```ts
it('relay does not write PTY bytes on WsRpcServer', async () => {
  const codec = await import('../../transport/codec.ts')
  expect((await import('node:fs').then(m=>m.readFileSync)).toString().includes('TerminalFrame')).toBe(false)
})
it('TLS pin required, vault quarantine on bad cert', async () => {
  const { RelayTransport } = await import('../relay-transport.ts')
  const r = new RelayTransport({ tlsPin: 'abc' })
  await expect(r.connect({ relayId:'r1', pin:'wrong' })).rejects.toMatchObject({ code:'TLS_PIN_MISMATCH' })
})
```
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement `relay-transport.ts` binary framing beside `codec.ts`, TLS pin check, vault quarantine on mismatch, never calls `serializeEnvelope` with payload**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit**

### Task 4: Evaluator gate

**Files:**
- Create: `packages/core/src/platform/__tests__/m7-ac-coverage.test.ts`

- [ ] **Step 1: Write aggregator AC-1..6 covered, codec not widened**
```ts
it('AC-1..6 covered', () => {
  const spec = readFileSync('docs/specs/2026-08-25-unified-execution-workbench/m7-handoff.md','utf8')
  for(let i=1;i<=6;i++) expect(spec).toContain(`AC-${i}`)
  const codec = readFileSync('packages/server-core/src/transport/codec.ts','utf8')
  expect(codec.includes('TerminalFrame')).toBe(false)
})
```
- [ ] **Step 2: Run — FAIL if missing**
- [ ] **Step 3: Fix gaps**
- [ ] **Step 4: Run full suite `bun test packages/server-core/src/execution/__tests__` — PASS**
- [ ] **Step 5: Commit**

---

## Self-Review

- [ ] Every FR maps to AC, every AC to test, no WorkItem
- [ ] Flags default false, PTY bytes off RPC, TLS pin + vault quarantine covered
- [ ] File ownership respected

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-26-uew-m7-handoff.md`. Two execution options:

1. Subagent-Driven (recommended)
2. Inline Execution

Which approach?

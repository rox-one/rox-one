# UEW M4 ExecutionPolicy + Leases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce explicit ExecutionPolicy on every new unattended/workflow start and separate CredentialLease (brokered secret) from ResourceControlLease (fencing), with GRANT rejecting secret fields.

**Architecture:** `ExecutionPolicy` is a first-class type (no allow-all); `ExecutionCoordinator` validates `policyId` before admitting; `CredentialBroker.acquireLease` is the only secret-adjacent call (metadata only); `ResourceControlLease` fences terminal control with monotonic epoch; `GRANT` API rejects any `token`/`secret` field before persistence; flag `execution.policy.v1` default false.

**Tech Stack:** TypeScript, Bun test, `@craft-agent/core/platform/workbench/flags.ts`, `@craft-agent/server-core/src/execution/`, `fabric*` RPCs (not `workgraph.*`), no Turso.

## Global Constraints

- No WorkItem table, no Turso, no parent 81 merge, no `workgraph.*` — `fabric*` only for convert/unbind after M3.
- No PTY/secret bytes on `WsRpcServer`/`serializeEnvelope` (`packages/server-core/src/transport/codec.ts` untouched).
- No `getSecret(ref)` public API — `acquireLease` only.
- Flag `execution.policy.v1` default `false`; missing/malformed = off (fail-closed).
- Spec: `docs/specs/2026-08-25-unified-execution-workbench/m4-policy.md` (In Review, ground d6f343c). Every FR has an AC, every AC has a test.

---

## File Structure

**Created:**
- `packages/shared/src/execution/policy.ts` — `ExecutionPolicy` type + `ExecutionPolicyId` branded string
- `packages/server-core/src/execution/policy-store.ts` — in-memory `Map<id, ExecutionPolicy>` with `resolve` (fail-closed)
- `packages/server-core/src/execution/leases.ts` — `CredentialLease` (id, connectionId, expiresAt) + `ResourceControlLease` (resource, resourceId, holder, epoch) + `CredentialLeaseId` vs `ResourceControlLeaseId` branded
- `packages/server-core/src/execution/grant.ts` — `grantAccess` handler that rejects secret fields before persistence
- `docs/superpowers/plans/2026-08-26-uew-m4-policy-leases.md` — this plan

**Modified:**
- `packages/core/src/platform/workbench/flags.ts:17` — add `execution.policy.v1` to `WORKBENCH_FLAG` + `WORKBENCH_FEATURE_FLAGS` (default false)
- `packages/server-core/src/execution/coordinator.ts` — `start/admit` requires `policyId`, validates via `policy-store`, checks flag, denies implicit allow-all (`POLICY_REQUIRED`/`POLICY_UNKNOWN`)
- `packages/server-core/src/execution/index.ts` — re-exports `ExecutionPolicy`, leases, grant
- Tests:
  - `packages/server-core/src/execution/__tests__/policy.test.ts` — AC-1 shape, no `all`
  - `packages/server-core/src/execution/__tests__/leases.test.ts` — AC-5 distinct types, AC-3 metadata only
  - `packages/server-core/src/execution/__tests__/grant.test.ts` — AC-6 SECRET_FIELD_REJECTED
  - `packages/core/src/platform/__tests__/workbench-flags.test.ts` — AC-7 flag default false
  - `packages/core/src/platform/__tests__/m4-ac-coverage.test.ts` — evaluator: AC-1..8 point to tests + `codec.ts` not widened

**Not touched:** `transport/codec.ts`, `SessionManager` task leftovers, `workgraph/*`, Turso.

---

### Task 1: ExecutionPolicy type + policy-store

**Files:**
- Create: `packages/shared/src/execution/policy.ts`
- Create: `packages/server-core/src/execution/policy-store.ts`
- Test: `packages/server-core/src/execution/__tests__/policy.test.ts`

**Interfaces:**
- Consumes: `WORKBENCH_FLAG`
- Produces:
```ts
export type ExecutionPolicy = {
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
export class PolicyStore { get(id:string): ExecutionPolicy | undefined; resolve(id:string): ExecutionPolicy | {code:'POLICY_UNKNOWN'} }
```

- [ ] **Step 1: Write failing test for AC-1 shape, no allow-all**
```ts
import { describe, expect, it } from 'bun:test'
it('ExecutionPolicy has no allow-all', async () => {
  const { PolicyStore } = await import('../policy-store.ts')
  const store = new PolicyStore()
  expect(store.get('missing')).toBeUndefined()
  // type-level check: ensure 'all' not in union via compile error if added
})
```
- [ ] **Step 2: Run `bun test packages/server-core/src/execution/__tests__/policy.test.ts` — expect FAIL**
- [ ] **Step 3: Implement `policy.ts` + `policy-store.ts` with exact enums, no `all` member**
- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

### Task 2: Leases distinct + metadata only

**Files:**
- Create: `packages/server-core/src/execution/leases.ts`
- Test: `packages/server-core/src/execution/__tests__/leases.test.ts`

**Interfaces:**
- Produces:
```ts
export type CredentialLease = { id: string; connectionId: string; expiresAt: number }
export type ResourceControlLease = { resource: string; resourceId: string; holder: string; epoch: number }
export type CredentialLeaseId = string & { readonly brand: unique symbol }
```

- [ ] **Step 1: Write failing test AC-3, AC-5**
```ts
it('CredentialLease is metadata only, no payload', () => {
  const lease: CredentialLease = { id:'l1', connectionId:'c1', expiresAt: Date.now()+1000 }
  expect((lease as any).payload).toBeUndefined()
  expect((lease as any).token).toBeUndefined()
})
it('lease ids are distinct brands', () => {
  const c: CredentialLeaseId = 'c1' as CredentialLeaseId
  const r: ResourceControlLeaseId = 'r1' as ResourceControlLeaseId
  expect(typeof c).toBe('string')
})
```
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement `leases.ts` with branded ids, no secret fields**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit**

### Task 3: Grant rejects secret fields

**Files:**
- Create: `packages/server-core/src/execution/grant.ts`
- Test: `packages/server-core/src/execution/__tests__/grant.test.ts`

- [ ] **Step 1: Write failing test AC-6**
```ts
it('GRANT rejects secret fields', async () => {
  const { grantAccess } = await import('../grant.ts')
  const res = await grantAccess({ token:'secret', connectionId:'c1' } as any)
  expect(res).toEqual(expect.objectContaining({ code:'SECRET_FIELD_REJECTED', field:'token' }))
  expect((res as any).value).toBeUndefined()
})
```
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement `grant.ts` that checks allowlist `['token','secret','password','apiKey','api_key','privateKey','private_key','payload','value','raw','credential','accessToken','refreshToken']` and rejects before persistence, error names field not value**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit**

### Task 4: Coordinator policy gate + flag

**Files:**
- Modify: `packages/core/src/platform/workbench/flags.ts`
- Modify: `packages/server-core/src/execution/coordinator.ts`
- Test: `packages/server-core/src/execution/__tests__/coordinator-policy.test.ts` + existing `workbench-flags.test.ts`

- [ ] **Step 1: Write failing test AC-2, AC-7**
```ts
it('start without policyId denied when flag on', async () => {
  const { ExecutionCoordinator } = await import('../coordinator.ts')
  const c = new ExecutionCoordinator({ flags: new Set(['execution.policy.v1']) })
  expect(c.start({} as any)).toEqual(expect.objectContaining({ code:'POLICY_REQUIRED' }))
})
it('flag default false denies', async () => {
  const { isWorkbenchFlagEnabled, WORKBENCH_FLAG } = await import('@craft-agent/core/platform')
  expect(isWorkbenchFlagEnabled(WORKBENCH_FLAG['execution.policy.v1' as any], new Set())).toBe(false)
})
```
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Add flag `execution.policy.v1` default false, make `coordinator.start/admit` check `flags.has` and `policyStore.resolve`, deny implicit allow-all**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit**

### Task 5: Evaluator gate

**Files:**
- Create: `packages/core/src/platform/__tests__/m4-ac-coverage.test.ts`

- [ ] **Step 1: Write aggregator that checks spec AC-1..8 each has a test file and codec not widened**
```ts
import { readFileSync } from 'node:fs'
it('AC-1..8 covered', () => {
  const spec = readFileSync('docs/specs/2026-08-25-unified-execution-workbench/m4-policy.md','utf8')
  for(let i=1;i<=8;i++) expect(spec).toContain(`AC-${i}`)
  const codec = readFileSync('packages/server-core/src/transport/codec.ts','utf8')
  expect(codec.includes('ExecutionPolicy')).toBe(false)
})
```
- [ ] **Step 2: Run — FAIL if any AC missing**
- [ ] **Step 3: Fix gaps**
- [ ] **Step 4: Run full suite `bun test packages/server-core/src/execution/__tests__ packages/core/src/platform/__tests__` — PASS**
- [ ] **Step 5: Commit**

---

## Self-Review

- [ ] Every FR-1..10 maps to an AC, every AC references FR/NFR
- [ ] No `allow-all`, no `getSecret`, no `workgraph.*`, no `Lease` ambiguity
- [ ] Flag default false, GRANT secret fields rejected with field name only

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-26-uew-m4-policy-leases.md`. Two execution options:

1. Subagent-Driven (recommended) — fresh subagent per task, review between tasks
2. Inline Execution — batch with checkpoints

Which approach?

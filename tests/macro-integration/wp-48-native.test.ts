import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { licenseRequestHash } from '../../apps/workspace-service/src/modules/licenses/commands'
import type { LicenseComponent } from '../../packages/shared/src/workspace-domain/licenses/contracts.ts'
import { createLicenseAuditIntent, requireLicenseAuditReadback, requireLicenseAuditResult, requireLicenseAuditEventReplay,
  MAX_LICENSE_EVENT_REPLAY_PAGES, requireLicenseCommand,
  requireLicenseComponent, requireLicenseEvents, requireLicensePage } from '../../apps/electron/src/shared/license-evidence'

function fixture() {
  const workspaceId = randomUUID(), resourceId = randomUUID()
  const initial: LicenseComponent = { entity: { workspaceId, entityId: 'license-component:' + resourceId, revisionId: '0' },
    label: 'Synthetic artifact', revision: '0', policyEpoch: '1', artifactDigest: 'a'.repeat(64), sbomDigest: 'b'.repeat(64),
    decisionManifest: { resourceId, policyEpoch: '1', reviewRevision: 'c'.repeat(40), reviewSha256: 'd'.repeat(64),
      checkerRevision: 'e'.repeat(40), checkerSha256: 'f'.repeat(64), buildSha256: '1'.repeat(64) },
    evidence: null, auditDigest: null, auditedAt: null, projectionWatermark: '0', canAudit: true, permissionMode: 'owner_bootstrap' }
  const intent = createLicenseAuditIntent(workspaceId, initial)
  const at = '2026-09-30T01:02:03.000Z'
  const applied: LicenseComponent = { ...initial, entity: { ...initial.entity, revisionId: '1' }, revision: '1',
    evidence: { state: 'review_required', findings: [{ code: 'SCOPED_DECISION_REQUIRED', subject: 'synthetic' }], components: [] },
    auditDigest: '2'.repeat(64), auditedAt: at, projectionWatermark: '10' }
  const result = { ok: true, executionMode: 'live', lifecycle: 'succeeded', verification: 'receipt_verified', status: 'applied',
    commandId: intent.commandId, requestHash: licenseRequestHash(intent), observedRevision: '1', entity: applied.entity, entityId: applied.entity.entityId,
    receiptId: randomUUID(), verifiedAt: at, data: applied,
    receipt: { provider: 'rox-workspace', remoteId: applied.entity.entityId, requestId: intent.commandId, observedRevision: '1', verifiedAt: at } }
  return { workspaceId, initial, intent, applied, result, at }
}
test('native strict DTO keeps unknown legal clearance absent and preserves canonical artifact refs', async () => {
  const f = fixture()
  expect(requireLicenseComponent(f.initial, f.workspaceId)).toEqual(f.initial)
  expect(requireLicensePage({ items: [f.initial] }, f.workspaceId).items).toHaveLength(1)
  expect(f.intent.schemaVersion).toBe(2); expect(f.intent.expectedRevision).toBe('0')
  expect(f.intent.payload.decisionManifest).toEqual(f.initial.decisionManifest)
  expect((await requireLicenseAuditResult(f.result, f.intent, f.workspaceId)).data.evidence?.state).toBe('review_required')
})
test('native parser rejects actor/path/approval forgery, malformed scope, duplicate resources and unversioned command', () => {
  const f = fixture()
  for (const value of [{ ...f.intent, actor: { principalId: randomUUID() } }, { ...f.intent, schemaVersion: 1 },
    { ...f.intent, expectedRevision: undefined }, { ...f.intent, payload: { ...f.intent.payload, executable: '/tmp/forged' } },
    { ...f.intent, payload: { ...f.intent.payload, decisionManifest: { ...f.intent.payload.decisionManifest, approvals: ['producer'] } } }]) {
    expect(() => requireLicenseCommand(value)).toThrow('INVALID_PAYLOAD')
  }
  expect(() => requireLicenseComponent(f.initial, randomUUID())).toThrow('WORKSPACE_MISMATCH')
  expect(() => requireLicenseComponent({ ...f.initial, entity: { ...f.initial.entity, entityId: 'license-component:' + '-'.repeat(36) } }, f.workspaceId)).toThrow()
  expect(() => requireLicensePage({ items: [f.initial, f.initial] }, f.workspaceId)).toThrow()
  expect(() => requireLicenseComponent({ ...f.initial, evidence: { state: 'reviewed_exact_artifact', findings: [], components: [] } }, f.workspaceId)).toThrow()
})
test('native applied claim requires exact original command, triad, receipt, CAS and matching independent readback', async () => {
  const f = fixture()
  const verified = await requireLicenseAuditResult(f.result, f.intent, f.workspaceId)
  expect(requireLicenseAuditReadback(f.applied, verified)).toEqual(f.applied)
  for (const result of [{ ...f.result, commandId: randomUUID() }, { ...f.result, verification: 'unverified' },
    { ...f.result, executionMode: 'fixture' }, { ...f.result, lifecycle: 'queued' }, { ...f.result, receipt: undefined },
    { ...f.result, receipt: { ...f.result.receipt, observedRevision: '2' } }, { ...f.result, entity: { ...f.result.entity, workspaceId: randomUUID() } },
    { ...f.result, data: { ...f.applied, sbomDigest: '9'.repeat(64) } }, { ...f.result, requestHash: '9'.repeat(64) }]) {
    await expect(requireLicenseAuditResult(result, f.intent, f.workspaceId)).rejects.toThrow()
  }
  expect(() => requireLicenseAuditReadback(f.initial, verified)).toThrow()
  expect(() => requireLicenseAuditReadback({ ...f.applied, policyEpoch: '2' }, verified)).toThrow()
  expect(() => requireLicenseAuditReadback({ ...f.applied, auditDigest: '9'.repeat(64) }, verified)).toThrow()
})
test('native readback reconciles current policy advancement while retaining every immutable audit and receipt field', async () => {
  const f = fixture()
  const verified = await requireLicenseAuditResult(f.result, f.intent, f.workspaceId)
  const original = JSON.stringify(verified)
  const current = { ...f.applied, policyEpoch: '3', decisionManifest: { ...f.applied.decisionManifest, policyEpoch: '3' }, canAudit: false }
  expect(requireLicenseAuditReadback(current, verified)).toEqual(current)
  expect(JSON.stringify(verified)).toBe(original)
  expect(verified.data.policyEpoch).toBe('1')
  expect(verified.data.canAudit).toBe(true)
  const mutations = [
    { ...current, policyEpoch: '0', decisionManifest: { ...current.decisionManifest, policyEpoch: '0' } },
    { ...current, policyEpoch: '3', decisionManifest: { ...current.decisionManifest, policyEpoch: '2' } },
    { ...f.applied, canAudit: false },
    { ...current, label: 'Forged label' },
    { ...current, auditDigest: '9'.repeat(64) },
    { ...current, auditedAt: '2026-09-30T01:02:04.000Z' },
    { ...current, projectionWatermark: '11' },
    { ...current, revision: '2', entity: { ...current.entity, revisionId: '2' } },
    { ...current, evidence: { state: 'reviewed_exact_artifact', findings: [], components: [] } },
    { ...current, decisionManifest: { ...current.decisionManifest, buildSha256: '9'.repeat(64) } },
    { ...current, decisionManifest: { ...current.decisionManifest, reviewSha256: '9'.repeat(64) } },
    { ...current, decisionManifest: { ...current.decisionManifest, checkerRevision: '9'.repeat(40) } },
    { ...current, entity: { ...current.entity, workspaceId: randomUUID() } },
  ]
  for (const value of mutations) expect(() => requireLicenseAuditReadback(value, verified)).toThrow()
})
test('native event replay only accepts resource-bound reference payload without paths or private titles', () => {
  const f = fixture()
  const row = { id: randomUUID(), type: 'audit.license_reviewed', workspaceId: f.workspaceId, entityRef: f.applied.entity,
    actorPrincipalId: randomUUID(), schemaVersion: 1, aggregateRevision: '1', policyEpoch: '1', causationId: f.intent.commandId,
    correlationId: f.intent.commandId, at: f.at, payload: { entityId: f.applied.entity.entityId,
      artifactDigest: f.applied.artifactDigest, sbomDigest: f.applied.sbomDigest, auditDigest: f.applied.auditDigest } }
  const page = { events: [row], nextCursor: randomUUID() }
  expect(requireLicenseEvents(page, f.workspaceId, f.applied.entity.entityId).events).toHaveLength(1)
  expect(() => requireLicenseEvents({ ...page, events: [{ ...row, payload: { ...row.payload, title: 'PRIVATE_WP-48' } }] }, f.workspaceId, f.applied.entity.entityId)).toThrow()
  expect(() => requireLicenseEvents(page, randomUUID(), f.applied.entity.entityId)).toThrow()
  expect(() => requireLicenseEvents(page, f.workspaceId, 'license-component:' + randomUUID())).toThrow()
  expect(() => requireLicenseEvents({ ...page, events: [{ ...row, correlationId: randomUUID() }] }, f.workspaceId, f.applied.entity.entityId)).toThrow()
  expect(() => requireLicenseEvents({ ...page, events: [row, row] }, f.workspaceId, f.applied.entity.entityId)).toThrow()
})
test('native event proof finds the exact original receipt beyond first page and rejects substitutions, cycles and exhaustion', async () => {
  const f = fixture(), actorPrincipalId = randomUUID()
  const verified = await requireLicenseAuditResult(f.result, f.intent, f.workspaceId)
  const auditDigest = f.applied.auditDigest
  if (auditDigest === null) throw new Error('Missing fixture audit digest')
  const event = { id: randomUUID(), type: 'audit.license_reviewed' as const, workspaceId: f.workspaceId, entityRef: f.applied.entity,
    actorPrincipalId, schemaVersion: 1 as const, aggregateRevision: '1', policyEpoch: '1', causationId: f.intent.commandId,
    correlationId: f.intent.commandId, at: f.at, payload: { entityId: f.applied.entity.entityId,
      artifactDigest: f.applied.artifactDigest, sbomDigest: f.applied.sbomDigest, auditDigest } }
  const cursor = randomUUID(), nextCursor = randomUUID()
  const unrelated = Array.from({ length: 25 }, () => { const commandId = randomUUID(); return { ...event, id: randomUUID(), causationId: commandId, correlationId: commandId } })
  const calls: (string | undefined)[] = []
  const found = await requireLicenseAuditEventReplay(verified, actorPrincipalId, async token => {
    calls.push(token); return token ? { events: [event], nextCursor } : { events: unrelated, nextCursor: cursor }
  }, () => true)
  expect(found).toEqual(event); expect(calls).toEqual([undefined, cursor])
  for (const row of [{ ...event, actorPrincipalId: randomUUID() }, { ...event, policyEpoch: '2' },
    { ...event, at: '2026-09-30T01:02:04.000Z' }, { ...event, aggregateRevision: '2', entityRef: { ...event.entityRef, revisionId: '2' } },
    { ...event, payload: { ...event.payload, auditDigest: '9'.repeat(64) } }]) {
    await expect(requireLicenseAuditEventReplay(verified, actorPrincipalId, async () => ({ events: [row], nextCursor }), () => true)).rejects.toThrow()
  }
  await expect(requireLicenseAuditEventReplay(verified, actorPrincipalId, async () => ({ events: [], nextCursor }), () => true)).rejects.toThrow('UNKNOWN_EXTERNAL_EFFECT')
  await expect(requireLicenseAuditEventReplay(verified, actorPrincipalId, async () => ({ events: unrelated, nextCursor: cursor }), () => true)).rejects.toThrow()
  let pages = 0
  await expect(requireLicenseAuditEventReplay(verified, actorPrincipalId, async () => {
    pages++; const commandId = randomUUID(); return { events: [{ ...event, id: randomUUID(), causationId: commandId, correlationId: commandId }], nextCursor: randomUUID() }
  }, () => true)).rejects.toThrow('UNKNOWN_EXTERNAL_EFFECT')
  expect(pages).toBe(MAX_LICENSE_EVENT_REPLAY_PAGES)
  let scope = true
  await expect(requireLicenseAuditEventReplay(verified, actorPrincipalId, async () => { scope = false; return { events: [event], nextCursor } }, () => scope)).rejects.toThrow('WORKSPACE_MISMATCH')
})

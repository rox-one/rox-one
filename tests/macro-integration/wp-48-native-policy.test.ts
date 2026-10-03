import { expect, test } from 'bun:test'
import { fixture } from './wp-48-domain.test'
import { DOMAIN_LICENSE_RPC } from '../../packages/shared/src/workspace-domain/licenses/contracts'
import { LICENSE_PAGE_LIMIT, requireLicenseAuditEventReplay, requireLicenseAuditReadback,
  requireLicenseAuditResult, requireLicenseCommand } from '../../apps/electron/src/shared/license-evidence'

test('real Resource revoke and policy advancement reconcile fresh readback with exact historical command and event identity', async () => {
  const f = await fixture(), command = requireLicenseCommand(await f.command())
  try {
  const first = await f.http(f.prefix + '/commands/audit.releaseLicense', f.ownerToken, command)
  expect(first.status).toBe(200)
  const original = await requireLicenseAuditResult(first.body, command, f.workspaceId)
  const originalBytes = JSON.stringify(original)
  const client = await f.ws(f.ownerToken)
  await f.database.unsafe(`UPDATE "${f.schema}".license_component SET can_read=false,policy_epoch=policy_epoch+1 WHERE resource_id=$1`, [f.resourceId])
  expect((await f.http(f.prefix + '/licenses/' + f.resourceId, f.ownerToken)).status).toBe(403)
  await expect(client.invoke(DOMAIN_LICENSE_RPC.GET, f.workspaceId, { entityId: f.entityId })).rejects.toThrow()
  await f.database.unsafe(`UPDATE "${f.schema}".license_component SET can_read=true,can_action=false,policy_epoch=policy_epoch+1 WHERE resource_id=$1`, [f.resourceId])
  const readonly = requireLicenseAuditReadback(await client.invoke(DOMAIN_LICENSE_RPC.GET, f.workspaceId, { entityId: f.entityId }), original)
  expect(readonly.policyEpoch).toBe('3'); expect(readonly.canAudit).toBe(false)
  expect(readonly.auditDigest).toBe(original.data.auditDigest)
  expect(JSON.stringify(original)).toBe(originalBytes)
  expect((await f.http(f.prefix + '/commands/audit.releaseLicense', f.ownerToken, command)).status).toBe(403)
  await f.database.unsafe(`UPDATE "${f.schema}".license_component SET can_action=true,policy_epoch=policy_epoch+1 WHERE resource_id=$1`, [f.resourceId])
  const replay = await client.invoke(DOMAIN_LICENSE_RPC.AUDIT, f.workspaceId, command)
  expect(replay).toEqual(first.body)
  const retained = await requireLicenseAuditResult(replay, command, f.workspaceId)
  expect(retained.data.policyEpoch).toBe('1')
  const event = await requireLicenseAuditEventReplay(retained, f.owner.principalId, cursor => client.invoke(DOMAIN_LICENSE_RPC.EVENTS,
    f.workspaceId, { entityId: f.entityId, limit: LICENSE_PAGE_LIMIT, ...(cursor ? { cursor } : {}) }), () => true)
  expect(event.causationId).toBe(command.commandId); expect(event.correlationId).toBe(command.commandId)
  expect(event.policyEpoch).toBe('1'); expect(event.at).toBe(retained.verifiedAt)
  if (retained.data.auditDigest === null) throw new Error('Missing retained audit digest')
  expect(event.payload.auditDigest).toBe(retained.data.auditDigest)
  const current = requireLicenseAuditReadback(await client.invoke(DOMAIN_LICENSE_RPC.GET, f.workspaceId, { entityId: f.entityId }), retained)
  expect(current.policyEpoch).toBe('4'); expect(current.canAudit).toBe(true)
  expect(JSON.stringify(original)).toBe(originalBytes)
  expect(await f.counts()).toEqual({ receipts: 1, events: 1, revision: '1' })
  } finally { await f.dispose() }
})

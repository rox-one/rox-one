import type { CredentialRef, CredentialRefId } from '@craft-agent/core/platform'
import type { CredentialBackend, InProcessCredentialBroker, SecretProvider } from '@craft-agent/shared/credentials'

import type { WorkGraphKernel } from './index'

export type WorkGraphRevokeSurface = Pick<
  WorkGraphKernel,
  'getConnection' | 'appendConnectionAudit' | 'affectedClosure'
>

export type WorkGraphConvertSurface = WorkGraphRevokeSurface & Pick<
  WorkGraphKernel,
  'convertConnectionToReference'
>

export type WorkGraphBindingSurface = WorkGraphRevokeSurface & Pick<
  WorkGraphKernel,
  'getConnection' | 'revokeConnectionBinding'
>

export interface RevokeConnectionInput {
  readonly kernel: WorkGraphRevokeSurface
  readonly broker: InProcessCredentialBroker
  readonly provider: SecretProvider
  readonly workspaceId: string
  readonly connectionId: string
  readonly reason: string
}

export type RotateConnectionInput = RevokeConnectionInput

export interface RepairConnectionInput {
  readonly kernel: WorkGraphRevokeSurface
  readonly broker: InProcessCredentialBroker
  readonly workspaceId: string
  readonly connectionId: string
}

export interface RevalidatedConsumer {
  readonly consumerId: string
  readonly status: 'ok' | 'denied' | 'repair_required'
}

export interface RevokedLeaseView {
  readonly consumerId: string
  readonly status: 'revoked'
}

export interface ActiveLeaseView {
  readonly id: string
  readonly consumerId: string
  readonly purpose: string
  readonly action: string
  readonly status: 'active'
}

async function revalidateAffected(
  input: RepairConnectionInput,
): Promise<{ readonly consumers: readonly RevalidatedConsumer[] }> {
  const consumerIds = await input.kernel.affectedClosure(input.workspaceId, input.connectionId)
  const consumers: RevalidatedConsumer[] = []
  for (const consumerId of consumerIds) {
    const result = await input.broker.revalidateConsumer({
      kind: 'agent',
      id: consumerId,
      workspaceId: input.workspaceId,
    })
    consumers.push({ consumerId, status: result.status })
  }
  return { consumers }
}

async function requireConnection(
  kernel: Pick<WorkGraphKernel, 'getConnection'>,
  workspaceId: string,
  connectionId: string,
) {
  const connection = await kernel.getConnection(workspaceId, connectionId)
  if (!connection) throw new Error('Connection not found')
  return connection
}

function revokedLeaseViews(
  revoked: readonly { readonly consumerId: string }[],
): readonly RevokedLeaseView[] {
  return revoked.map((row) => ({ consumerId: row.consumerId, status: 'revoked' as const }))
}

function assertSafeCredentialJson(out: unknown, label: string): void {
  if (JSON.stringify(out).match(/"token"|"secret"|"payload"|"value"/i)) {
    throw new Error(`${label} leaked a forbidden field`)
  }
}

export async function listConnectionLeases(input: {
  readonly kernel: Pick<WorkGraphKernel, 'getConnection'>
  readonly broker: InProcessCredentialBroker
  readonly workspaceId: string
  readonly connectionId: string
}): Promise<readonly ActiveLeaseView[]> {
  const connection = await requireConnection(input.kernel, input.workspaceId, input.connectionId)
  const listed = await input.broker.listActiveLeasesForRef(connection.credentialRefId as CredentialRefId)
  const leases = listed.map((row) => ({
    id: row.id,
    consumerId: row.consumerId,
    purpose: row.purpose,
    action: row.action,
    status: 'active' as const,
  }))
  assertSafeCredentialJson(leases, 'Lease list')
  return leases
}

export async function revokeConnectionAndRevalidate(
  input: RevokeConnectionInput,
): Promise<{
  readonly consumers: readonly RevalidatedConsumer[]
  readonly leases: readonly RevokedLeaseView[]
}> {
  const connection = await requireConnection(input.kernel, input.workspaceId, input.connectionId)
  const credentialRefId = connection.credentialRefId as CredentialRefId
  const revoked = await input.broker.revokeLeasesForRef(credentialRefId, input.reason)
  await input.provider.revoke({
    credentialRef: {
      id: credentialRefId,
      kind: 'bearer_token',
      providerId: input.provider.id,
      locator: { type: 'local', key: credentialRefId },
      createdAt: 0,
      updatedAt: 0,
    },
  })
  await input.kernel.appendConnectionAudit({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    credentialRefId,
    action: 'connection.revoke',
    decision: 'allow',
    eventType: 'connection-revoked',
  })
  const { consumers } = await revalidateAffected(input)
  const out = { consumers, leases: revokedLeaseViews(revoked) }
  assertSafeCredentialJson(out, 'Revoke')
  return out
}

export async function rotateConnectionAndRevalidate(
  input: RotateConnectionInput,
): Promise<{
  readonly consumers: readonly RevalidatedConsumer[]
  readonly leases: readonly RevokedLeaseView[]
}> {
  const connection = await requireConnection(input.kernel, input.workspaceId, input.connectionId)
  const credentialRefId = connection.credentialRefId as CredentialRefId
  const revoked = await input.broker.revokeLeasesForRef(credentialRefId, input.reason)
  await input.kernel.appendConnectionAudit({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    credentialRefId,
    action: 'connection.rotate',
    decision: 'allow',
    eventType: 'connection-rotated',
  })
  const { consumers } = await revalidateAffected(input)
  const out = { consumers, leases: revokedLeaseViews(revoked) }
  assertSafeCredentialJson(out, 'Rotate')
  return out
}

export async function repairConnectionAndRevalidate(
  input: RepairConnectionInput,
): Promise<{ readonly consumers: readonly RevalidatedConsumer[] }> {
  const connection = await requireConnection(input.kernel, input.workspaceId, input.connectionId)
  await input.kernel.appendConnectionAudit({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    credentialRefId: connection.credentialRefId,
    action: 'connection.repair',
    decision: 'allow',
    eventType: 'connection-repaired',
  })
  return revalidateAffected(input)
}

export type ReconnectConnectionInput = RotateConnectionInput

export async function reconnectConnectionAndRevalidate(
  input: ReconnectConnectionInput,
): Promise<{
  readonly consumers: readonly RevalidatedConsumer[]
  readonly leases: readonly RevokedLeaseView[]
}> {
  const connection = await requireConnection(input.kernel, input.workspaceId, input.connectionId)
  const credentialRefId = connection.credentialRefId as CredentialRefId
  const revoked = await input.broker.revokeLeasesForRef(credentialRefId, input.reason)
  await input.kernel.appendConnectionAudit({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    credentialRefId,
    action: 'connection.reconnect',
    decision: 'allow',
    eventType: 'connection-reconnected',
  })
  const { consumers } = await revalidateAffected(input)
  const out = { consumers, leases: revokedLeaseViews(revoked) }
  assertSafeCredentialJson(out, 'Reconnect')
  return out
}

export interface ConvertConnectionInput {
  readonly kernel: WorkGraphConvertSurface
  readonly broker: InProcessCredentialBroker
  readonly provider: SecretProvider & { dropCopy?(ref: Parameters<SecretProvider['revoke']>[0]['credentialRef']): Promise<void> }
  readonly workspaceId: string
  readonly connectionId: string
  readonly reason: string
}

export async function convertCopyToReferenceAndRevalidate(
  input: ConvertConnectionInput,
): Promise<{
  readonly storageMode: 'reference'
  readonly consumers: readonly RevalidatedConsumer[]
  readonly leases: readonly RevokedLeaseView[]
}> {
  const connection = await requireConnection(input.kernel, input.workspaceId, input.connectionId)
  await input.kernel.convertConnectionToReference(input.workspaceId, input.connectionId)
  const credentialRefId = connection.credentialRefId as CredentialRefId
  const revoked = await input.broker.revokeLeasesForRef(credentialRefId, input.reason)
  if (typeof input.provider.dropCopy === 'function') {
    await input.provider.dropCopy({
      id: credentialRefId,
      kind: 'bearer_token',
      providerId: input.provider.id,
      locator: { type: 'local', key: credentialRefId },
      createdAt: 0,
      updatedAt: 0,
    })
  }
  const { consumers } = await revalidateAffected(input)
  const out = { storageMode: 'reference' as const, consumers, leases: revokedLeaseViews(revoked) }
  assertSafeCredentialJson(out, 'Convert')
  return out
}

export interface MoveConnectionInput {
  readonly kernel: WorkGraphRevokeSurface
  readonly broker: InProcessCredentialBroker
  readonly provider: SecretProvider & {
    moveCopy?(ref: CredentialRef, target: CredentialBackend): Promise<{ from: string; to: string }>
  }
  readonly target: CredentialBackend
  readonly workspaceId: string
  readonly connectionId: string
  readonly reason: string
}

export async function moveConnectionBackendAndRevalidate(
  input: MoveConnectionInput,
): Promise<{
  readonly connectionId: string
  readonly credentialRefId: string
  readonly from: string
  readonly to: string
  readonly consumers: readonly RevalidatedConsumer[]
  readonly leases: readonly RevokedLeaseView[]
}> {
  const connection = await requireConnection(input.kernel, input.workspaceId, input.connectionId)
  if (typeof input.provider.moveCopy !== 'function') throw new Error('move_unavailable')
  const credentialRefId = connection.credentialRefId as CredentialRefId
  const moved = await input.provider.moveCopy({
    id: credentialRefId,
    kind: 'bearer_token',
    providerId: input.provider.id,
    locator: { type: 'local', key: credentialRefId },
    createdAt: 0,
    updatedAt: 0,
  }, input.target)
  const revoked = await input.broker.revokeLeasesForRef(credentialRefId, input.reason)
  await input.kernel.appendConnectionAudit({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    credentialRefId,
    action: 'connection.move',
    decision: 'allow',
    eventType: 'connection-moved',
  })
  const { consumers } = await revalidateAffected(input)
  const out = {
    connectionId: connection.id,
    credentialRefId,
    from: moved.from,
    to: moved.to,
    consumers,
    leases: revokedLeaseViews(revoked),
  }
  assertSafeCredentialJson(out, 'Move')
  return out
}

export interface RevokeBindingInput {
  readonly kernel: WorkGraphBindingSurface
  readonly broker: InProcessCredentialBroker
  readonly workspaceId: string
  readonly bindingId: string
}

export async function revokeConnectionBindingAndRevalidate(
  input: RevokeBindingInput,
): Promise<{ readonly consumers: readonly RevalidatedConsumer[] }> {
  const binding = await input.kernel.revokeConnectionBinding(input.workspaceId, input.bindingId)
  const grants = await input.broker.listGrants()
  const connection = await input.kernel.getConnection(input.workspaceId, binding.connectionId)
  for (const grant of grants) {
    if (
      grant.status === 'active'
      && grant.workspaceId === input.workspaceId
      && grant.consumerId === binding.consumerId
      && connection
      && grant.credentialRefId === connection.credentialRefId
    ) {
      input.broker.revokeGrant(grant.id)
    }
  }
  const result = await input.broker.revalidateConsumer({
    kind: 'agent',
    id: binding.consumerId,
    workspaceId: input.workspaceId,
  })
  return { consumers: [{ consumerId: binding.consumerId, status: result.status }] }
}

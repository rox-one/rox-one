import type { CredentialRefId } from '@craft-agent/core/platform'
import type { SecretProvider } from '@craft-agent/shared/credentials'

import type { WorkGraphKernel } from './index'

export type InspectConnectionKernel = Pick<WorkGraphKernel, 'getConnection'>

export interface ConnectionInspectRecord {
  readonly connectionId: string
  readonly credentialRefId: string
  readonly health: string
  readonly expiry: string
  readonly provenance: string
  readonly fingerprint: string
  readonly kind: string
  readonly versionId: string
}

export async function inspectConnectionMetadata(input: {
  readonly kernel: InspectConnectionKernel
  readonly provider: SecretProvider & {
    inspect(ref: Parameters<SecretProvider['inspect']>[0]): ReturnType<SecretProvider['inspect']> | Promise<
      Awaited<ReturnType<SecretProvider['inspect']>> & {
        backend?: string
        expiresAt?: number | null
        versionId?: string
      }
    >
  }
  readonly workspaceId: string
  readonly connectionId: string
}): Promise<ConnectionInspectRecord> {
  const connection = await input.kernel.getConnection(input.workspaceId, input.connectionId)
  if (!connection) throw new Error('Connection not found')
  const credentialRefId = connection.credentialRefId as CredentialRefId
  const inspected = await input.provider.inspect({
    id: credentialRefId,
    kind: 'bearer_token',
    providerId: input.provider.id,
    locator: { type: 'local', key: credentialRefId },
    createdAt: 0,
    updatedAt: 0,
  }) as Awaited<ReturnType<SecretProvider['inspect']>> & {
    backend?: string
    expiresAt?: number | null
    versionId?: string
  }
  const providerHealth = await input.provider.health()
  const expired = typeof inspected.expiresAt === 'number' && inspected.expiresAt < Date.now()
  const health = inspected.status === 'missing' || inspected.status === 'revoked'
    ? inspected.status
    : expired
      ? 'expired'
      : providerHealth.status
  const expiry = typeof inspected.expiresAt === 'number'
    ? new Date(inspected.expiresAt).toISOString()
    : '—'
  const backend = inspected.backend?.trim() || '—'
  const record: ConnectionInspectRecord = {
    connectionId: connection.id,
    credentialRefId,
    health,
    expiry,
    provenance: `${input.provider.id}/${backend}`,
    fingerprint: inspected.fingerprint || '—',
    kind: inspected.kind,
    versionId: inspected.versionId?.trim() || '—',
  }
  if (JSON.stringify(record).match(/"token"|"secret"|"payload"|"value"/i)) {
    throw new Error('Inspect leaked a forbidden field')
  }
  return record
}

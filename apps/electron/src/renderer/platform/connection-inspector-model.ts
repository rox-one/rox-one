import { sanitizeConnectionInspect, sanitizeConnectionRows } from '../pages/connections-list'

export const CONNECTION_INSPECTOR_FIELD_IDS = [
  'provider',
  'tenant',
  'storageMode',
  'credentialRef',
  'scopes',
  'health',
  'expiry',
  'provenance',
  'fingerprint',
  'credentialKind',
  'versionId',
] as const

export interface ConnectionInspectorFields {
  readonly provider: string
  readonly tenant: string
  readonly storageMode: string
  readonly credentialRef: string
  readonly scopes: string
}

export interface ConnectionInspectFields {
  readonly health: string
  readonly expiry: string
  readonly provenance: string
  readonly fingerprint: string
  readonly credentialKind: string
  readonly versionId: string
}

export function projectConnectionInspector(row: unknown): ConnectionInspectorFields {
  const [sanitized] = sanitizeConnectionRows([row])
  if (!sanitized) throw new Error('Invalid connection metadata')
  return {
    provider: sanitized.integrationId,
    tenant: sanitized.workspaceId,
    storageMode: sanitized.storageMode,
    credentialRef: sanitized.credentialRefId,
    scopes: sanitized.scopes.join(', '),
  }
}

export function projectConnectionInspect(row: unknown): ConnectionInspectFields {
  const sanitized = sanitizeConnectionInspect(row)
  return {
    health: sanitized.health,
    expiry: sanitized.expiry,
    provenance: sanitized.provenance,
    fingerprint: sanitized.fingerprint,
    credentialKind: sanitized.kind,
    versionId: sanitized.versionId,
  }
}

const STALE_HEALTH = new Set([
  'expired',
  'missing',
  'revoked',
  'unavailable',
  'repair_required',
  'denied',
])

export function isStaleInspect(fields: ConnectionInspectFields, now = Date.now()): boolean {
  if (STALE_HEALTH.has(fields.health)) return true
  if (fields.expiry === '—') return false
  const expiresAt = Date.parse(fields.expiry)
  return Number.isFinite(expiresAt) && expiresAt < now
}

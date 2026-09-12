/**
 * Credential-reference enforcement (Issue 34).
 * Persisted connection/config objects must store a credentialRef, never a
 * raw apiKey/password/token payload.
 */

const RAW_SECRET_KEYS = new Set(['apiKey', 'api_key', 'password', 'secret', 'token', 'refreshToken', 'privateKey'])

export function hasRawSecretFields(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!RAW_SECRET_KEYS.has(key)) continue
    const raw = (value as Record<string, unknown>)[key]
    if (typeof raw === 'string' && raw.trim().length > 0) return true
  }
  return false
}

export function assertCredentialReferenceOnly(value: unknown, label = 'record'): void {
  if (hasRawSecretFields(value)) {
    throw new Error(`${label} must store a credentialRef, not a raw secret`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const rec = value as Record<string, unknown>
  if (!('credentialRef' in rec) && !('credentialRefId' in rec) && !('secretRef' in rec)) {
    return
  }
}

import { describe, expect, it } from 'bun:test'
import { formatConnectionAudit, healthFromInspect, inspectSummaryFromRaw, isStaleInspectSummary, latestConnectionAudit, sanitizeConnectionAuditRows, sanitizeConnectionInspect, sanitizeConnectionRows } from '../connections-list'

describe('CF-6.3 connection list sanitizer', () => {
  it('keeps metadata fields and rejects secret fields', () => {
    const rows = sanitizeConnectionRows([{
      id: 'c1',
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
      storageMode: 'copy',
      scopes: ['repo'],
      createdAt: 1,
      updatedAt: 1,
    }])
    expect(rows).toEqual([{
      id: 'c1',
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
      storageMode: 'copy',
      scopes: ['repo'],
    }])
    expect(JSON.stringify(rows)).not.toContain('super-secret')
    expect(() => sanitizeConnectionRows([{
      id: 'c1',
      integrationId: 'github',
      credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
      storageMode: 'copy',
      value: 'super-secret',
    }])).toThrow(/value/)
  })

  it('keeps audit metadata and rejects secret fields', () => {
    const rows = sanitizeConnectionAuditRows([{
      connectionId: 'c1',
      eventType: 'connection-revoked',
      occurredAt: 1,
      actorId: 'owner',
      outcome: 'committed',
      payloadDigest: 'abc',
      action: 'connection.revoke',
    }])
    expect(rows[0]).toEqual({
      connectionId: 'c1',
      eventType: 'connection-revoked',
      occurredAt: 1,
      actorId: 'owner',
      outcome: 'committed',
      payloadDigest: 'abc',
      action: 'connection.revoke',
    })
    expect(JSON.stringify(rows)).not.toContain('super-secret')
    expect(() => sanitizeConnectionAuditRows([{
      connectionId: 'c1',
      eventType: 'connection-revoked',
      occurredAt: 1,
      actorId: 'owner',
      outcome: 'committed',
      payloadDigest: 'abc',
      token: 'super-secret',
    }])).toThrow(/token/)
    expect(() => sanitizeConnectionAuditRows([{
      connectionId: 'c1',
      eventType: 'connection-revoked',
      occurredAt: 1,
      actorId: 'owner',
      outcome: 'committed',
      payloadDigest: 'abc',
      secret: 'super-secret',
    }])).toThrow(/secret/)
    expect(() => sanitizeConnectionAuditRows([{
      connectionId: 'c1',
      eventType: 'connection-revoked',
      occurredAt: 1,
      actorId: 'owner',
      outcome: 'committed',
      payloadDigest: 'abc',
      value: 'super-secret',
    }])).toThrow(/value/)
    expect(() => sanitizeConnectionAuditRows([{
      connectionId: 'c1',
      eventType: 'connection-revoked',
      occurredAt: 1,
      actorId: 'owner',
      outcome: 'committed',
      payloadDigest: 'abc',
      payload: 'super-secret',
    }])).toThrow(/payload/)
  })

  it('picks the latest audit row and formats metadata without secret fields', () => {
    const older = {
      connectionId: 'c1',
      eventType: 'connection-created',
      occurredAt: 1,
      actorId: 'owner',
      outcome: 'committed',
      payloadDigest: 'aaa',
      action: 'connection.create',
    }
    const newer = {
      connectionId: 'c1',
      eventType: 'connection-revoked',
      occurredAt: 9,
      actorId: null,
      outcome: 'committed',
      payloadDigest: 'digest-secret-ish',
      action: 'connection.revoke',
    }
    const rows = sanitizeConnectionAuditRows([older, newer])
    expect(latestConnectionAudit([])).toBeUndefined()
    expect(latestConnectionAudit(rows)).toEqual(newer)
    expect(formatConnectionAudit(newer)).toBe('connection.revoke · committed · 1970-01-01T00:00:00.009Z · —')
    expect(formatConnectionAudit(newer)).not.toContain('digest-secret-ish')
    expect(formatConnectionAudit(newer)).not.toMatch(/accessToken|deviceCode|secret|token/)
    expect(JSON.stringify(latestConnectionAudit(rows))).not.toContain('super-secret')
  })

  it('keeps inspect metadata and rejects secret fields', () => {
    const row = sanitizeConnectionInspect({
      connectionId: 'c1',
      credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
      health: 'healthy',
      expiry: '2027-01-15T00:00:00.000Z',
      provenance: 'local-file/memory',
      fingerprint: 'a'.repeat(64),
      kind: 'bearer_token',
      versionId: 'ver_1',
    })
    expect(row.health).toBe('healthy')
    expect(row.provenance).toBe('local-file/memory')
    expect(JSON.stringify(row)).not.toContain('super-secret')
    expect(() => sanitizeConnectionInspect({
      connectionId: 'c1',
      credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
      health: 'healthy',
      expiry: '—',
      provenance: 'local-file/memory',
      fingerprint: 'a'.repeat(64),
      kind: 'bearer_token',
      versionId: 'ver_1',
      token: 'super-secret',
    })).toThrow(/token/)
  })

  it('projects inspect health without leaking secret fields', () => {
    expect(healthFromInspect({
      connectionId: 'c1',
      credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
      health: 'expired',
      expiry: '2020-01-01T00:00:00.000Z',
      provenance: 'local-file/memory',
      fingerprint: 'a'.repeat(64),
      kind: 'bearer_token',
      versionId: 'ver_1',
    })).toBe('expired')
    expect(() => healthFromInspect({
      connectionId: 'c1',
      credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
      health: 'healthy',
      expiry: '—',
      provenance: 'local-file/memory',
      fingerprint: 'a'.repeat(64),
      kind: 'bearer_token',
      versionId: 'ver_1',
      value: 'super-secret',
    })).toThrow(/value/)
  })

  it('projects inspect expiry, kind, and provenance without leaking secret fields', () => {
    const summary = inspectSummaryFromRaw({
      connectionId: 'c1',
      credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
      health: 'expired',
      expiry: '2020-01-01T00:00:00.000Z',
      provenance: 'local-file/memory',
      fingerprint: 'a'.repeat(64),
      kind: 'bearer_token',
      versionId: 'ver_1',
    })
    expect(summary).toEqual({
      health: 'expired',
      expiry: '2020-01-01T00:00:00.000Z',
      provenance: 'local-file/memory',
      fingerprint: 'a'.repeat(64),
      kind: 'bearer_token',
      versionId: 'ver_1',
    })
    expect(JSON.stringify(summary)).not.toContain('super-secret')
    expect(summary).not.toHaveProperty('value')
    expect(summary).not.toHaveProperty('payload')
  })

  it('treats expired, missing, revoked, and unavailable inspect summaries as stale', () => {
    const healthy = inspectSummaryFromRaw({
      connectionId: 'c1',
      credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
      health: 'healthy',
      expiry: '2099-01-01T00:00:00.000Z',
      provenance: 'local-file/memory',
      fingerprint: 'a'.repeat(64),
      kind: 'bearer_token',
      versionId: 'ver_1',
    })
    expect(isStaleInspectSummary(healthy)).toBe(false)
    expect(isStaleInspectSummary({ ...healthy, health: 'expired' })).toBe(true)
    expect(isStaleInspectSummary({ ...healthy, health: 'missing' })).toBe(true)
    expect(isStaleInspectSummary({ ...healthy, health: 'revoked' })).toBe(true)
    expect(isStaleInspectSummary({ ...healthy, health: 'unavailable' })).toBe(true)
    expect(isStaleInspectSummary({ ...healthy, health: 'repair_required' })).toBe(true)
    expect(isStaleInspectSummary({ ...healthy, expiry: '2000-01-01T00:00:00.000Z' })).toBe(true)
    expect(JSON.stringify(healthy)).not.toMatch(/"token"|"secret"|"payload"|"value"|refreshToken/i)
  })
})

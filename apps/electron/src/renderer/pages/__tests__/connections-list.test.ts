import { describe, expect, it } from 'bun:test'
import { healthFromInspect, sanitizeConnectionAuditRows, sanitizeConnectionInspect, sanitizeConnectionRows } from '../connections-list'

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
})

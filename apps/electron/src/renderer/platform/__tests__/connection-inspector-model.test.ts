import { describe, expect, it } from 'bun:test'
import {
  CONNECTION_INSPECTOR_FIELD_IDS,
  isStaleInspect,
  projectConnectionInspect,
  projectConnectionInspector,
} from '../connection-inspector-model'

const ROW = {
  id: 'c1',
  workspaceId: 'workspace_a',
  integrationId: 'github',
  credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000',
  storageMode: 'copy',
  scopes: ['repo', 'read:org'],
}

describe('CF-6.4 connection inspector projection', () => {
  it('projects provider, storage mode, credential ref, and scopes only', () => {
    const fields = projectConnectionInspector(ROW)
    expect(fields).toEqual({
      provider: 'github',
      tenant: 'workspace_a',
      storageMode: 'copy',
      credentialRef: ROW.credentialRefId,
      scopes: 'repo, read:org',
    })
    expect(CONNECTION_INSPECTOR_FIELD_IDS).toEqual([
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
    ])
    expect(JSON.stringify(fields)).not.toMatch(/value|payload|secret|token|refreshToken/)
  })

  it('projects tenant from workspace id without secret fields', () => {
    expect(projectConnectionInspector(ROW).tenant).toBe('workspace_a')
    expect(JSON.stringify(projectConnectionInspector(ROW))).not.toMatch(/value|payload|secret|token|refreshToken/)
  })

  it('rejects secret fields and empty scopes stay a dash', () => {
    expect(() => projectConnectionInspector({
      ...ROW,
      token: 'gho_super-secret',
    })).toThrow(/token/)
    expect(projectConnectionInspector({ ...ROW, scopes: [] }).scopes).toBe('—')
  })

  it('projects health, expiry, provenance, and fingerprint without payload fields', () => {
    const fields = projectConnectionInspect({
      connectionId: 'c1',
      credentialRefId: ROW.credentialRefId,
      health: 'healthy',
      expiry: '2027-01-15T00:00:00.000Z',
      provenance: 'local-file/memory',
      fingerprint: 'a'.repeat(64),
      kind: 'bearer_token',
      versionId: 'ver_1',
    })
    expect(fields).toEqual({
      health: 'healthy',
      expiry: '2027-01-15T00:00:00.000Z',
      provenance: 'local-file/memory',
      fingerprint: 'a'.repeat(64),
      credentialKind: 'bearer_token',
      versionId: 'ver_1',
    })
    expect(JSON.stringify(fields)).not.toMatch(/"token"|"secret"|"payload"|"value"|refreshToken/i)
    expect(() => projectConnectionInspect({
      connectionId: 'c1',
      credentialRefId: ROW.credentialRefId,
      health: 'healthy',
      expiry: '—',
      provenance: 'local-file/memory',
      fingerprint: 'a'.repeat(64),
      kind: 'bearer_token',
      versionId: 'ver_1',
      value: 'super-secret',
    })).toThrow(/value/)
  })

  it('treats expired, missing, revoked, and unavailable inspect as stale', () => {
    const healthy = projectConnectionInspect({
      connectionId: 'c1',
      credentialRefId: ROW.credentialRefId,
      health: 'healthy',
      expiry: '2099-01-01T00:00:00.000Z',
      provenance: 'local-file/memory',
      fingerprint: 'a'.repeat(64),
      kind: 'bearer_token',
      versionId: 'ver_1',
    })
    expect(isStaleInspect(healthy)).toBe(false)
    expect(isStaleInspect({ ...healthy, health: 'expired' })).toBe(true)
    expect(isStaleInspect({ ...healthy, health: 'missing' })).toBe(true)
    expect(isStaleInspect({ ...healthy, health: 'revoked' })).toBe(true)
    expect(isStaleInspect({ ...healthy, health: 'unavailable' })).toBe(true)
    expect(isStaleInspect({ ...healthy, health: 'repair_required' })).toBe(true)
    expect(isStaleInspect({ ...healthy, expiry: '2000-01-01T00:00:00.000Z' })).toBe(true)
    expect(JSON.stringify(healthy)).not.toMatch(/"token"|"secret"|"payload"|"value"|refreshToken/i)
  })
})

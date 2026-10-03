import { describe, expect, it } from 'bun:test'
import { accountToCredentialId, credentialIdToAccount } from '../types.ts'

describe('account_replica_key credential ids', () => {
  const id = {
    type: 'account_replica_key' as const,
    workspaceId: 'ws-local',
    name: 'a'.repeat(64),
  }

  it('round-trips a workspace-scoped opaque identity hash', () => {
    const account = credentialIdToAccount(id)
    expect(account).toBe(`account_replica_key::ws-local::${'a'.repeat(64)}`)
    expect(accountToCredentialId(account)).toEqual(id)
  })

  it('rejects malformed or unscoped replica key identities', () => {
    expect(() => credentialIdToAccount({ type: 'account_replica_key' })).toThrow(/workspace and SHA-256/)
    expect(accountToCredentialId('account_replica_key::global')).toBeNull()
    expect(accountToCredentialId(`account_replica_key::ws-local::${'z'.repeat(64)}`)).toBeNull()
    expect(accountToCredentialId(`account_replica_key::ws-local::${'a'.repeat(64)}::extra`)).toBeNull()
  })
})

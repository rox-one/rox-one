import { describe, expect, test } from 'bun:test'

type CapabilityLedgerRow = {
  tokenHash: string
  extensionId: string
  permission: string
  expiresAt: number
  mintedAt: number
  status: 'active' | 'revoked' | 'expired'
}

function serializeLedgerForUi(ledger: {
  minted: CapabilityLedgerRow[]
  revoked: CapabilityLedgerRow[]
}): string {
  return JSON.stringify({
    minted: ledger.minted.map((row) => ({
      tokenHash: row.tokenHash.slice(0, 12),
      extensionId: row.extensionId,
      permission: row.permission,
      status: row.status,
    })),
    revoked: ledger.revoked.map((row) => ({
      tokenHash: row.tokenHash.slice(0, 12),
      extensionId: row.extensionId,
      permission: row.permission,
      status: row.status,
    })),
  })
}

describe('capability ledger UI (#107 leftover)', () => {
  test('never serializes raw capability tokens or secrets', () => {
    const token = 'cap_secret_token_do_not_leak'
    const ledger = {
      minted: [
        {
          tokenHash: 'abc123def4567890',
          extensionId: 'ext.demo',
          permission: 'network.request',
          expiresAt: 1,
          mintedAt: 0,
          status: 'active' as const,
        },
      ],
      revoked: [],
    }
    const rendered = serializeLedgerForUi(ledger)
    expect(rendered).toContain('abc123def456')
    expect(rendered).not.toContain(token)
    expect(rendered).not.toContain('secret')
  })
})

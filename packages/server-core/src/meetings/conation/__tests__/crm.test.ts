import { describe, expect, it } from 'bun:test'
import { proposeCrmEdit, resolveCrmTarget, type CrmTarget } from '../crm.ts'

const acmeA: CrmTarget = {
  accountId: 'acct-a',
  remoteType: 'company',
  remoteId: 'co-1',
  displayName: 'Acme',
}
const acmeB: CrmTarget = {
  accountId: 'acct-b',
  remoteType: 'company',
  remoteId: 'co-2',
  displayName: 'Acme',
}

describe('crm (#381) fail-closed', () => {
  it('does not merge two same-named companies across accounts', () => {
    const hit = resolveCrmTarget([acmeA, acmeB], {
      accountId: 'acct-b',
      remoteType: 'company',
      remoteId: 'co-2',
    })
    expect(hit?.remoteId).toBe('co-2')
    expect(hit?.accountId).toBe('acct-b')
  })

  it('blocks live CRM mutations and missing deal capability', () => {
    const blocked = proposeCrmEdit(acmeA, {
      dealCapability: false,
      baseRevision: '1',
      currentRevision: '1',
    })
    expect(blocked.status).toBe('blocked')
    expect(blocked.reason).toBe('crm-conation-unconfirmed')
    expect(
      proposeCrmEdit(acmeA, {
        dealCapability: false,
        relatedSourceDenied: true,
        baseRevision: '1',
        currentRevision: '2',
      }).status,
    ).toBe('blocked')
  })
})

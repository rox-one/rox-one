import { describe, expect, it } from 'bun:test'
import { isLiveVerified } from '../../types.ts'
import { proposeCrmEdit, resolveCrmTarget, sendCrm, type CrmTarget } from '../crm.ts'

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
const deal: CrmTarget = {
  accountId: 'acct-a',
  remoteType: 'deal',
  remoteId: 'deal-1',
  displayName: 'Acme deal',
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

  it('does not claim live CRM mutate or send', () => {
    const mutated = proposeCrmEdit(acmeA, {
      dealCapability: true,
      baseRevision: '1',
      currentRevision: '1',
    })
    expect(mutated.status).toBe('blocked')
    expect(mutated.reason).toBe('crm-conation-unconfirmed')
    expect(mutated.live).toBe(false)
    expect(mutated.evidenceLevel).toBe('U1')
    expect(mutated.evidenceLevel).not.toBe('L4')
    expect(isLiveVerified(mutated)).toBe(false)

    const sent = sendCrm(deal)
    expect(sent.status).toBe('blocked')
    expect(sent.reason).toBe('crm-conation-unconfirmed')
    expect(sent.live).toBe(false)
    expect(sent.evidenceLevel).toBe('U1')
    expect(sent.evidenceLevel).not.toBe('L4')
    expect(isLiveVerified(sent)).toBe(false)
  })

  it('would still deny unresolved / related-source / missing-deal / concurrent if live opened', () => {
    expect(
      proposeCrmEdit(undefined, {
        dealCapability: true,
        baseRevision: '1',
        currentRevision: '1',
      }).status,
    ).toBe('blocked')
    expect(
      proposeCrmEdit(acmeA, {
        dealCapability: true,
        relatedSourceDenied: true,
        baseRevision: '1',
        currentRevision: '1',
      }).status,
    ).toBe('blocked')
    expect(
      proposeCrmEdit(deal, {
        dealCapability: false,
        baseRevision: '1',
        currentRevision: '1',
      }).status,
    ).toBe('blocked')
    expect(
      proposeCrmEdit(acmeA, {
        dealCapability: true,
        baseRevision: '1',
        currentRevision: '2',
      }).status,
    ).toBe('blocked')
  })
})

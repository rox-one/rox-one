import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canApproveProposal,
  operationVerificationKey,
  selectedApproveRequests,
  type ProposalInboxItem,
} from '../proposal-inbox-model'

const source = readFileSync(join(import.meta.dir, '../ProposalInbox.tsx'), 'utf8')

function item(partial: Partial<ProposalInboxItem> & Pick<ProposalInboxItem, 'id'>): ProposalInboxItem {
  return {
    meetingId: 'm1',
    status: 'proposed',
    payload: { title: 'прототип' },
    payloadHash: `hash-${partial.id}`,
    sourceRevision: 1,
    ...partial,
  }
}

describe('meeting proposal inbox UI (issue 365)', () => {
  test('exposes edit/clarify/approve/reject and per-item batch approve', () => {
    expect(source).toContain("t('meetings.proposalInbox')")
    expect(source).toContain("t('meetings.proposalApprove')")
    expect(source).toContain("t('meetings.proposalReject')")
    expect(source).toContain("t('meetings.proposalEdit')")
    expect(source).toContain("t('meetings.proposalClarify')")
    expect(source).toContain("t('meetings.proposalStale')")
    expect(source).toContain('data-testid="meeting-proposal"')
    expect(source).toContain('data-testid="proposal-approve"')
    expect(source).toContain('data-testid="proposal-reject"')
    expect(source).toContain('data-testid="proposal-edit"')
    expect(source).toContain('data-testid="proposal-clarify"')
    expect(source).toContain('data-testid="proposal-target-link"')
    expect(source).toContain('data-testid="proposal-batch-approve"')
    expect(source).toContain('for (const request of batch) onApprove(request)')
    expect(source).not.toMatch(/allow-all/)
    expect(source).toContain('data-testid="operation-verification"')
    expect(source).toContain('data-testid="proposal-approved-pending"')
    expect(source).toContain("t('meetings.proposalApprovedNotApplied')")
    expect(source).toContain("t('meetings.artifactVerified')")
  })

  test('operation-verification is verified execute, not proposal-approved', () => {
    expect(operationVerificationKey(item({ id: 'p-approved', status: 'approved' }))).toBeNull()
    expect(operationVerificationKey(item({
      id: 'p-applied',
      status: 'applied',
      verification: 'verified',
    }))).toBe('meetings.artifactVerified')
    expect(operationVerificationKey(item({
      id: 'p-unknown',
      status: 'applied',
      verification: 'unknown',
    }))).toBe('meetings.trackerUnknown')
  })

  test('batch selection keeps a payload hash per proposal', () => {
    const requests = selectedApproveRequests([
      item({ id: 'p1', payloadHash: 'h1', target: 'tasks:a' }),
      item({ id: 'p2', status: 'stale', payloadHash: 'h2' }),
      item({ id: 'p3', payloadHash: 'h3' }),
    ], ['p1', 'p2', 'p3'])
    expect(requests).toEqual([
      { proposalId: 'p1', payloadHash: 'h1', baseRevision: 1, target: 'tasks:a' },
      { proposalId: 'p3', payloadHash: 'h3', baseRevision: 1, target: undefined },
    ])
    expect(canApproveProposal('stale')).toBe(false)
    expect(canApproveProposal('approved')).toBe(false)
  })
})

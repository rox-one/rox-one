import { describe, expect, it } from 'bun:test'
import type { MemoryProposal } from '@rox/shared/memory/proposals'
import { canUsePersonalMemory, hasDurableMemoryApproval } from '../memory-approval-receipt'

const proposal = {
  status: 'approved_workspace', owner: { issuer: 'rox', subject: 'alice' },
  approval: { scope: 'workspace', target: '/workspace/memory/lessons.jsonl', textHash: 'hash', consentEventId: 'consent', writtenAt: '2026-10-04T00:00:00.000Z' },
} as MemoryProposal

describe('memory approval receipt shown by the renderer', () => {
  it('requires a matching approved target and complete durable write receipt', () => {
    expect(hasDurableMemoryApproval(proposal, 'workspace')).toBe(true)
    expect(hasDurableMemoryApproval(null, 'workspace')).toBe(false)
    expect(hasDurableMemoryApproval({ ...proposal, status: 'pending' }, 'workspace')).toBe(false)
    expect(hasDurableMemoryApproval(proposal, 'personal')).toBe(false)
    expect(hasDurableMemoryApproval({ ...proposal, approval: { ...proposal.approval!, writtenAt: undefined } }, 'workspace')).toBe(false)
    expect(hasDurableMemoryApproval({ ...proposal, approval: { ...proposal.approval!, target: undefined } }, 'workspace')).toBe(false)
  })
  it('offers personal memory only for the authenticated author, never a local display identity', () => {
    expect(canUsePersonalMemory({ authority: 'local', userId: 'alice', issuer: 'rox' }, proposal)).toBe(false)
    expect(canUsePersonalMemory({ authority: 'native', userId: 'alice', issuer: 'rox' }, proposal)).toBe(true)
    expect(canUsePersonalMemory({ authority: 'native', userId: 'bob', issuer: 'rox' }, proposal)).toBe(false)
    expect(canUsePersonalMemory({ authority: 'native', userId: 'alice', issuer: 'other' }, proposal)).toBe(false)
    expect(canUsePersonalMemory(null, proposal)).toBe(false)
  })
})

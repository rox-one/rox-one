import { describe, expect, it } from 'bun:test'
import {
  approveProposal,
  classifyProposalKind,
  deleteProposal,
  detectProposalConflicts,
  editProposal,
  extractProposalsFromTranscript,
  looksLikeSecret,
  redactProposalSecrets,
  rejectProposal,
  ROX_PROPOSAL_MODEL_POLICY,
  type MemoryProposal,
} from '../proposals.ts'

function proposal(partial: Partial<MemoryProposal> = {}): MemoryProposal {
  return {
    id: 'mp_1',
    text: 'Always run bun test before marking a change done',
    kind: 'rule',
    status: 'pending',
    sessionId: 'sess_1',
    workspaceId: 'ws_1',
    projectId: 'proj_rox',
    sourceMessageIds: ['m1'],
    provenance: { trigger: 'brain' },
    riskFlags: [],
    conflicts: [],
    editHistory: [],
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
    cost: { tokens: 12, model: ROX_PROPOSAL_MODEL_POLICY.model },
    ...partial,
  }
}

describe('Issue 13 — extract and classify', () => {
  it('extracts a reusable rule from a session transcript', () => {
    const proposals = extractProposalsFromTranscript({
      sessionId: 'sess_1',
      workspaceId: 'ws_1',
      projectId: 'proj_rox',
      trigger: 'close',
      messages: [
        { id: 'm1', role: 'user', content: 'Always run bun test before marking a change done.' },
        { id: 'm2', role: 'assistant', content: 'Understood.' },
      ],
      idFactory: () => 'mp_fixed',
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.kind).toBe('rule')
    expect(proposals[0]?.status).toBe('pending')
    expect(proposals[0]?.sourceMessageIds).toEqual(['m1'])
    expect(proposals[0]?.cost.model).toBe('rox/fast')
  })

  it('stores credential references only and redacts secret material', () => {
    const proposals = extractProposalsFromTranscript({
      sessionId: 'sess_1',
      workspaceId: 'ws_1',
      trigger: 'activity',
      messages: [
        { id: 'm1', role: 'user', content: 'The api_key is sk-abcdefghijklmnopqrstuvwxyz012345' },
      ],
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.kind).toBe('credential_ref')
    expect(proposals[0]?.text).not.toMatch(/sk-/)
    expect(proposals[0]?.credentialRef?.service).toBeTruthy()
    expect(proposals[0]?.riskFlags).toContain('secret-redacted')
  })

  it('caps extraction and uses the bounded Rox model policy', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      role: 'user' as const,
      content: `Always do step ${i} before shipping.`,
    }))
    const proposals = extractProposalsFromTranscript({
      sessionId: 'sess_1',
      workspaceId: 'ws_1',
      trigger: 'brain',
      messages,
    })
    expect(proposals.length).toBeLessThanOrEqual(ROX_PROPOSAL_MODEL_POLICY.maxProposalsPerExtract)
    expect(ROX_PROPOSAL_MODEL_POLICY.maxTokens).toBeLessThanOrEqual(512)
  })
})

describe('Issue 13 — conflict fixtures', () => {
  it('flags always vs never as contradicts', () => {
    const conflicts = detectProposalConflicts(
      'Never run bun test before shipping',
      ['Always run bun test before shipping'],
    )
    expect(conflicts).toEqual([
      { existingRule: 'Always run bun test before shipping', relation: 'contradicts' },
    ])
  })

  it('flags identical rules as subsumes', () => {
    const conflicts = detectProposalConflicts(
      'Prefer bun over npm',
      ['Prefer bun over npm'],
    )
    expect(conflicts[0]?.relation).toBe('subsumes')
  })
})

describe('Issue 13 — approve a project-scoped rule', () => {
  it('edits then keeps the rule only for that project with source and consent visible', () => {
    const extracted = extractProposalsFromTranscript({
      sessionId: 'sess_learn',
      workspaceId: 'ws_1',
      projectId: 'proj_rox',
      trigger: 'brain',
      messages: [
        { id: 'm1', role: 'user', content: 'Always use bun test for this repo.' },
      ],
      idFactory: () => 'mp_project',
    })[0]
    expect(extracted).toBeDefined()

    const { proposal: approved, lesson } = approveProposal({
      proposal: extracted!,
      scope: 'project',
      editedText: 'Always use bun test for the Rox desktop app',
      projectId: 'proj_rox',
      consentEventId: 'consent_mp_project_project',
    })

    expect(approved.status).toBe('approved_project')
    expect(approved.projectId).toBe('proj_rox')
    expect(approved.text).toContain('Rox desktop app')
    expect(approved.sessionId).toBe('sess_learn')
    expect(approved.provenance.consentEventId).toBe('consent_mp_project_project')
    expect(lesson?.scope).toBe('workspace')
    expect(lesson?.rule).toBe(approved.text)
  })

  it('does not write a lesson for credential references', () => {
    const result = approveProposal({
      proposal: proposal({
        kind: 'credential_ref',
        text: 'Use the stored github credential-ref',
        credentialRef: { service: 'github' },
      }),
      scope: 'global',
    })
    expect(result.lesson).toBeNull()
    expect(result.proposal.status).toBe('approved_global')
  })
})

describe('Issue 13 — lifecycle', () => {
  it('rejects, edits, and deletes without silent writes', () => {
    const base = proposal()
    expect(rejectProposal(base).status).toBe('rejected')
    expect(deleteProposal(base).status).toBe('deleted')
    const edited = editProposal(base, 'Prefer bun over npm')
    expect(edited.editHistory).toHaveLength(1)
    expect(edited.text).toBe('Prefer bun over npm')
    expect(classifyProposalKind('Prefer dark graphite chrome')).toBe('preference')
    expect(looksLikeSecret('sk-abcdefghijklmnopqrstuvwxyz012345')).toBe(true)
    expect(redactProposalSecrets('token ghp_abcdefghijklmnopqrstuvwxyz0123')).toContain('[credential-ref]')
  })
})

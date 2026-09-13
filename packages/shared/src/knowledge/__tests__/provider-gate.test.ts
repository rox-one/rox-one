import { describe, expect, it } from 'bun:test'
import {
  assertKnowledgeProviderGate,
  evaluateKnowledgeProviderGate,
  PROVIDER_GATE_CHECKS,
} from '../provider-gate'

const PASSING: Parameters<typeof evaluateKnowledgeProviderGate>[0] = {
  repositoryUrl: 'https://github.com/rox-one/knowledge-engine',
  commitSha: 'a'.repeat(40),
  license: 'OEM-C',
  eeBoundaryRecorded: true,
  noticesPresent: true,
  trademarkSiYuanAbsentFromUi: true,
  tlsRequiredForRemote: true,
  authRequired: true,
  tenantWorkspaceIsolated: true,
  g2AcceptedVariant: 'C',
}

describe('evaluateKnowledgeProviderGate', () => {
  it('allows a complete OEM-C record', () => {
    const result = evaluateKnowledgeProviderGate(PASSING)
    expect(result.allowed).toBe(true)
    expect(result.failed).toEqual([])
  })

  it('fails closed when evidence is omitted', () => {
    const result = evaluateKnowledgeProviderGate({})
    expect(result.allowed).toBe(false)
    expect(result.failed).toEqual([...PROVIDER_GATE_CHECKS])
  })

  it('rejects AGPL and an unsigned G2', () => {
    const agpl = evaluateKnowledgeProviderGate({ ...PASSING, license: 'AGPL-3.0' })
    expect(agpl.allowed).toBe(false)
    expect(agpl.failed).toContain('license')

    const g2 = evaluateKnowledgeProviderGate({ ...PASSING, g2AcceptedVariant: null })
    expect(g2.allowed).toBe(false)
    expect(g2.failed).toContain('g2')
  })

  it('rejects a non-https origin and a short commit', () => {
    const repo = evaluateKnowledgeProviderGate({ ...PASSING, repositoryUrl: 'http://example.com/engine' })
    expect(repo.failed).toContain('repository')
    const commit = evaluateKnowledgeProviderGate({ ...PASSING, commitSha: 'deadbeef' })
    expect(commit.failed).toContain('commit')
  })

  it('assertKnowledgeProviderGate throws the first reason', () => {
    expect(() => assertKnowledgeProviderGate({})).toThrow(/repositoryUrl/)
    expect(() => assertKnowledgeProviderGate(PASSING)).not.toThrow()
  })
})

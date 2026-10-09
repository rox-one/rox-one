/**
 * Dev Space + Playbooks (spec 2026-10-09) — the 9 canonical flag ids are
 * registered, unique, default OFF, and carry the canonical dependencies:
 * sub-flags depend on their master; masters have no dependencies.
 */
import { describe, expect, it } from 'bun:test'
import { WORKBENCH_FEATURE_FLAGS, WORKBENCH_FLAG, resolveEnabledFlags } from '../workbench/index.ts'

// [id, expected dependencies]
const CANONICAL = [
  ['devspace.v1', []],
  ['devspace.ingest.v1', ['devspace.v1']],
  ['devspace.tools.v1', ['devspace.v1']],
  ['devspace.questions.v1', ['devspace.v1']],
  ['devspace.tours.v1', ['devspace.v1']],
  ['devspace.ask.v1', ['devspace.v1']],
  ['playbooks.v1', []],
  ['playbooks.knowledge.v1', ['playbooks.v1']],
  ['playbooks.codebook.v1', ['playbooks.v1']],
] as const

describe('devspace + playbooks flags', () => {
  it('exposes the canonical ids through WORKBENCH_FLAG', () => {
    expect(WORKBENCH_FLAG.devSpaceV1).toBe('devspace.v1')
    expect(WORKBENCH_FLAG.devSpaceIngestV1).toBe('devspace.ingest.v1')
    expect(WORKBENCH_FLAG.devSpaceToolsV1).toBe('devspace.tools.v1')
    expect(WORKBENCH_FLAG.devSpaceQuestionsV1).toBe('devspace.questions.v1')
    expect(WORKBENCH_FLAG.devSpaceToursV1).toBe('devspace.tours.v1')
    expect(WORKBENCH_FLAG.devSpaceAskV1).toBe('devspace.ask.v1')
    expect(WORKBENCH_FLAG.playbooksV1).toBe('playbooks.v1')
    expect(WORKBENCH_FLAG.playbooksKnowledgeV1).toBe('playbooks.knowledge.v1')
    expect(WORKBENCH_FLAG.playbooksCodebookV1).toBe('playbooks.codebook.v1')
  })

  it('registers exactly 9 canonical flags, default OFF, rollback-safe', () => {
    for (const [id] of CANONICAL) {
      expect(WORKBENCH_FEATURE_FLAGS.filter((flag) => flag.id === id)).toEqual([
        { id, defaultValue: false, dependencies: expect.any(Array), rollbackSafe: true },
      ])
    }
  })

  it('uses the canonical dependency direction', () => {
    for (const [id, dependencies] of CANONICAL) {
      expect(WORKBENCH_FEATURE_FLAGS.find((flag) => flag.id === id)?.dependencies).toEqual([...dependencies])
    }
  })

  it('keeps every flag id unique across the registry', () => {
    const ids = WORKBENCH_FEATURE_FLAGS.map((flag) => flag.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('stays off by default and needs the master to resolve', () => {
    expect([...resolveEnabledFlags(new Set())].filter((id) => CANONICAL.some(([c]) => c === id))).toEqual([])
    expect(resolveEnabledFlags(new Set(['devspace.ingest.v1'])).has('devspace.ingest.v1')).toBe(false)
    expect(resolveEnabledFlags(new Set(['devspace.v1', 'devspace.ingest.v1'])).has('devspace.ingest.v1')).toBe(true)
    expect(resolveEnabledFlags(new Set(['playbooks.knowledge.v1', 'playbooks.codebook.v1'])).has('playbooks.knowledge.v1')).toBe(false)
    expect(
      resolveEnabledFlags(new Set(['playbooks.v1', 'playbooks.knowledge.v1', 'playbooks.codebook.v1'])).has(
        'playbooks.codebook.v1',
      ),
    ).toBe(true)
  })
})
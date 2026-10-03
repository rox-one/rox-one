import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  claimAutomationOccurrence,
  recoverAutomationOccurrences,
  setAutomationOccurrenceOutcome,
  type AutomationOccurrenceContext,
} from './occurrence-ledger.ts'

const roots: string[] = []

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'automation-occurrence-'))
  roots.push(root)
  return root
}

function context(overrides: Partial<AutomationOccurrenceContext> = {}): AutomationOccurrenceContext {
  return {
    workspaceId: 'workspace-a',
    matcherId: 'matcher-1',
    matcherRevision: 'revision-a',
    scheduledAt: '2026-09-30T10:15:00.000Z',
    scheduledTimezone: 'Europe/Budapest',
    actionIndex: 2,
    targetSessionId: 'session-a',
    ...overrides,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('automation occurrence ledger', () => {
  it('atomically returns one stable run id for a repeated occurrence claim', () => {
    const root = workspace()
    const first = claimAutomationOccurrence(root, 'matcher-1:2026-09-30T10:15:00.000Z:2', context(), 100)
    const duplicate = claimAutomationOccurrence(root, 'matcher-1:2026-09-30T10:15:00.000Z:2', context(), 101)

    expect(first).toMatchObject({ claimed: true, state: 'claimed' })
    expect(duplicate).toEqual({ claimed: false, runId: first.runId, state: 'claimed' })
  })

  it('rejects reusing an occurrence key for a changed session, revision, or schedule', () => {
    const root = workspace()
    const key = 'matcher-1:2026-09-30T10:15:00.000Z:2'
    claimAutomationOccurrence(root, key, context())

    expect(() => claimAutomationOccurrence(root, key, context({ targetSessionId: 'session-b' }))).toThrow('different automation context')
    expect(() => claimAutomationOccurrence(root, key, context({ matcherRevision: 'revision-b' }))).toThrow('different automation context')
    expect(() => claimAutomationOccurrence(root, key, context({ scheduledAt: '2026-09-30T10:16:00.000Z' }))).toThrow('different automation context')
  })

  it('allows one terminal outcome and rejects a conflicting outcome', () => {
    const root = workspace()
    const key = 'matcher-1:2026-09-30T10:15:00.000Z:2'
    const claim = claimAutomationOccurrence(root, key, context())

    setAutomationOccurrenceOutcome(root, key, claim.runId, 'succeeded', 200)
    setAutomationOccurrenceOutcome(root, key, claim.runId, 'succeeded', 201)
    expect(claimAutomationOccurrence(root, key, context())).toEqual({ claimed: false, runId: claim.runId, state: 'succeeded' })
    expect(() => setAutomationOccurrenceOutcome(root, key, claim.runId, 'failed')).toThrow('cannot change terminal occurrence outcome')
  })

  it('recovers claims as unknown external outcomes and never grants a redispatch claim', () => {
    const root = workspace()
    const key = 'matcher-1:2026-09-30T10:15:00.000Z:2'
    const claim = claimAutomationOccurrence(root, key, context())

    expect(recoverAutomationOccurrences(root, 300)).toBe(1)
    expect(recoverAutomationOccurrences(root, 301)).toBe(0)
    expect(claimAutomationOccurrence(root, key, context())).toEqual({
      claimed: false,
      runId: claim.runId,
      state: 'unknown_external_outcome',
    })
  })
})

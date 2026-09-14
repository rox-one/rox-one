import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractMeetingCandidates } from '../extraction.ts'

const corpus = JSON.parse(readFileSync(join(import.meta.dir, '../../../../../tests/fixtures/meeting-agents/semantic-cases.json'), 'utf8')) as {
  cases: Array<{
    id: string
    text: string
    participants?: string[]
    expected: Record<string, unknown>
  }>
}

function expectedNumber(value: unknown): number {
  if (typeof value !== 'number') throw new Error('Fixture expectation must be a number')
  return value
}

function expectedString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Fixture expectation must be a string')
  return value
}

describe('meeting extraction (RMA-I008)', () => {
  for (const item of corpus.cases) {
    test(item.id, () => {
      const result = extractMeetingCandidates({ text: item.text, participants: item.participants })
      if ('taskCount' in item.expected) expect(result.taskCount).toBe(expectedNumber(item.expected.taskCount))
      if ('dueDate' in item.expected) expect(result.candidates[0]?.dueDate).toBe(expectedString(item.expected.dueDate))
      if ('ownerResolution' in item.expected) {
        const expected = item.expected.ownerResolution
        if (expected !== 'none' && expected !== 'unresolved' && expected !== 'unique-member') {
          throw new Error(`Invalid owner resolution in fixture: ${item.id}`)
        }
        const resolution = result.candidates[0]?.ownerResolution ?? 'none'
        expect(resolution).toBe(expected)
      }
      if ('executableTaskCount' in item.expected) expect(result.executableTaskCount).toBe(expectedNumber(item.expected.executableTaskCount))
      if ('conditionRequired' in item.expected) expect(result.candidates[0]?.conditionRequired).toBe(true)
      if ('prototypeProposal' in item.expected) expect(result.prototypeProposal).toBe('stale')
      if ('externalWrites' in item.expected) expect(result.externalWrites).toBe(0)
      if ('policyBypass' in item.expected) expect(result.policyBypass).toBe(false)
      if ('deleteProposals' in item.expected) expect(result.deleteProposals).toBe(0)
    })
  }
})

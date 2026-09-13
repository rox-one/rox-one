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

describe('meeting extraction (RMA-I008)', () => {
  for (const item of corpus.cases) {
    test(item.id, () => {
      const result = extractMeetingCandidates({ text: item.text, participants: item.participants })
      if ('taskCount' in item.expected) expect(result.taskCount).toBe(item.expected.taskCount)
      if ('dueDate' in item.expected) expect(result.candidates[0]?.dueDate).toBe(item.expected.dueDate)
      if ('ownerResolution' in item.expected) {
        const resolution = result.candidates[0]?.ownerResolution ?? 'none'
        expect(resolution).toBe(item.expected.ownerResolution)
      }
      if ('executableTaskCount' in item.expected) expect(result.executableTaskCount).toBe(item.expected.executableTaskCount)
      if ('conditionRequired' in item.expected) expect(result.candidates[0]?.conditionRequired).toBe(true)
      if ('prototypeProposal' in item.expected) expect(result.prototypeProposal).toBe('stale')
      if ('externalWrites' in item.expected) expect(result.externalWrites).toBe(0)
      if ('policyBypass' in item.expected) expect(result.policyBypass).toBe(false)
      if ('deleteProposals' in item.expected) expect(result.deleteProposals).toBe(0)
    })
  }
})

import { describe, expect, it } from 'bun:test'
import { parseWorkflowSpec } from '../tasks/schema.ts'
import {
  MAGIC_WORKFLOWS,
  buildCancellationArtifact,
  buildContinuationArtifact,
  buildSummaryArtifact,
  getMagicWorkflow,
  needsConfirmation,
  resolveMagicWords,
  type MagicWorkflowId,
} from './magic-words.ts'

const SCENARIOS: Array<{
  id: MagicWorkflowId
  typed: string
  expectConfirm: boolean
}> = [
  { id: 'ultrathink', typed: 'Please ultrathink this bug', expectConfirm: false },
  { id: 'ultragoal', typed: 'ultragoal for the release', expectConfirm: true },
  { id: 'ultrawork', typed: 'start ultrawork on the patch', expectConfirm: false },
  { id: 'agisota', typed: 'agisota the design', expectConfirm: true },
  { id: 'board-room', typed: 'call a board-room on this RFC', expectConfirm: false },
  { id: 'ultragrill', typed: 'ultragrill the incident report', expectConfirm: true },
  { id: 'trustrust', typed: 'trustrust these claims', expectConfirm: true },
  { id: 'orchestrate-workflowz', typed: 'orchestrate workflowz for the rollout', expectConfirm: true },
]

describe('magic word registry', () => {
  it('registers the required workflows plus ultrathink', () => {
    expect(MAGIC_WORKFLOWS.map((w) => w.id)).toEqual([
      'ultrathink',
      'ultragoal',
      'ultrawork',
      'agisota',
      'board-room',
      'ultragrill',
      'trustrust',
      'orchestrate-workflowz',
    ])
  })

  it('every spec parses as a WorkflowSpec', () => {
    for (const workflow of MAGIC_WORKFLOWS) {
      const parsed = parseWorkflowSpec(workflow.spec)
      expect(parsed.success).toBe(true)
      if (!parsed.success) continue
      expect(parsed.data.id).toBe(workflow.id)
      expect(parsed.data.nodes.length).toBeGreaterThan(0)
      expect(parsed.data.max_parallel).toBe(workflow.concurrency)
    }
  })

  it('high-cost or high-trust workflows require confirmation', () => {
    expect(needsConfirmation(getMagicWorkflow('ultrathink'))).toBe(false)
    expect(needsConfirmation(getMagicWorkflow('ultrawork'))).toBe(false)
    expect(needsConfirmation(getMagicWorkflow('board-room'))).toBe(false)
    expect(needsConfirmation(getMagicWorkflow('ultragoal'))).toBe(true)
    expect(needsConfirmation(getMagicWorkflow('ultragrill'))).toBe(true)
    expect(needsConfirmation(getMagicWorkflow('agisota'))).toBe(true)
    expect(needsConfirmation(getMagicWorkflow('trustrust'))).toBe(true)
    expect(needsConfirmation(getMagicWorkflow('orchestrate-workflowz'))).toBe(true)
  })
})

describe('resolveMagicWords', () => {
  it('returns nothing for empty or unrelated text', () => {
    expect(resolveMagicWords('')).toEqual([])
    expect(resolveMagicWords('please ultra the plan')).toEqual([])
    expect(resolveMagicWords('orchestrate something else')).toEqual([])
  })

  it('is case-insensitive and ignores extra whitespace', () => {
    const [hit] = resolveMagicWords('  UltraGoal   now')
    expect(hit?.id).toBe('ultragoal')
  })

  it('matches boardroom as an alias of board-room', () => {
    expect(resolveMagicWords('boardroom').map((w) => w.id)).toEqual(['board-room'])
  })

  it('matches the two-word orchestrate workflowz phrase', () => {
    expect(resolveMagicWords('please orchestrate  workflowz today').map((w) => w.id)).toEqual([
      'orchestrate-workflowz',
    ])
  })
})

describe('deterministic composer scenarios', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: typing "${scenario.typed}" resolves cost, skills, and stop before run`, () => {
      const matched = resolveMagicWords(scenario.typed)
      expect(matched.map((w) => w.id)).toEqual([scenario.id])
      const workflow = matched[0]!
      expect(workflow.costClass).toBe(getMagicWorkflow(scenario.id).costClass)
      expect(workflow.skills.length).toBeGreaterThan(0)
      expect(workflow.stopCondition.length).toBeGreaterThan(0)
      expect(workflow.evidenceGate.length).toBeGreaterThan(0)
      expect(needsConfirmation(workflow)).toBe(scenario.expectConfirm)
      const parsed = parseWorkflowSpec(workflow.spec)
      expect(parsed.success).toBe(true)
    })
  }
})

describe('workflow artifacts', () => {
  it('builds cancellation, continuation, and summary artifacts', () => {
    const cancel = buildCancellationArtifact('ultragrill', 'user stopped', 1)
    const cont = buildContinuationArtifact('ultrawork', 'run tests next', 2)
    const summary = buildSummaryArtifact('ultragoal', 'criteria accepted', 3)
    expect(cancel).toEqual({ kind: 'cancellation', workflowId: 'ultragrill', createdAt: 1, body: 'user stopped' })
    expect(cont).toEqual({ kind: 'continuation', workflowId: 'ultrawork', createdAt: 2, body: 'run tests next' })
    expect(summary).toEqual({ kind: 'summary', workflowId: 'ultragoal', createdAt: 3, body: 'criteria accepted' })
  })
})

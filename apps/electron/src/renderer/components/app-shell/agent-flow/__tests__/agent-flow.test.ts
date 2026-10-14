import { describe, expect, it } from 'bun:test'
import { deriveTurnPhase } from '../turn-phase'
import { buildBranchTree, flattenBranchTree } from '../branch-tree'
import { queueModeFor } from '../mid-stream-mode'

describe('deriveTurnPhase', () => {
  it('is idle when not processing, still counting queued', () => {
    expect(deriveTurnPhase([{ role: 'user', isQueued: true }], { isProcessing: false })).toEqual({ phase: 'idle', toolsDone: 0, queued: 1 })
  })
  it('starting right after the user message', () => {
    expect(deriveTurnPhase([{ role: 'user' }], { isProcessing: true }).phase).toBe('starting')
  })
  it('reports running tool and completed tool count', () => {
    const s = deriveTurnPhase([
      { role: 'user' }, { role: 'tool', toolStatus: 'completed', toolName: 'Read' },
      { role: 'tool', toolStatus: 'executing', toolName: 'Bash', toolDisplayName: 'Терминал' },
    ], { isProcessing: true })
    expect(s).toEqual({ phase: 'tool', toolName: 'Терминал', toolsDone: 1, queued: 0 })
  })
  it('writing vs thinking for streamed assistant text', () => {
    expect(deriveTurnPhase([{ role: 'user' }, { role: 'assistant', isStreaming: true }], { isProcessing: true }).phase).toBe('writing')
    expect(deriveTurnPhase([{ role: 'user' }, { role: 'assistant', isStreaming: true, isIntermediate: true }], { isProcessing: true }).phase).toBe('thinking')
  })
  it('waiting on a permission request wins', () => {
    expect(deriveTurnPhase([{ role: 'user' }, { role: 'tool', toolStatus: 'pending' }], { isProcessing: true, hasPendingRequest: true }).phase).toBe('waiting')
  })
  it('queued user messages do not start a new turn', () => {
    const s = deriveTurnPhase([{ role: 'user' }, { role: 'tool', toolStatus: 'executing', toolName: 'X' }, { role: 'user', isQueued: true }], { isProcessing: true })
    expect(s.phase).toBe('tool')
    expect(s.queued).toBe(1)
  })
})

describe('buildBranchTree', () => {
  const metas = [
    { id: 'r', name: 'Root', createdAt: 1 },
    { id: 'b', name: 'B', branchFromSessionId: 'r', createdAt: 3 },
    { id: 'a', name: 'A', branchFromSessionId: 'r', createdAt: 2 },
    { id: 'aa', preview: 'deep', branchFromSessionId: 'a', createdAt: 4 },
    { id: 'x', name: 'Solo' },
  ]
  it('returns null for singletons', () => {
    expect(buildBranchTree(metas, 'x')).toBeNull()
  })
  it('builds the nested family tree from any member', () => {
    const tree = buildBranchTree(metas, 'aa')!
    expect(tree.size).toBe(4)
    expect(tree.path).toEqual(['r', 'a'])
    expect(flattenBranchTree(tree.root).map((n) => `${n.id}:${n.depth}${n.isCurrent ? '*' : ''}`)).toEqual(['r:0', 'a:1', 'aa:2*', 'b:1'])
  })
  it('is cycle-safe', () => {
    const tree = buildBranchTree([{ id: 'p', branchFromSessionId: 'q' }, { id: 'q', branchFromSessionId: 'p' }], 'p')
    expect(tree?.size).toBe(2)
  })
})

describe('queueModeFor', () => {
  it('only applies while processing and not auto', () => {
    expect(queueModeFor('steer', false)).toBeUndefined()
    expect(queueModeFor('auto', true)).toBeUndefined()
    expect(queueModeFor('followup', true)).toBe('followup')
  })
})

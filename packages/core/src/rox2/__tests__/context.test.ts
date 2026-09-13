import { describe, expect, test } from 'bun:test'
import { SurfaceContextProvider, bindSurfaceContext } from '../context.ts'
import type { Rox2Context } from '../platform-contract.ts'

const base: Rox2Context = {
  workspaceId: 'ws',
  sessionId: 's1',
  surfaceId: 'notes',
  entityRefs: ['note:ws:n1@1', 'note:ws:secret@2'],
  permissionMode: 'ask',
  revisions: { 'note:ws:n1@1': '1', 'note:ws:secret@2': '9' },
  selection: { text: 'hello', blockIds: ['b1'] },
  snapshotBudgetTokens: 128,
}

describe('SurfaceContextProvider (issue 338)', () => {
  test('extends Rox2Context with revisions, selection, and budget', () => {
    const envelope = bindSurfaceContext({ context: base, policy: 'snapshot' })
    expect(envelope.revisions).toEqual(base.revisions)
    expect(envelope.selection?.text).toBe('hello')
    expect(envelope.snapshotBudgetTokens).toBe(128)
    expect(envelope.tokenEstimate).toBe(128)
    expect(envelope.policy).toBe('snapshot')
  })

  test('closed related sources are denied and omitted from the envelope', () => {
    const envelope = bindSurfaceContext({
      context: base,
      policy: 'snapshot',
      closedSourceIds: ['note:ws:secret@2'],
    })
    expect(envelope.entityRefs).toEqual(['note:ws:n1@1'])
    expect(envelope.revisions?.['note:ws:secret@2']).toBeUndefined()
  })

  test('repeated bind of the same surface/session does not duplicate', () => {
    const provider = new SurfaceContextProvider()
    const first = provider.bind({ surfaceId: 'notes', sessionId: 's1', context: base })
    const second = provider.bind({
      surfaceId: 'notes',
      sessionId: 's1',
      context: { ...base, selection: { text: 'updated' } },
    })
    expect(second.id).toBe(first.id)
    expect(provider.get('notes', 's1')?.envelope.selection?.text).toBe('updated')
    expect(second.envelope.policy).toBe('snapshot')
  })

  test('snapshot policy does not silently follow a live document change', () => {
    const provider = new SurfaceContextProvider()
    provider.bind({ surfaceId: 'notes', sessionId: 's1', context: base, policy: 'snapshot' })
    const live = { ...base, revisions: { 'note:ws:n1@1': '99' } }
    const rebound = provider.bind({ surfaceId: 'notes', sessionId: 's1', context: live, policy: 'snapshot' })
    expect(rebound.policy).toBe('snapshot')
    expect(rebound.envelope.revisions?.['note:ws:n1@1']).toBe('99')
  })
})

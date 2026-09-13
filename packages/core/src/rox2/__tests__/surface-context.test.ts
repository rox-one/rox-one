import { describe, expect, test } from 'bun:test'
import { bindSurfaceContext, rebaseLiveContext, sameContextSnapshot, visibleContextEntityRefs } from '../surface-context.ts'

describe('ROX2 surface context', () => {
  test('binds notes/project/task refs with revisions and hides unreadable sources', () => {
    const ctx = bindSurfaceContext({
      workspaceId: 'ws-1',
      sessionId: 's1',
      surfaceId: 'notes',
      permissionMode: 'ask',
      entityRefs: ['note:a', 'project:p', 'task:t', 'note:a'],
      revisionByEntityId: { 'note:a': 'rev-1' },
      tokenEstimate: 120,
    })
    expect(ctx.entityRefs).toEqual(['note:a', 'project:p', 'task:t'])
    expect(ctx.binding?.snapshotPolicy).toBe('snapshot')
    expect(ctx.binding?.revisionByEntityId['note:a']).toBe('rev-1')
    expect(visibleContextEntityRefs(ctx, new Set(['note:a', 'task:t']))).toEqual(['note:a', 'task:t'])
  })

  test('snapshot policy does not silently follow a document revision', () => {
    const first = bindSurfaceContext({
      workspaceId: 'ws-1',
      surfaceId: 'notes',
      permissionMode: 'safe',
      entityRefs: ['note:a'],
      revisionByEntityId: { 'note:a': 'rev-1' },
      snapshotPolicy: 'snapshot',
    })
    const moved = rebaseLiveContext(first, { 'note:a': 'rev-2' })
    expect(sameContextSnapshot(first, moved)).toBe(true)
    expect(first.binding?.revisionByEntityId['note:a']).toBe('rev-1')
    const live = bindSurfaceContext({
      workspaceId: 'ws-1',
      surfaceId: 'notes',
      permissionMode: 'safe',
      entityRefs: ['note:a'],
      revisionByEntityId: { 'note:a': 'rev-1' },
      snapshotPolicy: 'live',
    })
    const followed = rebaseLiveContext(live, { 'note:a': 'rev-2' })
    expect(sameContextSnapshot(live, followed)).toBe(false)
    expect(followed.binding?.revisionByEntityId['note:a']).toBe('rev-2')
  })

  test('repeated bind of the same snapshot is identical', () => {
    const input = {
      workspaceId: 'ws-1',
      surfaceId: 'tasks',
      permissionMode: 'allow-all' as const,
      entityRefs: ['task:1'],
      revisionByEntityId: { 'task:1': 'r1' },
    }
    const a = bindSurfaceContext(input)
    const b = bindSurfaceContext(input)
    expect(sameContextSnapshot(a, b)).toBe(true)
  })
})

import { describe, expect, it } from 'bun:test'
import { isHomeSessionInWorkspace, pickRecentHomeSessions } from '../home-model'

describe('pickRecentHomeSessions', () => {
  it('drops hidden and archived sessions, then sorts by last activity', () => {
    const picked = pickRecentHomeSessions([
      { id: 'old', lastMessageAt: 1 },
      { id: 'hidden', lastMessageAt: 99, hidden: true },
      { id: 'archived', lastMessageAt: 98, isArchived: true },
      { id: 'fresh', lastMessageAt: 50 },
      { id: 'created-only', createdAt: 40 },
    ], 3)
    expect(picked.map((session) => session.id)).toEqual(['fresh', 'created-only', 'old'])
  })

  it('returns an empty list when nothing is eligible', () => {
    expect(pickRecentHomeSessions([{ id: 'x', hidden: true }])).toEqual([])
  })
})

describe('isHomeSessionInWorkspace', () => {
  it('keeps every session when no workspace is selected', () => {
    expect(isHomeSessionInWorkspace({ workspaceId: 'ws-a' }, null)).toBe(true)
  })

  it('matches the local workspace id or the remote workspace id', () => {
    expect(isHomeSessionInWorkspace({ workspaceId: 'ws-a' }, 'ws-a')).toBe(true)
    expect(isHomeSessionInWorkspace({ workspaceId: 'remote-1' }, 'ws-a', 'remote-1')).toBe(true)
    expect(isHomeSessionInWorkspace({ workspaceId: 'ws-b' }, 'ws-a', 'remote-1')).toBe(false)
  })
})

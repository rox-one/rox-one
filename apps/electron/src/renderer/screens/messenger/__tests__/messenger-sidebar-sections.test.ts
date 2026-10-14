import { describe, expect, it } from 'bun:test'
import { buildMessengerSidebarSections, classifyBinding, projectMessengerSessions, sameMessengerSessions } from '../messenger-sidebar-sections'

const b = (id: string, platform: string, channelId: string, extra: Record<string, unknown> = {}) => ({ id, sessionId: `s-${id}`, platform, channelId, enabled: true, createdAt: 1, ...extra })

describe('classifyBinding', () => {
  it('uses the server chat type, never id conventions', () => {
    expect(classifyBinding({ chatType: 'private' })).toBe('direct')
    expect(classifyBinding({ chatType: 'supergroup' })).toBe('channel')
    expect(classifyBinding({ chatType: 'group', threadId: 7 })).toBe('thread')
    expect(classifyBinding({})).toBe('chat')
  })
})

describe('projectMessengerSessions', () => {
  it('ignores unrelated meta changes', () => {
    const a = projectMessengerSessions([{ id: 's', name: 'A', tokens: 1 } as never])
    const b = projectMessengerSessions([{ id: 's', name: 'A', tokens: 2 } as never])
    expect(sameMessengerSessions(a, b)).toBe(true)
    expect(sameMessengerSessions(a, projectMessengerSessions([{ id: 's', name: 'A', hasUnread: true }]))).toBe(false)
  })
})

describe('buildMessengerSidebarSections', () => {
  it('groups live bindings, pinned sessions first, newest first, drops orphan/disabled', () => {
    const sessions = new Map([
      ['s-a', { name: 'Team', lastMessageAt: 5 }],
      ['s-b', { name: 'Bob', lastMessageAt: 9, hasUnread: true }],
      ['s-c', { isFlagged: true }],
      ['s-d', { name: 'Topic', lastMessageAt: 1 }],
      ['s-e', { name: 'Off' }],
      ['s-f', { name: 'Unknown', lastMessageAt: 2 }],
    ])
    const secs = buildMessengerSidebarSections([
      b('a', 'telegram', '-1', { chatType: 'channel' }), b('b', 'telegram', '5', { chatType: 'private' }), b('c', 'whatsapp', 'x@g.us'), b('f', 'telegram', '8'), b('d', 'telegram', '-1', { threadId: 3 }),
      b('e', 'telegram', '6', { enabled: false }), b('z', 'telegram', '7'),
    ], sessions)
    expect(secs.map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([
      ['pinned', ['c']], ['channels', ['a']], ['direct', ['b']], ['chats', ['f']], ['threads', ['d']],
    ])
    expect(secs[2]!.items[0]).toMatchObject({ badge: 'unread', target: { kind: 'session', sessionId: 's-b' } })
    expect(secs[0]!.items[0]!.labelKey).toBe('screens.messenger.untitled')
  })
})

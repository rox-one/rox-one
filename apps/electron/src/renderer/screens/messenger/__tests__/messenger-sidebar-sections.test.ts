import { describe, expect, it } from 'bun:test'
import { buildMessengerSidebarSections, classifyBinding } from '../messenger-sidebar-sections'

const b = (id: string, platform: string, channelId: string, extra: Record<string, unknown> = {}) => ({ id, sessionId: `s-${id}`, platform, channelId, enabled: true, createdAt: 1, ...extra })

describe('classifyBinding', () => {
  it('uses platform id conventions', () => {
    expect(classifyBinding({ platform: 'telegram', channelId: '-100123' })).toBe('channel')
    expect(classifyBinding({ platform: 'telegram', channelId: '42' })).toBe('direct')
    expect(classifyBinding({ platform: 'telegram', channelId: '-1', threadId: 7 })).toBe('thread')
    expect(classifyBinding({ platform: 'whatsapp', channelId: '1@g.us' })).toBe('channel')
    expect(classifyBinding({ platform: 'whatsapp', channelId: '1@s.whatsapp.net' })).toBe('direct')
    expect(classifyBinding({ platform: 'discord', channelId: '9' })).toBe('channel')
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
    ])
    const secs = buildMessengerSidebarSections([
      b('a', 'telegram', '-1'), b('b', 'telegram', '5'), b('c', 'whatsapp', 'x@g.us'), b('d', 'telegram', '-1', { threadId: 3 }),
      b('e', 'telegram', '6', { enabled: false }), b('z', 'telegram', '7'),
    ], sessions)
    expect(secs.map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([
      ['pinned', ['c']], ['channels', ['a']], ['direct', ['b']], ['threads', ['d']],
    ])
    expect(secs[2]!.items[0]).toMatchObject({ badge: 'unread', target: { kind: 'session', sessionId: 's-b' } })
    expect(secs[0]!.items[0]!.labelKey).toBe('screens.messenger.untitled')
  })
})

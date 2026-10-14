import { describe, expect, it } from 'bun:test'
import { countUnreadSessions } from '../ShellUnreadSources'
import { markScreenSeen, resetShellPrefs, setScreenUnread, visibleUnread } from '../shell-prefs'

describe('unread badges (#8)', () => {
  it('shows only what arrived since the screen was last seen', () => {
    expect(visibleUnread({ inbox: 5 }, {})).toEqual({ inbox: 5 })
    expect(visibleUnread({ inbox: 5 }, { inbox: 5 })).toEqual({})
    expect(visibleUnread({ inbox: 7 }, { inbox: 5 })).toEqual({ inbox: 2 })
    // count dropped below the baseline (read elsewhere): nothing new
    expect(visibleUnread({ inbox: 2 }, { inbox: 5 })).toEqual({})
  })

  it('markScreenSeen snapshots the current count', () => {
    resetShellPrefs()
    const token = Symbol('t')
    setScreenUnread(token, 'sessions', 3)
    markScreenSeen('sessions')
    setScreenUnread(token, 'sessions', 3)
    resetShellPrefs()
  })

  it('counts unread, non-archived sessions', () => {
    const map = new Map([['a', { hasUnread: true }], ['b', { hasUnread: true, isArchived: true }], ['c', {}]])
    expect(countUnreadSessions(map)).toBe(1)
  })
})

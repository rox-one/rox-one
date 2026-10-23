import { beforeEach, describe, expect, it } from 'bun:test'
import {
  hydrateMessengerFeedChannelsFromRoster,
  listMessengerFeedChannels,
  matchesMessengerChannelFilter,
  reloadMessengerFeedChannels,
  setMessengerFeedChannel,
} from '../messenger-feed-channels'
import * as storage from '@/lib/local-storage'

function installMemoryLocalStorage(): void {
  const map = new Map<string, string>()
  const mem = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
    removeItem: (key: string) => { map.delete(key) },
    clear: () => { map.clear() },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true })
}

describe('messenger-feed-channels', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    storage.remove(storage.KEYS.messengerFeedChannels)
    reloadMessengerFeedChannels()
  })

  it('records and clears a followed channel', () => {
    setMessengerFeedChannel({ channelId: 'ch-1', name: 'релизы', orgId: 'org-1', subscribed: true })
    expect(listMessengerFeedChannels()).toEqual([
      expect.objectContaining({ channelId: 'ch-1', name: 'релизы', orgId: 'org-1' }),
    ])
    setMessengerFeedChannel({ channelId: 'ch-1', name: 'релизы', orgId: 'org-1', subscribed: false })
    expect(listMessengerFeedChannels()).toEqual([])
  })

  it('matches channel filter helper', () => {
    expect(matchesMessengerChannelFilter({ channelId: 'a' }, null)).toBe(true)
    expect(matchesMessengerChannelFilter({ channelId: 'a' }, 'a')).toBe(true)
    expect(matchesMessengerChannelFilter({ channelId: 'a' }, 'b')).toBe(false)
    // Untagged rows always pass so the team tab is not emptied pre-fan-out.
    expect(matchesMessengerChannelFilter({}, 'a')).toBe(true)
  })

  it('hydrates followed channels from the roster', () => {
    setMessengerFeedChannel({ channelId: 'stale', name: 'old', orgId: 'org-1', subscribed: true })
    hydrateMessengerFeedChannelsFromRoster(
      'org-1',
      [
        { id: 'ch-1', name: 'релизы', viewerSubscribed: true },
        { id: 'ch-2', name: 'spam', viewerSubscribed: false },
      ],
      (c) => c.name,
    )
    const ids = listMessengerFeedChannels().map((c) => c.channelId).sort()
    expect(ids).toEqual(['ch-1'])
  })
})

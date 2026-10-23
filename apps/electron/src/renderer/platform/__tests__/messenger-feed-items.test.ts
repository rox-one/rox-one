import { beforeEach, describe, expect, it } from 'bun:test'
import {
  buildMessengerFeedItems,
  listMessengerFeedItems,
  recordMessengerFeedItem,
  reloadMessengerFeedItems,
} from '../messenger-feed-items'
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

describe('messenger feed fan-out', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    storage.remove(storage.KEYS.messengerFeedItems)
    reloadMessengerFeedItems()
  })

  it('records idempotently and builds FeedItems with channelId', () => {
    const a = recordMessengerFeedItem({
      channelId: 'ch-1',
      messageId: 'm-1',
      senderId: 'u-carol',
      text: 'shipped v1',
      at: 100,
      channelName: 'releases',
    })
    expect(a?.id).toBe('messenger:ch-1:m-1')
    const again = recordMessengerFeedItem({
      channelId: 'ch-1',
      messageId: 'm-1',
      senderId: 'u-carol',
      text: 'shipped v1',
      at: 100,
    })
    expect(again?.id).toBe(a?.id)
    expect(listMessengerFeedItems()).toHaveLength(1)
    const items = buildMessengerFeedItems(listMessengerFeedItems(), (row) => `${row.senderId}: ${row.text}`)
    expect(items[0]).toMatchObject({
      tab: 'team',
      channelId: 'ch-1',
      author: 'u-carol',
      ref: { type: 'message', id: 'm-1', parentId: 'ch-1' },
    })
  })
})

import { afterEach, describe, expect, it } from 'bun:test'
import {
  collectInboxFilterStats,
  EMPTY_INBOX_STATE,
  setInboxScanSinkForTests,
  type InboxItem,
} from '../inbox-model'

afterEach(() => setInboxScanSinkForTests(null))

function item(id: string, group: 'decision' | 'message' = 'message'): InboxItem {
  return { id, kind: 'reply', group, blocking: false, title: id, source: 's', at: 1, data: {} } as InboxItem
}

describe('collectInboxFilterStats', () => {
  it('scans items once per items/filter identity change', () => {
    let n = 0
    setInboxScanSinkForTests(() => { n++ })
    const items = [item('a', 'decision'), item('b'), item('c')]
    const first = collectInboxFilterStats(items, EMPTY_INBOX_STATE, 0, 'all')
    expect(n).toBe(1)
    expect(first.counts.all).toBe(3)
    expect(first.counts.decisions).toBe(1)
    expect(first.counts.messages).toBe(2)
    collectInboxFilterStats(items, EMPTY_INBOX_STATE, 0, 'messages')
    expect(n).toBe(2)
  })
})

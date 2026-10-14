import { describe, expect, it } from 'bun:test'
import { buildBrowserSidebarSections, isRecordableUrl, recordVisit, toggleBookmark } from '../browser-sidebar-sections'

const tab = (id: string, url: string, title = '', extra = {}) => ({ id, url, title, isLoading: false, agentControlActive: false, ...extra })

describe('history + bookmarks helpers', () => {
  it('records only http(s), dedupes newest-first, caps', () => {
    expect(isRecordableUrl('about:blank')).toBe(false)
    let h = recordVisit([], { url: 'https://a.com', title: 'A', at: 1 })
    h = recordVisit(h, { url: 'https://b.com', title: 'B', at: 2 })
    h = recordVisit(h, { url: 'https://a.com', title: 'A2', at: 3 })
    expect(h.map((x) => [x.url, x.title])).toEqual([['https://a.com/', 'A2'], ['https://b.com/', 'B']])
    expect(recordVisit(h, { url: 'data:x', title: '', at: 4 })).toBe(h)
    expect(recordVisit(h, { url: 'https://c.com', title: 'C', at: 5 }, 2)).toHaveLength(2)
  })
  it('toggles bookmarks by url', () => {
    const b = toggleBookmark([], { url: 'https://a.com', title: 'A', at: 1 })
    expect(b).toHaveLength(1)
    expect(toggleBookmark(b, { url: 'https://a.com', title: 'x', at: 2 })).toEqual([])
  })
  it('strips query, fragment and credentials from bookmarks like history', () => {
    const b = toggleBookmark([], { url: 'https://u:p@a.com/cb?code=SECRET#tok', title: 'A', at: 1 })
    expect(b.map((x) => x.url)).toEqual(['https://a.com/cb'])
    // A legacy unstripped bookmark is matched (and removed) by its stripped form.
    expect(toggleBookmark([{ url: 'https://a.com/cb?code=old', title: 'A', at: 0 }], { url: 'https://a.com/cb?x=1', title: 'A', at: 2 })).toEqual([])
  })
})

describe('buildBrowserSidebarSections', () => {
  it('tabs with host fallback + menus; recent excludes open urls', () => {
    const secs = buildBrowserSidebarSections(
      [tab('1', 'https://rox.one/x'), tab('2', 'about:blank', '', { isLoading: true })],
      [{ url: 'https://rox.one/x', title: 'Rox', at: 1 }],
      [{ url: 'https://rox.one/x', title: 'Rox', at: 2 }, { url: 'https://hn.com', title: '', at: 1 }],
    )
    const [tabs, marks, recent] = secs
    expect(tabs!.items[0]).toMatchObject({ label: 'rox.one', target: { kind: 'view', viewId: '1' } })
    expect(tabs!.items[0]!.menu!.map((m) => m.id)).toEqual(['unbookmark', 'close'])
    expect(tabs!.items[1]!.menu!.map((m) => m.id)).toEqual(['close'])
    expect(tabs!.items[1]!.badge).toBe('running')
    expect(marks!.items[0]).toMatchObject({ label: 'Rox', target: { kind: 'url', url: 'https://rox.one/x' } })
    expect(recent!.items.map((i) => i.id)).toEqual(['recent:https://hn.com'])
    expect(recent!.items[0]!.label).toBe('hn.com')
  })
  it('nothing open, nothing saved → no groups', () => expect(buildBrowserSidebarSections([], [], [])).toEqual([]))
})

describe('history privacy', () => {
  it('strips query strings, fragments and credentials', async () => {
    const { historyUrl, isAgentDrivenTab, historyKey } = await import('@/lib/browser-history')
    expect(historyUrl('https://u:p@x.com/cb?code=SECRET#token=1')).toBe('https://x.com/cb')
    const h = recordVisit([], { url: 'https://x.com/a?x=1', title: 'X', at: 1 })
    expect(h[0]!.url).toBe('https://x.com/a')
    expect(isAgentDrivenTab({ ownerType: 'session' })).toBe(true)
    expect(isAgentDrivenTab({ ownerType: 'manual', boundSessionId: 's1' })).toBe(true)
    expect(isAgentDrivenTab({ ownerType: 'manual', agentControlActive: true })).toBe(true)
    expect(isAgentDrivenTab({ ownerType: 'manual', boundSessionId: null, agentControlActive: false })).toBe(false)
    expect(historyKey(null)).toBe('_')
  })
})

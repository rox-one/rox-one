import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { pathToFileURL } from 'node:url'

let stored: unknown = {}
let feed = { items: [] as any[], available: true, loaded: true }
let meetings = { meetings: [] as any[], available: true, loaded: true, workspaceId: 'workspace-a' }
const navigations: string[] = []
;(globalThis as any).window = { electronAPI: {} }
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
mock.module('jotai', () => ({ atom: () => ({}), useAtomValue: () => true }))
mock.module('@/context/AppShellContext', () => ({ useActiveWorkspace: () => ({ id: 'workspace-a' }) }))
mock.module('@/lib/navigate', () => ({
  navigate: (route: string) => navigations.push(route),
  routes: { view: { screen: (screen: string, id?: string) => id ? `${screen}/item/${encodeURIComponent(id)}` : screen } },
}))
mock.module('@/lib/extra-screens/storage', () => ({
  loadWorkspaceJson: (_namespace: string, _workspace: string, normalize: (data: unknown) => unknown) => normalize(stored),
  newLocalId: () => 'new-item', saveWorkspaceJson: () => {}, subscribeWorkspaceJson: () => () => {},
}))
mock.module('@/lib/extra-screens/use-rox-sources', () => ({
  useWorkspaceSessions: () => [], useMeetings: () => meetings, useFeedItems: () => feed,
  externalFeedItems: (items: any[]) => items, sessionTitle: () => '', loadFeed: async () => ({ items: [] }),
}))

const source = process.env.ROX_UI001_RADAR_SOURCE
  ? pathToFileURL(process.env.ROX_UI001_RADAR_SOURCE).href
  : new URL('../radar/RadarPage.tsx', import.meta.url).href
const { default: RadarPage } = await import(source)
const { ExtraScreenItemUnavailable } = await import('../ExtraScreenItemUnavailable')
const render = (itemId: string | null) => renderToStaticMarkup(React.createElement(RadarPage, { itemId }))
const noOverview = (html: string) => {
  expect(html).not.toContain('width:240px')
  expect(html).not.toContain('width:400px')
  expect(html).not.toContain('extraScreens.radar.digestOf')
}

describe('UI-001 Radar explicit selected address owns the pane', () => {
  it('missing address recovery uses the full pane across fresh renders without unrelated digest columns', () => {
    stored = {}; feed.loaded = true; navigations.length = 0
    for (let reload = 0; reload < 2; reload++) {
      const html = render('missing-item')
      noOverview(html)
      expect(html).toContain('data-testid="extra-screen-item-unavailable"')
      expect(html).toContain('data-item-id="missing-item"')
    }
    expect(navigations).toEqual([])
  })
  it('missing topic is immediately confirmed by the synchronous local catalog', () => {
    stored = {}; feed.loaded = false; meetings.loaded = false
    const html = render('topic:missing')
    noOverview(html)
    expect(html).toContain('data-item-id="topic:missing"')
    expect(html).not.toContain('radar-item-loading')
  })
  it('real feed lookup stays loading until completion, and failure settles to specific recovery', () => {
    stored = {}; feed = { items: [], available: true, loaded: false }
    const pending = render('feed-missing-topic')
    noOverview(pending)
    expect(pending).toContain('radar-item-loading')
    expect(pending).not.toContain('extra-screen-item-unavailable')
    feed = { items: [], available: false, loaded: true }
    const failed = render('feed-missing-topic')
    noOverview(failed)
    expect(failed).not.toContain('radar-item-loading')
    expect(failed).toContain('data-item-id="feed-missing-topic"')
  })
  it('real meeting lookup distinguishes pending from settled unavailable', () => {
    stored = {}; meetings = { meetings: [], available: false, loaded: false, workspaceId: 'workspace-a' }
    expect(render('loc-meeting-missing-topic')).toContain('radar-item-loading')
    meetings.loaded = true
    const settled = render('loc-meeting-missing-topic')
    noOverview(settled)
    expect(settled).toContain('extra-screen-item-unavailable')
    expect(settled).not.toContain('radar-item-loading')
  })
  it('retains actual supported topic and stored item detail at full pane width', () => {
    stored = {
      topics: [{ id: 'known', label: 'Known topic', kind: 'topic', keywords: [] }],
      sweeps: [{ id: 'sweep', sessionId: 'session', date: '2026-10-03', startedAt: 1, parsedAt: 1,
        items: [{ id: 'rad-known', title: 'Known item', summary: 'Selected summary', source: 'fixture', bucket: 'changed', origin: 'agent' }] }],
    }
    for (const [id, text] of [['topic:known', 'Known topic'], ['rad-known', 'Selected summary']] as const) {
      const html = render(id)
      noOverview(html)
      expect(html).toContain(text)
      expect(html).not.toContain('extra-screen-item-unavailable')
      expect(html).not.toContain('radar-item-loading')
    }
  })
  it('keeps root overview and exact Back-to-list callback', () => {
    stored = {}; feed.loaded = true; meetings.loaded = true
    const html = render(null)
    expect(html).toContain('width:240px')
    expect(html).toContain('width:400px')
    navigations.length = 0
    const recovery = ExtraScreenItemUnavailable({ screen: 'radar', itemId: 'missing' })
    recovery.props.children.props.action.props.onClick()
    expect(navigations).toEqual(['radar'])
  })
})

import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let stored: Record<string, unknown> = {}
const navigations: string[] = []
// This file runs in its own Bun process; effects and real service calls stay off.
;(globalThis as any).window = { electronAPI: {} }
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
mock.module('jotai', () => ({ atom: () => ({}), useAtomValue: () => true }))
mock.module('@/context/AppShellContext', () => ({ useActiveWorkspace: () => ({ id: 'workspace-a' }) }))
mock.module('@/lib/navigate', () => ({
  navigate: (route: string) => navigations.push(route),
  routes: { view: { screen: (screen: string, id?: string) => id ? `${screen}/item/${encodeURIComponent(id)}` : screen, settings: (page: string) => `settings/${page}` } },
}))
mock.module('@/lib/extra-screens/storage', () => ({
  loadWorkspaceJson: (namespace: string, _workspace: string, normalize: (data: unknown) => unknown) => normalize(stored[namespace]),
  newLocalId: () => 'new-item', saveWorkspaceJson: () => {}, subscribeWorkspaceJson: () => () => {},
}))
mock.module('@/lib/extra-screens/use-rox-sources', () => ({
  useWorkspaceSessions: () => [], usePersonalTasks: () => [], useMeetings: () => ({ meetings: [], available: true }),
  useMessengerBindings: () => [], useFeedItems: () => ({ items: [], available: true }),
  externalFeedItems: () => [], sessionTitle: () => '', loadFeed: async () => ({ items: [] }),
}))

const { default: DossierPage } = await import('../dossier/DossierPage')
const { default: RadarPage } = await import('../radar/RadarPage')
const { default: DecisionsPage } = await import('../decisions/DecisionsPage')
const { default: ExtraScreenHost } = await import('../ExtraScreenHost')
const { ExtraScreenItemUnavailable } = await import('../ExtraScreenItemUnavailable')

describe('UI-001 extra screen missing item routes', () => {
  for (const [screen, Page] of [['dossier', DossierPage], ['radar', RadarPage], ['decisions', DecisionsPage]] as const) {
    it(`${screen}: retains an explicit missing item on render and fresh reload`, () => {
      stored = {}
      navigations.length = 0
      for (let reload = 0; reload < 2; reload++) {
        const html = renderToStaticMarkup(React.createElement(Page, { itemId: 'missing-item' }))
        expect(html).toContain('data-testid="extra-screen-item-unavailable"')
        expect(html).toContain('data-item-id="missing-item"')
        expect(html).toContain('common.unavailable')
      }
      expect(navigations).toEqual([])
    })
    it(`${screen}: keeps the unselected root's normal empty surface`, () => {
      stored = {}
      expect(renderToStaticMarkup(React.createElement(Page, { itemId: null }))).not.toContain('data-testid="extra-screen-item-unavailable"')
    })
  }

  it('radar treats a missing topic distinctly from the root', () => {
    stored = {}
    expect(renderToStaticMarkup(React.createElement(RadarPage, { itemId: 'topic:missing' }))).toContain('data-item-id="topic:missing"')
  })

  it('decisions treats a missing candidate distinctly from the root', () => {
    stored = {}
    expect(renderToStaticMarkup(React.createElement(DecisionsPage, { itemId: 'cand:missing' }))).toContain('data-item-id="cand:missing"')
  })

  it('preserves supported dossier, topic and decision item details', () => {
    stored = {
      dossier: { entities: [{ id: 'known', name: 'Known person', kind: 'person' }] },
      radar: { topics: [{ id: 'known', label: 'Known topic', kind: 'topic', keywords: [] }] },
      decisions: { decisions: [{ id: 'known', title: 'Known decision' }] },
    }
    for (const [Page, id, title] of [[DossierPage, 'known', 'Known person'], [RadarPage, 'topic:known', 'Known topic'], [DecisionsPage, 'known', 'Known decision']] as const) {
      const html = renderToStaticMarkup(React.createElement(Page, { itemId: id }))
      expect(html).not.toContain('data-testid="extra-screen-item-unavailable"')
      expect(html).toContain(title)
    }
  })

  it('the missing-item recovery callback opens the exact screen root', () => {
    navigations.length = 0
    const element = ExtraScreenItemUnavailable({ screen: 'dossier', itemId: 'missing' })
    element.props.children.props.action.props.onClick()
    expect(navigations).toEqual(['dossier'])
  })

  for (const screen of ['agents', 'focus'] as const) {
    it(`${screen}: reports unsupported item selection explicitly`, () => {
      const html = renderToStaticMarkup(React.createElement(ExtraScreenHost, { screen, itemId: 'unhandled-item' }))
      expect(html).toContain('data-testid="extra-screen-item-unavailable"')
      expect(html).toContain('data-item-id="unhandled-item"')
      expect(html).toContain('common.unavailable')
    })
  }
})

/**
 * surface-tab-model.test.ts — tab-strip derivation for knowledge panels
 * (P3-16): knowledge/database/diff tabs name themselves from the node title
 * or the ref kind, never the generic "Panel" fallback.
 */
import { describe, it, expect } from 'bun:test'
import { setupI18n } from '@rox/shared/i18n'
import { APP_NAV_DESTINATIONS } from '../../components/app-shell/nav-destinations'
import { EXTRA_SCREENS } from '../../pages/extra-screens/registry'
import { buildRouteTitleKeys } from '../surface-shell'
import { routes, type ViewRoute } from '../../../shared/routes'
import { getPanelTypeFromRoute, type PanelStackEntry } from '../../atoms/panel-stack'
import {
  buildSurfaceTabViews,
  knowledgeRefKey,
  panelContextKeysFromRoute,
  type SurfaceTabLabels,
} from '../surface-tab-model'

const LABELS: SurfaceTabLabels = {
  untitled: 'Untitled',
  browser: 'Browser',
  panel: 'Panel',
  source: 'Source',
  settings: 'Settings',
  skills: 'Skills',
  knowledge: 'Knowledge',
  knowledgeDiff: 'Review changes',
  home: 'Home',
}

function entry(route: ViewRoute, id = `p-${route}`): PanelStackEntry {
  return { id, route, proportion: 1, panelType: 'knowledge', laneId: 'main' }
}

function build(entries: PanelStackEntry[], resolveKnowledgeTitle?: Parameters<typeof buildSurfaceTabViews>[0]['resolveKnowledgeTitle']) {
  return buildSurfaceTabViews({
    entries,
    focusedPanelId: null,
    resolveSessionTitle: () => null,
    resolveKnowledgeTitle,
    labels: LABELS,
  })
}

describe('buildSurfaceTabViews: knowledge panels', () => {
  it('names a document tab from the resolved node title', () => {
    const route = routes.view.siyuan({ kind: 'document', id: 'doc-1' })
    const [tab] = build(
      [entry(route)],
      (ref) => (knowledgeRefKey(ref) === 'document:doc-1' ? 'Project notes' : null),
    )
    expect(tab.kind).toBe('knowledge')
    expect(tab.title).toBe('Project notes')
  })

  it('falls back to the ref kind (not "Panel") when the title is unresolved', () => {
    const route = routes.view.siyuan({ kind: 'document', id: 'doc-1' })
    const [tab] = build([entry(route)], () => null)
    expect(tab.kind).toBe('knowledge')
    expect(tab.title).toBe('Knowledge · document')
    expect(tab.title).not.toBe(LABELS.panel)
  })

  it('falls back the same way without a resolver at all', () => {
    const route = routes.view.siyuan({ kind: 'notebook', id: 'nb-1' })
    const [tab] = build([entry(route)])
    expect(tab.kind).toBe('knowledge')
    expect(tab.title).toBe('Knowledge · notebook')
  })

  it('maps the database tab route onto the database kind', () => {
    const route = routes.view.siyuan({ kind: 'database', id: 'db-9' })
    const [tab] = build([entry(route)], () => null)
    expect(tab.kind).toBe('database')
    expect(tab.title).toBe('Knowledge · database')
  })

  it('names write-back review tabs from the review label, not "Panel"', () => {
    const route = routes.view.proposal('prop-7')
    const [tab] = build([entry(route)])
    expect(tab.kind).toBe('diff')
    expect(tab.title).toBe('Review changes')
  })

  it('names the knowledge navigator root from the knowledge label', () => {
    const [tab] = build([entry(routes.view.knowledge())])
    expect(tab.kind).toBe('knowledge')
    expect(tab.title).toBe('Knowledge')
  })
})

describe('buildSurfaceTabViews: home', () => {
  it('names the home route from the home label, not "Panel"', () => {
    const [tab] = build([
      { id: 'p-home', route: routes.view.home(), proportion: 1, panelType: 'other', laneId: 'main' },
    ])
    expect(tab.kind).toBeNull()
    expect(tab.title).toBe('Home')
    expect(tab.title).not.toBe(LABELS.panel)
  })
})

describe('buildSurfaceTabViews: navigator panels', () => {
  it('names a Rox History tab from the route title, not the generic "Panel"', () => {
    const route = routes.view.clipboardHistory()
    const [tab] = buildSurfaceTabViews({
      entries: [{ id: 'p-clip', route, proportion: 1, panelType: 'clipboard-history', laneId: 'main' }],
      focusedPanelId: null,
      resolveSessionTitle: () => null,
      // The shell resolves 'clipboard-history' → clipboard.title through
      // buildRouteTitleKeys / APP_NAV_DESTINATIONS.
      resolveRouteTitle: (r) => (r.split('?')[0] === 'clipboard-history' ? 'Clipboard History' : null),
      labels: LABELS,
    })
    expect(tab.title).toBe('Clipboard History')
    expect(tab.title).not.toBe(LABELS.panel)
    // Lane policy keeps the dedicated PanelType; the surface kind still degrades.
    expect(tab.panelType).toBe('clipboard-history')
    expect(tab.kind).toBeNull()
  })

  it('falls back to "Panel" when no route title resolves', () => {
    const [tab] = buildSurfaceTabViews({
      entries: [{ id: 'p-clip', route: routes.view.clipboardHistory(), proportion: 1, panelType: 'clipboard-history', laneId: 'main' }],
      focusedPanelId: null,
      resolveSessionTitle: () => null,
      labels: LABELS,
    })
    expect(tab.title).toBe(LABELS.panel)
  })
})

describe('buildSurfaceTabViews: cookbooks surface', () => {
  // The real chain SurfaceTabs wires — APP_NAV_DESTINATIONS → buildRouteTitleKeys
  // → t — so both halves of the tab label are covered: the destination entry
  // that maps the route root, and the panel type that must ask for it. Missing
  // either one leaves the tab reading «Панель».
  const i18n = setupI18n()
  const routeTitleKeys = buildRouteTitleKeys({
    destinations: APP_NAV_DESTINATIONS,
    modes: [],
    extraScreens: EXTRA_SCREENS,
  })
  const labels: SurfaceTabLabels = { ...LABELS, panel: i18n.t('surfaceTabs.panel') }

  function cookbooksTab() {
    const route = routes.view.cookbooks()
    return buildSurfaceTabViews({
      entries: [
        { id: 'p-cookbooks', route, proportion: 1, panelType: getPanelTypeFromRoute(route), laneId: 'main' },
      ],
      focusedPanelId: null,
      resolveSessionTitle: () => null,
      resolveRouteTitle: (r) => {
        const key = routeTitleKeys.get(r.split('?')[0].split('/')[0])
        return key ? i18n.t(key) : null
      },
      labels,
    })[0]
  }

  it('labels the tab from the route (ru «Кукбуки»), never the generic «Панель»', () => {
    const tab = cookbooksTab()
    // The dedicated PanelType is what gives the tab its glyph in SurfaceTabs.
    expect(tab.panelType).toBe('cookbooks')
    expect(tab.title).toBe('Кукбуки')
    expect(tab.title).not.toBe(labels.panel)
  })

  it('keeps the route → labelKey mapping that names the surface', () => {
    expect(routeTitleKeys.get('cookbooks')).toBe('sidebar.cookbooks')
    expect(i18n.t('sidebar.cookbooks')).toBe('Кукбуки')
  })
})

describe('panelContextKeysFromRoute', () => {
  it('publishes activeSurface knowledge for a knowledge document route', () => {
    expect(panelContextKeysFromRoute('knowledge/document/doc-1')).toEqual({ activeSurface: 'knowledge' })
  })

  it('publishes activeSurface session for a session route', () => {
    expect(panelContextKeysFromRoute('allSessions/session/session-1')).toEqual({ activeSurface: 'session' })
  })

  it('returns empty context when the route is missing or not a surface', () => {
    expect(panelContextKeysFromRoute(null)).toEqual({})
    expect(panelContextKeysFromRoute('settings/shortcuts')).toEqual({})
  })
})

/**
 * W1-07 (#1504, review4 #3 — owner decision): the left ActivityRail and the
 * compact destination list also list registered modes, in pill / ⌘1…7 order.
 * With every mode flag off the rail renders exactly the baseline seven core
 * modes and the compact list exactly APP_NAV_DESTINATIONS (main).
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { getDefaultStore } from 'jotai'
import { RESET } from 'jotai/utils'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { NavigationContext } from '@/contexts/NavigationContext'
import { resolveCompactWorkspaceSelection } from '@/components/app-shell/compact-workspace-navigation'
import type { PanelStackEntry } from '@/atoms/panel-stack'
import { ActivityRail } from '../ActivityRail'
import { setNavPlacement } from '@/components/app-shell/nav-placement'
import { __resetModeRegistryForTests, getModeRegistry, registerSeededMode } from '../mode-registry-bootstrap'
import { listShellModes, railModeEntries } from '../surface-shell'
import { workbenchFlagAtom } from '../unified-flags'

const i18n = createInstance()
void i18n.init({ lng: 'ru', resources: {}, initAsync: false })

const UNIFIED_FLAGS = [
  WORKBENCH_FLAG.modeMessengerV1, WORKBENCH_FLAG.modeCalendarV1, WORKBENCH_FLAG.modeGoalsV1,
]

// A wave-2 mode gated by a catalog flag (a generic default-OFF one; wave-2 adds its own).
const WIKI_FLAG = WORKBENCH_FLAG.docsSharedV1

const fakeMode = {
  contribution: {
    id: 'wiki', titleKey: 'workbench.mode.wiki', icon: 'BookOpen', rootRoute: 'screen/wiki',
    order: 52, defaultPinned: true, layoutProfileId: 'agent', when: WIKI_FLAG,
  },
  isActive: (nav: { navigator: string; screen?: string }) => nav.navigator === 'screen' && nav.screen === 'wiki',
} as never

afterEach(() => {
  const store = getDefaultStore()
  for (const flag of [...UNIFIED_FLAGS, WIKI_FLAG, WORKBENCH_FLAG.modeCanvasV1]) store.set(workbenchFlagAtom(flag), RESET)
  __resetModeRegistryForTests()
})

const pill = (flags: Iterable<string>) => listShellModes(getModeRegistry(), {}, new Set(flags))

describe('railModeEntries (pure)', () => {
  it('all mode flags off: no extra entries beyond the baseline seven modes', () => {
    expect(railModeEntries(pill([]))).toEqual([])
  })

  it('mode flags on: unified modes in the pill order, baseline seven excluded', () => {
    const modes = pill(UNIFIED_FLAGS)
    const entries = railModeEntries(modes)
    expect(entries.map((mode) => mode.id)).toEqual(['messenger', 'calendar', 'goals'])
    // Same relative order as the pill / ⌘ slots.
    const pillOrder = modes.map((mode) => mode.id).filter((id) => entries.some((entry) => entry.id === id))
    expect(entries.map((mode) => mode.id)).toEqual(pillOrder)
  })

  it('one flag on: only that mode', () => {
    expect(railModeEntries(pill([WORKBENCH_FLAG.modeGoalsV1])).map((mode) => mode.id)).toEqual(['goals'])
  })

  it('a wave-2 registerSeededMode mode appears in pill order once its flag is on', () => {
    registerSeededMode(fakeMode)
    expect(railModeEntries(pill(UNIFIED_FLAGS)).map((mode) => mode.id)).toEqual(['messenger', 'calendar', 'goals'])
    const entries = railModeEntries(pill([...UNIFIED_FLAGS, WIKI_FLAG]))
    expect(entries.map((mode) => mode.id)).toEqual(['messenger', 'calendar', 'goals', 'wiki'])
  })

  it('non-navigable modes (rootRoute null) are skipped', () => {
    const modes = pill(UNIFIED_FLAGS).map((mode) => (mode.id === 'calendar' ? { ...mode, rootRoute: null } : mode))
    expect(railModeEntries(modes).map((mode) => mode.id)).toEqual(['messenger', 'goals'])
  })
})

function renderRail(navigationState: Record<string, unknown> = { navigator: 'sessions' }): string {
  const value = { navigate: async () => {}, navigationState } as never
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <NavigationContext.Provider value={value}>
        <ActivityRail />
      </NavigationContext.Provider>
    </I18nextProvider>,
  )
}

const railIds = (html: string) => [...html.matchAll(/data-testid="(rail-(?:item|mode)-[^"]+)"/g)].map((match) => match[1])

/**
 * WP5 (#1580): flags off, the rail shows the registry's primary group; «Ещё» is closed.
 * WP6: one surface = one place — Чат and Документы live in the titlebar pill by default.
 */
// Sidebar v2: the rail mirrors the sidebar's core order (pill surfaces keep their row; the browser
// action needs a browser host, absent in this render).
const BASELINE_RAIL_IDS = ['home', 'inbox', 'sessions', 'feed', 'docs', 'tasks', 'projects', 'meetings'].map((id) => `rail-item-${id}`)

describe('ActivityRail render', () => {
  it('all mode flags off: exactly the registry primary group, no modes group, «Ещё» closed', () => {
    // Мессенджер + «Доска» are default ON — turn both off for the baseline rail.
    getDefaultStore().set(workbenchFlagAtom(WORKBENCH_FLAG.modeMessengerV1), false)
    getDefaultStore().set(workbenchFlagAtom(WORKBENCH_FLAG.modeCanvasV1), false)
    const html = renderRail()
    expect(railIds(html)).toEqual(BASELINE_RAIL_IDS)
    expect(html).not.toContain('data-testid="rail-modes"')
    expect(html).toContain('data-testid="rail-more"')
    expect(html).not.toContain('data-testid="rail-more-group"')
  })

  it('mode flags on: unified modes join the primary group in spec order; a wave-2 mode follows', () => {
    registerSeededMode(fakeMode)
    const store = getDefaultStore()
    for (const flag of [...UNIFIED_FLAGS, WIKI_FLAG]) store.set(workbenchFlagAtom(flag), true)
    const html = renderRail()
    expect(html).toContain('data-testid="rail-modes"')
    expect(railModeEntries(pill([...UNIFIED_FLAGS, WIKI_FLAG])).map((mode) => mode.id)).toEqual(['messenger', 'calendar', 'goals', 'wiki'])
    // Projects gives its primary slot to «Цели и проекты» (goals) and moves to «Ещё».
    expect(railIds(html)).toEqual([
      // Sidebar v2: core order; pill surfaces (Мессенджер, Документы, «Доска»…) keep their rail row.
      // «Доска» is default-ON, so it stays in the primary group alongside the explicitly enabled modes.
      ...['home', 'inbox', 'messenger', 'sessions', 'feed', 'docs', 'tasks', 'goals', 'calendar', 'canvas'].map((id) => `rail-item-${id}`),
      'rail-mode-wiki',
    ])
  })

  it('docs.shared.v1 relabels the rail Notes mode («Документы») without touching the ids', () => {
    const store = getDefaultStore()
    store.set(workbenchFlagAtom(WIKI_FLAG), true)
    setNavPlacement('docs', 'menu') // WP6: out of the pill, into the rail
    const html = renderRail()
    setNavPlacement('docs', null)
    expect(html).toContain('workbench.mode.docs')
    expect(html).not.toContain('workbench.mode.notes')
    expect(railIds(html)).toContain('rail-item-docs')
    expect(html).not.toContain('data-testid="rail-modes"')
  })
})

describe('ActivityRail «Ещё» (WP5 review3)', () => {
  const moreRow = (html: string) => html.match(/<button[^>]*data-testid="rail-more"[^>]*>/)?.[0] ?? ''

  it('stays closed and actionable when nothing inside is active', () => {
    const html = renderRail()
    expect(html).not.toContain('data-testid="rail-more-group"')
    expect(moreRow(html)).not.toContain('aria-disabled')
  })

  it('is forced open by an active extra screen, header locked (aria-disabled)', () => {
    const html = renderRail({ navigator: 'screen', screen: 'radar' })
    expect(html).toContain('data-testid="rail-more-group"')
    expect(html).toContain('data-testid="rail-extra-screens"')
    expect(moreRow(html)).toContain('aria-disabled="true"')
    expect(moreRow(html)).toContain('aria-expanded="true"')
  })

  it('is forced open by an active registry «Ещё» destination', () => {
    const html = renderRail({ navigator: 'memory' })
    expect(html).toContain('data-testid="rail-more-group"')
    expect(moreRow(html)).toContain('aria-disabled="true"')
  })
})

describe('CompactWorkspaceMenu destination list', () => {
  const src = readFileSync(join(import.meta.dir, '../../components/app-shell/CompactWorkspaceMenu.tsx'), 'utf8')

  it('appends railModeEntries(useShellModes().modes) after the visible destinations', () => {
    expect(src).toContain('const modeEntries = railModeEntries(useShellModes().modes)')
    const destinations = src.indexOf('{visibleDestinations.map((destination)')
    const modes = src.indexOf('{modeEntries.map((mode)')
    expect(destinations).toBeGreaterThan(0)
    expect(modes).toBeGreaterThan(destinations)
    expect(src).toContain("activate({ kind: 'mode', route: mode.rootRoute! })")
  })

  const panel = (id: string, route: string) => ({ id, route, proportion: 1, panelType: 'other', laneId: 'main' }) as PanelStackEntry

  it('selecting a mode focuses an open panel on its root, else navigates', () => {
    const panels = [panel('a', 'allSessions'), panel('b', 'messenger')]
    expect(resolveCompactWorkspaceSelection(panels, 'a', { kind: 'mode', route: 'messenger' })).toEqual({ kind: 'focus', panelId: 'b' })
    expect(resolveCompactWorkspaceSelection(panels, 'a', { kind: 'mode', route: 'calendar' })).toEqual({ kind: 'navigate', route: 'calendar' as never })
  })
})

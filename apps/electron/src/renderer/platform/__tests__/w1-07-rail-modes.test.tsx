/**
 * W1-07 (#1504, review4 #3 — owner decision): the left ActivityRail and the
 * compact destination list also list registered modes, in pill / ⌘1…7 order.
 * With every mode flag off both render exactly APP_NAV_DESTINATIONS (main).
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
import { APP_NAV_DESTINATIONS } from '@/components/app-shell/nav-destinations'
import { resolveCompactWorkspaceSelection } from '@/components/app-shell/compact-workspace-navigation'
import type { PanelStackEntry } from '@/atoms/panel-stack'
import { ActivityRail } from '../ActivityRail'
import { __resetModeRegistryForTests, getModeRegistry, registerSeededMode } from '../mode-registry-bootstrap'
import { listShellModes, railModeEntries } from '../surface-shell'
import { workbenchFlagAtom } from '../unified-flags'

const i18n = createInstance()
void i18n.init({ lng: 'ru', resources: {}, initAsync: false })

const UNIFIED_FLAGS = [
  WORKBENCH_FLAG.modeMessengerV1, WORKBENCH_FLAG.modeCalendarV1, WORKBENCH_FLAG.modeGoalsV1, WORKBENCH_FLAG.modeContactsV1,
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
  for (const flag of [...UNIFIED_FLAGS, WIKI_FLAG]) store.set(workbenchFlagAtom(flag), RESET)
  __resetModeRegistryForTests()
})

const pill = (flags: Iterable<string>) => listShellModes(getModeRegistry(), {}, new Set(flags))

describe('railModeEntries (pure)', () => {
  it('all mode flags off: no extra entries → exactly APP_NAV_DESTINATIONS', () => {
    expect(railModeEntries(pill([]))).toEqual([])
  })

  it('mode flags on: unified modes in the pill order, baseline seven excluded', () => {
    const modes = pill(UNIFIED_FLAGS)
    const entries = railModeEntries(modes)
    expect(entries.map((mode) => mode.id)).toEqual(['messenger', 'calendar', 'goals', 'contacts'])
    // Same relative order as the pill / ⌘ slots.
    const pillOrder = modes.map((mode) => mode.id).filter((id) => entries.some((entry) => entry.id === id))
    expect(entries.map((mode) => mode.id)).toEqual(pillOrder)
  })

  it('one flag on: only that mode', () => {
    expect(railModeEntries(pill([WORKBENCH_FLAG.modeGoalsV1])).map((mode) => mode.id)).toEqual(['goals'])
  })

  it('a wave-2 registerSeededMode mode appears in pill order once its flag is on', () => {
    registerSeededMode(fakeMode)
    expect(railModeEntries(pill(UNIFIED_FLAGS)).map((mode) => mode.id)).toEqual(['messenger', 'calendar', 'goals', 'contacts'])
    const entries = railModeEntries(pill([...UNIFIED_FLAGS, WIKI_FLAG]))
    expect(entries.map((mode) => mode.id)).toEqual(['messenger', 'calendar', 'goals', 'wiki', 'contacts'])
  })

  it('non-navigable modes (rootRoute null) are skipped', () => {
    const modes = pill(UNIFIED_FLAGS).map((mode) => (mode.id === 'calendar' ? { ...mode, rootRoute: null } : mode))
    expect(railModeEntries(modes).map((mode) => mode.id)).toEqual(['messenger', 'goals', 'contacts'])
  })
})

function renderRail(): string {
  const value = { navigate: async () => {}, navigationState: { navigator: 'sessions' } } as never
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <NavigationContext.Provider value={value}>
        <ActivityRail />
      </NavigationContext.Provider>
    </I18nextProvider>,
  )
}

const railIds = (html: string) => [...html.matchAll(/data-testid="(rail-(?:item|mode)-[^"]+)"/g)].map((match) => match[1])

describe('ActivityRail render', () => {
  it('all mode flags off: exactly APP_NAV_DESTINATIONS, no modes group', () => {
    const html = renderRail()
    expect(railIds(html)).toEqual(APP_NAV_DESTINATIONS.map((dest) => `rail-item-${dest.id}`))
    expect(html).not.toContain('data-testid="rail-modes"')
  })

  it('mode flags on: destinations, then modes in pill order (incl. a wave-2 mode)', () => {
    registerSeededMode(fakeMode)
    const store = getDefaultStore()
    for (const flag of [...UNIFIED_FLAGS, WIKI_FLAG]) store.set(workbenchFlagAtom(flag), true)
    const html = renderRail()
    expect(html).toContain('data-testid="rail-modes"')
    expect(railIds(html)).toEqual([
      ...APP_NAV_DESTINATIONS.map((dest) => `rail-item-${dest.id}`),
      'rail-mode-messenger', 'rail-mode-calendar', 'rail-mode-goals', 'rail-mode-wiki', 'rail-mode-contacts',
    ])
  })
})

describe('CompactWorkspaceMenu destination list', () => {
  const src = readFileSync(join(import.meta.dir, '../../components/app-shell/CompactWorkspaceMenu.tsx'), 'utf8')

  it('appends railModeEntries(useShellModes().modes) after APP_NAV_DESTINATIONS', () => {
    expect(src).toContain('const modeEntries = railModeEntries(useShellModes().modes)')
    const destinations = src.indexOf('{APP_NAV_DESTINATIONS.map((destination)')
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

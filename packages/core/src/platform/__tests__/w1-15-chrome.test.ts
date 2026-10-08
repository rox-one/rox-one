/**
 * W1-15 (#1512) acceptance — surface chrome contract and the schema lint over
 * a fixture of **all** surfaces of UI-SPEC §26.2 (left sidebar) and §26.3
 * (top bar).
 *
 * The fixture is the reference chrome the lint validates: CHR (#1533) and the
 * wave-2 surface packages replace it with their own registrations, and this
 * file proves the contract can express every surface without an exception.
 *
 * Also asserted here:
 * - the three W1-15 flags are registered once, default OFF, no dependencies;
 * - the slot ids the contract hands to W1-07 are well-formed and reserved for
 *   #1512 there;
 * - every i18n key the fixture uses exists in all 12 locales (a typo cannot
 *   slip through as a "fixture-only" key).
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FIXTURE_SIDEBAR_SURFACES,
  FIXTURE_TOPBAR_SURFACES,
  SURFACE_CHROME_FIXTURE,
} from './fixtures/surface-chrome.ts'
import {
  COMMON_ROW_CONTEXT_MENU,
  COUNTER_DISPLAY_CAP,
  MAX_TOPBAR_VIEWS,
  SIDEBAR_DEFAULT_WIDTHS,
  TOPBAR_RIGHT_ZONE_ORDER,
  USER_COUNTERS_COALESCE_MS,
  USER_COUNTERS_EVENT_TYPE,
  USER_COUNTERS_TOPIC,
  CHROME_SURFACES_WORKBENCH_FLAG,
  agentContextSlotId,
  buildRowContextMenu,
  chromeSlot,
  chromeSlotId,
  counterQueryName,
  formatCounter,
  isAgentContextSlotId,
  isChromeSlotId,
  isCounterQueryName,
  isSidebarSectionSlotId,
  lintChromeCatalogue,
  lintSurfaceChrome,
  sidebarSectionSlotId,
  userCountersTopic,
  type TopBarSchema,
} from '../chrome.ts'
import { WORKBENCH_FEATURE_FLAGS, WORKBENCH_FLAG } from '../workbench/index.ts'
import { REALTIME_EVENT_TYPES, isRealtimeEventType } from '../../events/topics.ts'

const W1_15_FLAGS = [
  WORKBENCH_FLAG.agentPanelV1,
  WORKBENCH_FLAG.workbenchChromeSurfacesV1,
  WORKBENCH_FLAG.xfnCapabilitiesV1,
]

const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hu', 'ja', 'ko', 'pl', 'ru', 'zh-Hans', 'zh-Hant']
const LOCALES_DIR = join(import.meta.dir, '../../../../shared/src/i18n/locales')
const locale = (lang: string) => JSON.parse(readFileSync(join(LOCALES_DIR, `${lang}.json`), 'utf8')) as Record<string, string>

describe('W1-15 workbench flags', () => {
  it('uses the spec ids and defaults every one to OFF', () => {
    expect(W1_15_FLAGS).toEqual(['agent.panel.v1', 'workbench.chrome.surfaces.v1', 'xfn.capabilities.v1'])
    for (const id of W1_15_FLAGS) {
      expect(WORKBENCH_FEATURE_FLAGS.filter((flag) => flag.id === id)).toEqual([
        { id, defaultValue: false, dependencies: [], rollbackSafe: true },
      ])
    }
  })

  it('keeps every flag id unique across the registry', () => {
    const ids = WORKBENCH_FEATURE_FLAGS.map((flag) => flag.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('W1-15 chrome slot ids (W1-07 registry)', () => {
  it('builds the three reserved id shapes and rejects malformed surfaces', () => {
    expect(chromeSlotId('messenger')).toBe('messenger.chrome')
    expect(sidebarSectionSlotId('docs', 'drive')).toBe('docs.sidebar.drive')
    expect(agentContextSlotId('tasks')).toBe('agent.context.tasks')

    expect(isChromeSlotId('messenger.chrome')).toBe(true)
    expect(isChromeSlotId('messenger.sidebar')).toBe(false)
    expect(isSidebarSectionSlotId('docs.sidebar.drive')).toBe(true)
    expect(isAgentContextSlotId('agent.context.goals')).toBe(true)
    expect(isAgentContextSlotId('agent.goals')).toBe(false)

    expect(() => chromeSlotId('Messenger')).toThrow()
    expect(() => sidebarSectionSlotId('docs', 'Drive')).toThrow()
    expect(() => agentContextSlotId('')).toThrow()
  })

  it('produces a slot contribution whose id matches W1-07s reserved grammar', () => {
    const contribution = chromeSlot(SURFACE_CHROME_FIXTURE[0]!, { order: 10, source: 'w1-15' })
    expect(contribution.slot).toBe(`${SURFACE_CHROME_FIXTURE[0]!.surface}.chrome`)
    expect(contribution.flag).toBe(CHROME_SURFACES_WORKBENCH_FLAG)
    expect(contribution.order).toBe(10)
    expect(contribution.source).toBe('w1-15')
    expect(isChromeSlotId(contribution.slot)).toBe(true)
  })
})

describe('W1-15 chrome schema lint', () => {
  it('covers every surface of UI-SPEC §26.2 (sidebar) and §26.3 (top bar)', () => {
    expect(FIXTURE_SIDEBAR_SURFACES.length).toBe(18)
    expect(FIXTURE_TOPBAR_SURFACES.length).toBe(25)
    const issues = lintChromeCatalogue(SURFACE_CHROME_FIXTURE, {
      requireSidebar: FIXTURE_SIDEBAR_SURFACES,
      requireTopBar: FIXTURE_TOPBAR_SURFACES,
    })
    expect(issues).toEqual([])
  })

  it("keeps the §26.1 right-zone order: filter · sort · search · presence · share · primary · more", () => {
    const positions = TOPBAR_RIGHT_ZONE_ORDER
    for (const contribution of SURFACE_CHROME_FIXTURE) {
      const right = contribution.topBar?.right ?? []
      const names = right.map((item) => (typeof item === 'string' ? item : 'primary'))
      expect(names.length).toBeGreaterThan(0)
      expect(names.every((name) => positions.includes(name as never))).toBe(true)
      // Ascending, no duplicates.
      expect(names).toEqual([...names].sort((a, b) => positions.indexOf(a as never) - positions.indexOf(b as never)))
      expect(new Set(names).size).toBe(names.length)
      // @rox is appended by the shell and never listed by a surface; ⋯ more sits
      // last among the surface's own items (divider · @rox follow it).
      expect(names).not.toContain('@rox')
      if (names.includes('more')) expect(names.at(-1)).toBe('more')
    }
  })

  it('has at most one center control per surface', () => {
    for (const contribution of SURFACE_CHROME_FIXTURE) {
      expect(Array.isArray(contribution.topBar?.center)).toBe(false)
    }
    const withQueryCenter = SURFACE_CHROME_FIXTURE.filter((entry) => entry.topBar?.center?.kind === 'query')
    expect(withQueryCenter.map((entry) => entry.surface)).toEqual(['search'])
    for (const contribution of SURFACE_CHROME_FIXTURE) {
      const center = contribution.topBar?.center
      if (center?.kind === 'views') expect(center.views.length).toBeLessThanOrEqual(MAX_TOPBAR_VIEWS)
    }
  })

  it('gives every sidebar unique, slot-shaped section ids and a spec width', () => {
    for (const contribution of SURFACE_CHROME_FIXTURE) {
      const sidebar = contribution.sidebar
      if (!sidebar) continue
      expect(SIDEBAR_DEFAULT_WIDTHS).toContain(sidebar.defaultWidth)
      const ids = sidebar.sections.map((section) => section.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const section of sidebar.sections) {
        expect(sidebarSectionSlotId(sidebar.surface, section.id)).toBe(`${sidebar.surface}.sidebar.${section.id}`)
        if (section.counter) expect(isCounterQueryName(section.counter.provider)).toBe(true)
      }
    }
  })

  it('detects the violations it claims to (negative controls)', () => {
    const base = SURFACE_CHROME_FIXTURE.find((entry) => entry.surface === 'tasks')!
    const topBar = base.topBar as TopBarSchema

    expect(lintSurfaceChrome({ surface: 'tasks', topBar: { ...topBar, right: ['more', 'filter'] } }))
      .toContainEqual(expect.objectContaining({ rule: 'right-zone-order' }))
    expect(lintSurfaceChrome({ surface: 'tasks', topBar: { ...topBar, right: ['filter', 'filter'] } }))
      .toContainEqual(expect.objectContaining({ rule: 'right-zone-duplicate' }))
    expect(lintSurfaceChrome({ surface: 'tasks', topBar: { ...topBar, right: ['presence', '@rox' as never] } }))
      .toContainEqual(expect.objectContaining({ rule: 'right-zone-agent' }))
    expect(lintSurfaceChrome({ surface: 'tasks', topBar: { ...topBar, left: ['title', 'back-forward'] } }))
      .toContainEqual(expect.objectContaining({ rule: 'left-zone-order' }))
    expect(lintSurfaceChrome({ surface: 'tasks', topBar: { ...topBar, center: { kind: 'views', views: [] } } }))
      .toContainEqual(expect.objectContaining({ rule: 'center-views' }))
    expect(lintSurfaceChrome({ surface: 'tasks', sidebar: { ...base.sidebar!, defaultWidth: 300 as never } }))
      .toContainEqual(expect.objectContaining({ rule: 'default-width' }))
    expect(lintSurfaceChrome({
      surface: 'tasks',
      sidebar: { ...base.sidebar!, sections: [...base.sidebar!.sections, base.sidebar!.sections[0]!] },
    })).toContainEqual(expect.objectContaining({ rule: 'section-unique' }))

    // A surface missing from the fixture is reported, not silently skipped.
    expect(lintChromeCatalogue([], { requireSidebar: ['home'], requireTopBar: ['home'] }))
      .toEqual([
        { surface: 'home', rule: 'sidebar-missing', detail: 'surface has no SidebarSchema' },
        { surface: 'home', rule: 'topbar-missing', detail: 'surface has no TopBarSchema' },
      ])
  })

  it('rejects a secret width / footer / counter that the shell cannot render', () => {
    const base = SURFACE_CHROME_FIXTURE.find((entry) => entry.surface === 'home')!
    expect(lintSurfaceChrome({ surface: 'home', sidebar: { ...base.sidebar!, footer: 'nope' as never } }))
      .toContainEqual(expect.objectContaining({ rule: 'footer' }))
    expect(lintSurfaceChrome({ surface: 'home', sidebar: { ...base.sidebar!, pinned: { kinds: [] } } }))
      .toContainEqual(expect.objectContaining({ rule: 'pinned-kinds' }))
    expect(lintSurfaceChrome({
      surface: 'home',
      sidebar: { ...base.sidebar!, sections: [{ ...base.sidebar!.sections[0]!, counter: { provider: 'nope', tone: 'action' } }] },
    })).toContainEqual(expect.objectContaining({ rule: 'section-counter' }))
  })
})

describe('W1-15 common row context menu (§26.1)', () => {
  it('is the spec order, with the pin pair and the trailing destructive block', () => {
    expect(COMMON_ROW_CONTEXT_MENU.map((item) => item.id)).toEqual([
      'entity.row.open', 'entity.row.open-new-tab', 'entity.row.open-split', 'entity.row.divider-1',
      'entity.row.pin', 'entity.row.unpin', 'entity.row.copy-link', 'entity.row.share-to-chat',
      'entity.row.ask-rox', 'entity.row.remind', 'entity.row.divider-2',
      'entity.row.rename', 'entity.row.archive', 'entity.row.delete',
    ])
    expect(buildRowContextMenu().map((item) => item.id)).toEqual(COMMON_ROW_CONTEXT_MENU.map((item) => item.id))
  })

  it('binds the pin toggle to X-26 and the remind item to X-16, and hides by state', () => {
    const pin = COMMON_ROW_CONTEXT_MENU.find((item) => item.id === 'entity.row.pin')!
    const unpin = COMMON_ROW_CONTEXT_MENU.find((item) => item.id === 'entity.row.unpin')!
    expect(pin.command).toBe('entities.pin')
    expect(pin.when).toBe('!pinned')
    expect(unpin.command).toBe('entities.unpin')
    expect(unpin.when).toBe('pinned')
    expect(COMMON_ROW_CONTEXT_MENU.find((item) => item.id === 'entity.row.remind')!.command).toBe('reminders.create')
  })

  it('appends surface items before the rename block and never duplicates a common id', () => {
    const menu = buildRowContextMenu([
      { id: 'tasks.row.move', titleKey: 'xfn.x18.title', command: 'goals.link_work' },
      { id: 'entity.row.open', titleKey: 'chrome.rowContext.open', hotkey: 'Space' },
    ])
    const ids = menu.map((item) => item.id)
    expect(ids.filter((id) => id === 'entity.row.open')).toHaveLength(1)
    expect(menu.find((item) => item.id === 'entity.row.open')!.hotkey).toBe('Space')
    expect(ids.indexOf('tasks.row.move')).toBeGreaterThan(ids.indexOf('entity.row.remind'))
    expect(ids.indexOf('tasks.row.move')).toBeLessThan(ids.indexOf('entity.row.divider-2'))
    expect(ids.at(-1)).toBe('entity.row.delete')
  })
})

describe('W1-15 counters (§19, §26.1)', () => {
  it('names the topic, the coalescing window and the counter queries', () => {
    expect(USER_COUNTERS_TOPIC).toBe('user.counters')
    expect(USER_COUNTERS_EVENT_TYPE).toBe('counters.changed')
    // The push rides W1-03's `user:<id>` topic, whose event catalogue carries it.
    expect(REALTIME_EVENT_TYPES.user).toContain(USER_COUNTERS_EVENT_TYPE)
    expect(isRealtimeEventType('user', USER_COUNTERS_EVENT_TYPE)).toBe(true)
    expect(USER_COUNTERS_COALESCE_MS).toBe(1000)
    expect(counterQueryName('tasks.today')).toBe('counter.tasks.today')
    expect(isCounterQueryName('counter.tasks.today')).toBe(true)
    expect(isCounterQueryName('counter')).toBe(false)
    expect(() => counterQueryName('Tasks')).toThrow()
  })

  it('maps a principal to the wire topic the counters travel on', () => {
    expect(userCountersTopic('p1')).toBe('user:p1')
    expect(() => userCountersTopic('')).toThrow()
  })

  it('caps the display at 99+ and renders nothing for a zero count', () => {
    expect(formatCounter(0)).toBe('')
    expect(formatCounter(-3)).toBe('')
    expect(formatCounter(7)).toBe('7')
    expect(formatCounter(COUNTER_DISPLAY_CAP)).toBe('99')
    expect(formatCounter(COUNTER_DISPLAY_CAP + 1)).toBe('99+')
    expect(formatCounter(1234)).toBe('99+')
    expect(formatCounter(Number.NaN)).toBe('')
  })
})

describe('W1-15 fixture i18n', () => {
  it('uses only title keys that exist in all 12 locales', () => {
    const keys = new Set<string>()
    for (const contribution of SURFACE_CHROME_FIXTURE) {
      if (contribution.sidebar) {
        keys.add(contribution.sidebar.header.titleKey)
        for (const section of contribution.sidebar.sections) if (section.titleKey) keys.add(section.titleKey)
        for (const item of contribution.sidebar.contextMenu.extra) if (item.titleKey) keys.add(item.titleKey)
      }
    }
    for (const item of COMMON_ROW_CONTEXT_MENU) if (item.titleKey) keys.add(item.titleKey)
    expect(keys.size).toBeGreaterThan(20)

    const missing: Array<{ lang: string; key: string }> = []
    for (const lang of LOCALES) {
      const strings = locale(lang)
      for (const key of keys) if (!strings[key]?.trim()) missing.push({ lang, key })
    }
    expect(missing).toEqual([])
  })
})
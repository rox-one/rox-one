/** WP6: one placement model for the pill, the sidebar and the rail. */
import { beforeEach, describe, expect, it } from 'bun:test'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import type { ModeContribution } from '@rox/core/platform'
import { resolveNavSurfaces, resolvePrimaryNav, PRIMARY_NAV } from '../primary-nav'
import { NAV_PLACEMENT_KEY, __resetNavPlacementsForTests, readNavPlacements, setNavPlacement } from '../nav-placement'
import { __resetPillCompositionForTests, visiblePillSurfaces } from '../../../platform/pill-composition'

// eslint-disable-next-line react-hooks/rules-of-hooks -- test DOM environment setup (localStorage), not a React hook
useDomForFile()

const none = new Set<string>()
const mode = (id: string, order: number): ModeContribution => ({
  id, titleKey: `workbench.mode.${id}`, icon: 'Circle', rootRoute: `/${id}`, order, defaultPinned: true, layoutProfileId: 'agent',
})
const MODES = [mode('home', 10), mode('chat', 20), mode('tasks', 40), mode('notes', 50), mode('feed', 60), mode('inbox', 70)]
const prefs = { pinned: [], excluded: [], usage: {} }
const ids = (list: { id: string }[]) => list.map(e => e.id)

beforeEach(() => {
  __resetPillCompositionForTests()
  __resetNavPlacementsForTests()
  globalThis.localStorage?.removeItem(NAV_PLACEMENT_KEY)
})

describe('sidebar placement', () => {
  it('defaults: Home lives in the pills, every other routed surface keeps its sidebar group', () => {
    const sidebar = ids(resolvePrimaryNav({ shellFlags: none }))
    expect(sidebar).not.toContain('home')
    for (const id of ['inbox', 'sessions', 'docs', 'tasks', 'projects', 'memory', 'knowledge', 'missions', 'drive', 'sources', 'settings']) {
      expect(sidebar).toContain(id)
    }
  })

  it('every routed surface is reachable somewhere (pills or sidebar) by default', () => {
    const surfaces = resolveNavSurfaces({ shellFlags: none })
    for (const entry of surfaces) expect(['pills', 'primary', 'more']).toContain(entry.placement)
    const routed = PRIMARY_NAV.filter(e => (e.route || e.action) && !e.shellFlag).map(e => e.id)
    expect(ids(surfaces).sort()).toEqual(routed.sort())
  })

  it('applies the user placement: primary / more / hidden / pills', () => {
    const placements = { memory: 'primary', inbox: 'more', tasks: 'hidden', drive: 'pills' } as const
    const nav = resolvePrimaryNav({ shellFlags: none, placements })
    const group = (id: string) => nav.find(e => e.id === id)?.group
    expect(group('memory')).toBe('primary')
    expect(group('inbox')).toBe('more')
    expect(ids(nav)).not.toContain('tasks')
    expect(ids(nav)).not.toContain('drive')
    // Compact window (no pill): pill surfaces fall back to the primary list.
    const compact = resolvePrimaryNav({ shellFlags: none, placements, pillsVisible: false })
    expect(compact.find(e => e.id === 'drive')?.group).toBe('primary')
    expect(compact.find(e => e.id === 'home')?.group).toBe('primary')
  })

  it('settings cannot be moved', () => {
    const nav = resolvePrimaryNav({ shellFlags: none, placements: { settings: 'hidden' } })
    expect(ids(nav)).toContain('settings')
  })
})

describe('pill placement', () => {
  const pill = (placements: Record<string, 'pills' | 'primary' | 'more' | 'hidden'> = {}) =>
    visiblePillSurfaces(MODES, prefs, null, { surfaces: resolveNavSurfaces({ shellFlags: none, placements }), placements })

  it('Home is an icon-only pill and leads', () => {
    const list = pill()
    expect(list[0]?.id).toBe('agent')
    expect(list[0]?.iconOnly).toBe(true)
    expect(list[0]?.titleKey).toBe('workbench.mode.home')
  })

  it('an old pill exclusion no longer hides Home', () => {
    const list = visiblePillSurfaces(MODES, { ...prefs, excluded: ['agent'] }, null, { surfaces: resolveNavSurfaces({ shellFlags: none }), placements: {} })
    expect(ids(list)).toContain('agent')
  })

  it('surfaces placed elsewhere leave the pill; pill-placed ones join it', () => {
    const list = ids(pill({ feed: 'more', home: 'hidden', tasks: 'pills', memory: 'pills' }))
    expect(list).not.toContain('feed')
    expect(list).not.toContain('agent')
    expect(list).toContain('tasks')
    expect(list).toContain('memory')
    const memory = pill({ memory: 'pills' }).find(s => s.id === 'memory')!
    expect(memory.mode?.rootRoute).toBeTruthy()
    expect(memory.isActive?.({ navigator: 'memory' } as never)).toBe(true)
  })
})

describe('placement store', () => {
  it('drops unknown values and fixed ids', () => {
    globalThis.localStorage?.setItem(NAV_PLACEMENT_KEY, JSON.stringify({ memory: 'primary', feed: 'nope', settings: 'hidden' }))
    expect(readNavPlacements()).toEqual({ memory: 'primary' })
  })

  it('setNavPlacement(null) resets to default', () => {
    setNavPlacement('memory', 'primary')
    setNavPlacement('memory', null)
    expect(readNavPlacements()).toEqual({})
  })
})

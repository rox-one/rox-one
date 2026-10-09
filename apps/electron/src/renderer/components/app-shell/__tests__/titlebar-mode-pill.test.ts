import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ModeContribution } from '@rox/core/platform'
import { resolveModePillLayout } from '../mode-pill-layout'
import {
  __resetPillCompositionForTests,
  activatePillSurface,
  visiblePillSurfaces,
} from '@/platform/pill-composition'

const metrics = { full: 520, compact: 210 }

function mode(id: string, extra: Partial<ModeContribution> = {}): ModeContribution {
  return {
    id,
    titleKey: `workbench.mode.${id}`,
    icon: 'Inbox',
    rootRoute: `/${id}`,
    order: 1,
    defaultPinned: true,
    layoutProfileId: 'agent',
    ...extra,
  }
}

/**
 * The real registry shape: the five starter composition modes are present, and
 * so are registry modes the starter set deliberately leaves to the overflow.
 */
const registry: ModeContribution[] = [
  mode('feed', { order: 1 }),
  mode('messenger', { order: 2 }),
  mode('home', { order: 3 }),
  mode('notes', { order: 4 }),
  mode('tasks', { order: 5 }),
  mode('meetings', { order: 6 }),
  mode('inbox', { order: 7 }),
]

describe('titlebar mode pill layout', () => {
  it('keeps labels when both sides have room', () => {
    const layout = resolveModePillLayout({ topbarWidth: 1600, leftInset: 0, leftFixedEdge: 120, rightWidth: 260, metrics })
    expect(layout.collapsed).toBe(false)
    expect(layout.leftMax).toBe(1600 / 2 - 520 / 2 - 12)
  })

  it('collapses to icons when the labelled pill would hit a side group', () => {
    const layout = resolveModePillLayout({ topbarWidth: 1000, leftInset: 0, leftFixedEdge: 120, rightWidth: 260, metrics })
    expect(layout.collapsed).toBe(true)
    expect(layout.leftMax).toBe(500 - 105 - 12)
  })

  it('centers on the window, compensating for the left rail inset', () => {
    const layout = resolveModePillLayout({ topbarWidth: 1552, leftInset: 48, leftFixedEdge: 120, rightWidth: 260, metrics })
    // Window center is 800px; relative to the titlebar that is 752px.
    expect(layout.leftMax).toBe(752 - 260 - 12)
    expect(layout.rightMax).toBe(1552 - 752 - 260 - 12)
  })

  it('reserves a gap around the compact pill even when browser tabs exceed their available width', () => {
    const layout = resolveModePillLayout({ topbarWidth: 800, leftInset: 0, leftFixedEdge: 120, rightWidth: 700, metrics })
    expect(layout.collapsed).toBe(true)
    expect(layout.leftMax).toBe(283)
    expect(layout.rightMax).toBe(283)
    expect(layout.leftMax + metrics.compact + layout.rightMax).toBe(800 - 24)
  })
})

describe('titlebar mode pill composition', () => {
  // The composition freezes a per-session usage snapshot at module scope.
  beforeEach(() => { __resetPillCompositionForTests() })
  afterEach(() => { __resetPillCompositionForTests() })

  it('lists the declared starter surfaces instead of every default-pinned registry mode', () => {
    // Catches: pill membership falling back to a hardcoded/registry mode list
    // (tasks/meetings/inbox would reappear) instead of the composition module.
    const ids = visiblePillSurfaces(registry, { pinned: [], excluded: [], usage: {} }).map((surface) => surface.id)
    expect(ids).toEqual(['feed', 'team', 'agent', 'notes', 'browser'])
  })

  it('drops a composition surface whose registry mode is not navigable', () => {
    // Catches: the pill rendering a mode entry that has no navigable root route.
    const disabled = registry.map((entry) => (entry.id === 'notes' ? mode('notes', { rootRoute: null }) : entry))
    const ids = visiblePillSurfaces(disabled, { pinned: [], excluded: [], usage: {} }).map((surface) => surface.id)
    expect(ids).not.toContain('notes')
    expect(ids).toContain('feed')
  })

  it('puts explicit pins first and drops excluded surfaces, never emptying the pill', () => {
    // Catches: pin/exclude ordering regressions in the composition.
    const pinned = visiblePillSurfaces(registry, { pinned: ['notes'], excluded: [], usage: {} })
    expect(pinned[0]?.id).toBe('notes')

    const excluded = visiblePillSurfaces(registry, { pinned: [], excluded: ['feed', 'team'], usage: {} })
      .map((surface) => surface.id)
    expect(excluded).not.toContain('feed')
    expect(excluded).not.toContain('team')

    const allExcluded = visiblePillSurfaces(registry, {
      pinned: [],
      excluded: ['feed', 'team', 'agent', 'notes', 'browser'],
      usage: {},
    })
    expect(allExcluded.length).toBeGreaterThan(0)
  })

  it('freezes the frequency order for the session so the pill never jumps', () => {
    // Catches: a live usage counter reordering the visible pill mid-session.
    const first = visiblePillSurfaces(registry, { pinned: [], excluded: [], usage: { browser: 5 } })
      .map((surface) => surface.id)
    const second = visiblePillSurfaces(registry, { pinned: [], excluded: [], usage: { browser: 0, feed: 99 } })
      .map((surface) => surface.id)
    expect(first[0]).toBe('browser')
    expect(second).toEqual(first)
  })

  it('activates a mode surface through its root route and the browser panel through the host opener', () => {
    // Catches: activatePillSurface dropping the navigate/openBrowser side effect.
    const navigations: string[] = []
    let opened = 0
    const surfaces = visiblePillSurfaces(registry, { pinned: [], excluded: [], usage: {} })
    const feed = surfaces.find((surface) => surface.id === 'feed')!
    const browser = surfaces.find((surface) => surface.id === 'browser')!
    const deps = { navigate: (route: string) => { navigations.push(route) }, openBrowser: () => { opened += 1 } }

    activatePillSurface(feed, deps)
    activatePillSurface(browser, deps)

    expect(navigations).toEqual(['/feed'])
    expect(opened).toBe(1)
  })
})
import { describe, expect, it, beforeEach } from 'bun:test'
import type { ModeContribution } from '@rox/core/platform'
import {
  DEFAULT_PILL_SURFACES,
  PILL_BROWSER_SURFACE_ID,
  __resetPillCompositionForTests,
  frequencyOrder,
  orderPillSurfaces,
  pillOverflowModes,
  pillSurfaceForSlot,
  resetPillSessionUsage,
  resolvePillSurfaces,
  visiblePillSurfaces,
  type PillPreferences,
  type ResolvedPillSurface,
} from '../pill-composition'

const mode = (id: string, order: number, over: Partial<ModeContribution> = {}): ModeContribution => ({
  id,
  titleKey: `workbench.mode.${id}`,
  icon: 'Circle',
  rootRoute: `/${id}`,
  order,
  defaultPinned: true,
  layoutProfileId: 'agent',
  ...over,
})

const MODES: readonly ModeContribution[] = [
  mode('home', 10),
  mode('chat', 20),
  mode('meetings', 30),
  mode('tasks', 40),
  mode('notes', 50),
  mode('feed', 60),
  mode('inbox', 70),
]

const prefs = (over: Partial<PillPreferences> = {}): PillPreferences => ({
  pinned: [],
  excluded: [],
  usage: {},
  ...over,
})

beforeEach(() => {
  __resetPillCompositionForTests()
})

describe('DEFAULT_PILL_SURFACES', () => {
  it('declares the documented starter order', () => {
    expect(DEFAULT_PILL_SURFACES.map((s) => s.id)).toEqual(['feed', 'team', 'agent', 'notes', 'browser'])
  })
})

describe('resolvePillSurfaces', () => {
  it('keeps the composition order and appends the browser panel', () => {
    const resolved = resolvePillSurfaces(DEFAULT_PILL_SURFACES, MODES)
    expect(resolved.map((s) => s.id)).toEqual(['feed', 'team', 'agent', 'notes', 'browser'])
    expect(resolved.at(-1)).toMatchObject({ kind: 'panel', mode: null })
  })

  it('maps Команда to messenger and falls back to chat when messenger is absent', () => {
    const withMessenger = resolvePillSurfaces(DEFAULT_PILL_SURFACES, [
      ...MODES,
      mode('messenger', 25),
    ])
    expect(withMessenger.find((s) => s.id === 'team')?.mode?.id).toBe('messenger')
    expect(resolvePillSurfaces(DEFAULT_PILL_SURFACES, MODES).find((s) => s.id === 'team')?.mode?.id).toBe('chat')
  })

  it('drops a mode surface when neither mode nor fallback is navigable', () => {
    const modes = MODES.filter((m) => m.id !== 'chat').concat(mode('messenger', 25, { rootRoute: null }))
    const ids = resolvePillSurfaces(DEFAULT_PILL_SURFACES, modes).map((s) => s.id)
    expect(ids).not.toContain('team')
  })

  it('appends user-pinned modes that are not part of the composition, in registry order', () => {
    const resolved = resolvePillSurfaces(DEFAULT_PILL_SURFACES, MODES, ['inbox', 'meetings'])
    expect(resolved.map((s) => s.id)).toEqual(['feed', 'team', 'agent', 'notes', 'browser', 'meetings', 'inbox'])
  })

  it('ignores pinned ids that are unavailable', () => {
    const resolved = resolvePillSurfaces(DEFAULT_PILL_SURFACES, MODES, ['ghost'])
    expect(resolved.map((s) => s.id)).toEqual(['feed', 'team', 'agent', 'notes', 'browser'])
  })
})

describe('pillOverflowModes', () => {
  it('returns navigable modes the pill does not represent', () => {
    const ids = pillOverflowModes(DEFAULT_PILL_SURFACES, MODES).map((m) => m.id)
    expect(ids).toEqual(['meetings', 'tasks', 'inbox'])
  })

  it('excludes the messenger fallback as well', () => {
    const ids = pillOverflowModes(DEFAULT_PILL_SURFACES, [...MODES, mode('messenger', 25)]).map((m) => m.id)
    expect(ids).not.toContain('chat')
    expect(ids).not.toContain('messenger')
  })
})

describe('frequencyOrder', () => {
  it('sorts by descending usage, ties keeping the incoming order', () => {
    expect(frequencyOrder(['a', 'b', 'c', 'd'], { b: 3, c: 1, d: 3 })).toEqual(['b', 'd', 'c', 'a'])
  })
})

describe('orderPillSurfaces', () => {
  const surfaces: ResolvedPillSurface[] = resolvePillSurfaces(DEFAULT_PILL_SURFACES, MODES)

  it('is the identity with no pins, exclusions or usage', () => {
    expect(orderPillSurfaces(surfaces, prefs(), {}).map((s) => s.id)).toEqual([
      'feed',
      'team',
      'agent',
      'notes',
      'browser',
    ])
  })

  it('puts explicit pins first in pinned order', () => {
    const ordered = orderPillSurfaces(surfaces, prefs({ pinned: ['browser', 'notes'] }), {})
    expect(ordered.slice(0, 2).map((s) => s.id)).toEqual(['browser', 'notes'])
  })

  it('sorts the rest by usage', () => {
    const ordered = orderPillSurfaces(surfaces, prefs(), { agent: 5, notes: 2 })
    expect(ordered.slice(0, 2).map((s) => s.id)).toEqual(['agent', 'notes'])
  })

  it('drops excluded surfaces but never empties the pill', () => {
    expect(orderPillSurfaces(surfaces, prefs({ excluded: ['notes'] }), {}).map((s) => s.id)).not.toContain('notes')
    const all = orderPillSurfaces(surfaces, prefs({ excluded: surfaces.map((s) => s.id) }), {})
    expect(all).toHaveLength(surfaces.length)
  })
})

describe('visiblePillSurfaces', () => {
  it('freezes the frequency order for the session', () => {
    const first = visiblePillSurfaces(MODES, prefs({ usage: { notes: 9 } }))
    expect(first[0]?.id).toBe('notes')
    // A later, larger count this session must not reorder the frozen snapshot.
    const second = visiblePillSurfaces(MODES, prefs({ usage: { notes: 9, agent: 99 } }))
    expect(second.map((s) => s.id)).toEqual(first.map((s) => s.id))
  })

  it('rebuilds the frozen order after a workspace switch drops the snapshot', () => {
    const first = visiblePillSurfaces(MODES, prefs({ usage: { notes: 9 } }))
    expect(first[0]?.id).toBe('notes')
    resetPillSessionUsage()
    const afterSwitch = visiblePillSurfaces(MODES, prefs({ usage: { notes: 9, agent: 99 } }))
    expect(afterSwitch[0]?.id).toBe('agent')
  })
})

describe('pillSurfaceForSlot', () => {
  it('maps 1-based slots to the visible order, null past the end', () => {
    const surfaces = resolvePillSurfaces(DEFAULT_PILL_SURFACES, MODES)
    expect(pillSurfaceForSlot(surfaces, 1)?.id).toBe('feed')
    expect(pillSurfaceForSlot(surfaces, 5)?.id).toBe(PILL_BROWSER_SURFACE_ID)
    expect(pillSurfaceForSlot(surfaces, 6)).toBeNull()
  })
})
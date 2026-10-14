/** Contextual sidebar: registry, «Все экраны» reachability, «Недавнее» / «Закреплённое». */
import { describe, expect, it } from 'bun:test'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { PRIMARY_NAV, resolvePrimaryNav, BASE_SURFACE_FLAG, WIKI_SURFACE_FLAG } from '../primary-nav'
import { resolveCurrentSurface, selectRecentPinned, sidebarContentKind, SIDEBAR_CONTENT_KIND, RECENT_LIMIT } from '../sidebar-registry'
import { buildAllScreensGroups, matchesScreenQuery } from '../../../platform/all-screens-model'
import { EXTRA_SCREENS } from '../../../pages/extra-screens/registry'

const t = (key: string) => key
const ALL_FLAGS = new Set<string>([
  WORKBENCH_FLAG.modeMessengerV1, WORKBENCH_FLAG.modeCalendarV1, WORKBENCH_FLAG.modeGoalsV1,
  WORKBENCH_FLAG.devSpaceV1, WORKBENCH_FLAG.playbooksV1, BASE_SURFACE_FLAG, WIKI_SURFACE_FLAG,
])

describe('sidebar registry', () => {
  it('declares the moved navigations and falls back for the rest', () => {
    expect(sidebarContentKind('sessions')).toBe('sessions')
    for (const id of ['projects', 'pages', 'sources', 'automations']) expect(sidebarContentKind(id)).toBe('context')
    for (const id of ['feed', 'inbox', 'tasks', 'docs', 'connections', 'settings']) expect(sidebarContentKind(id)).toBe('portal')
    for (const id of ['home', 'skills', 'clipboardHistory', 'missions', 'knowledge', 'drive', null]) expect(sidebarContentKind(id)).toBe('fallback')
  })

  it('only names registry surfaces', () => {
    const known = new Set(PRIMARY_NAV.map(entry => entry.id))
    for (const id of Object.keys(SIDEBAR_CONTENT_KIND)) expect(known.has(id)).toBe(true)
  })

  it('resolves the current surface from navigation state', () => {
    expect(resolveCurrentSurface({ navigator: 'sources' } as never).id).toBe('sources')
    expect(resolveCurrentSurface({ navigator: 'home' } as never).id).toBe('home')
    const screen = resolveCurrentSurface({ navigator: 'screen', screen: EXTRA_SCREENS[0]!.id } as never)
    expect(screen.id).toBe(`screen:${EXTRA_SCREENS[0]!.id}`)
    expect(screen.kind).toBe('fallback')
    expect(resolveCurrentSurface({ navigator: 'nowhere' } as never)).toMatchObject({ id: null, kind: 'fallback' })
  })

  it('never picks the browser (a panel, not a screen)', () => {
    const browserOnly = PRIMARY_NAV.filter(entry => entry.id === 'browser').map(entry => ({ ...entry, isActive: () => true }))
    expect(resolveCurrentSurface({ navigator: 'home' } as never, browserOnly).id).toBeNull()
  })
})

describe('«Все экраны»: every non-hidden surface stays reachable', () => {
  for (const [name, flags] of [['default flags', new Set<string>()], ['all flags', ALL_FLAGS]] as const) {
    it(`${name}: each routed surface (pills or menu) appears exactly once`, () => {
      const surfaces = resolvePrimaryNav({ shellFlags: flags })
      const groups = buildAllScreensGroups({ surfaces, extraScreens: EXTRA_SCREENS, t })
      const listed = groups.flatMap(group => group.items.map(item => item.id))
      expect(new Set(listed).size).toBe(listed.length)
      for (const entry of surfaces) expect(listed).toContain(entry.id)
      for (const extra of EXTRA_SCREENS) expect(listed).toContain(`screen:${extra.id}`)
      expect(groups.map(group => group.id)).toEqual(['navigation', 'tools', 'experimental'])
    })
  }

  it('pill-placed surfaces are marked; hidden ones are absent', () => {
    const surfaces = resolvePrimaryNav({ shellFlags: new Set(), placements: { inbox: 'hidden', tasks: 'pills' } })
    const items = buildAllScreensGroups({ surfaces, extraScreens: [], t }).flatMap(group => group.items)
    expect(items.find(item => item.id === 'inbox')).toBeUndefined()
    expect(items.find(item => item.id === 'tasks')?.inPills).toBe(true)
    expect(items.find(item => item.id === 'memory')?.inPills).toBe(false)
  })

  it('search filters by title, case- and accent-insensitive, and drops empty groups', () => {
    const tr = (key: string) => (key === 'sidebar.memory' ? 'Память' : key === 'sidebar.skills' ? 'Navégation' : key)
    const surfaces = resolvePrimaryNav({ shellFlags: new Set() })
    const groups = buildAllScreensGroups({ surfaces, extraScreens: EXTRA_SCREENS, t: tr, query: 'пАм' })
    expect(groups.flatMap(group => group.items.map(item => item.id))).toEqual(['memory'])
    expect(groups.map(group => group.id)).toEqual(['tools'])
    expect(matchesScreenQuery({ id: 'skills', title: 'Navégation' }, 'navega')).toBe(true)
    expect(buildAllScreensGroups({ surfaces, extraScreens: [], t, query: 'zzz-nothing' })).toEqual([])
  })
})

describe('«Недавнее» / «Закреплённое»', () => {
  const s = (id: string, at: number, over: Record<string, unknown> = {}) => ({ id, workspaceId: 'w', lastMessageAt: at, ...over })
  it('recent = newest first, archived/hidden/other workspaces excluded; pinned = flagged, not repeated', () => {
    const { recent, pinned } = selectRecentPinned([
      s('old', 1), s('new', 5), s('flag', 3, { isFlagged: true }), s('arch', 9, { isArchived: true }),
      s('hid', 8, { hidden: true }), s('elsewhere', 7, { workspaceId: 'x' }), s('created', 0, { lastMessageAt: undefined, createdAt: 4 }),
    ], new Set(['w']))
    expect(recent.map(x => x.id)).toEqual(['new', 'created', 'old'])
    expect(pinned.map(x => x.id)).toEqual(['flag'])
  })

  it('caps the recent list and ignores scope when none is given', () => {
    const many = Array.from({ length: 20 }, (_, i) => s(`s${i}`, i, { workspaceId: i % 2 ? 'a' : 'b' }))
    const { recent } = selectRecentPinned(many, null)
    expect(recent).toHaveLength(RECENT_LIMIT)
    expect(recent[0]!.id).toBe('s19')
  })
})

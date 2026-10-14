/**
 * Memory repository rail destination (spec §8).
 *
 * The repository tab owns its own rail item and must never light up together
 * with the lessons «Память» item.
 *
 * These are behavioural checks, not source-text pins: real route strings go
 * through the app's own parser (`parseRouteToNavigationState`) and the exported
 * nav registries' `isActive` predicates — the very predicates the workbench
 * rail (`ActivityRail` ← `APP_NAV_DESTINATIONS`) and the classic sidebar
 * (`ShellSidebarNav` ← `PRIMARY_NAV`) render their highlight from.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAV_DESTINATIONS, APP_NAV_DESTINATIONS_BY_ID } from '../nav-destinations'
import { PRIMARY_NAV } from '../primary-nav'
import { parseRouteToNavigationState } from '../../../../shared/route-parser'
import { routes } from '../../../../shared/routes'

const mainContentSource = readFileSync(join(__dirname, '../MainContentPanel.tsx'), 'utf8')

/** Parse a route the way `navigate()`/deep links do; fail loudly on a dead route. */
const parse = (route: string) => {
  const state = parseRouteToNavigationState(route)
  if (!state) throw new Error(`route did not parse to a nav state: ${route}`)
  return state
}

/** The repository tab — the route family `nav:memoryRepo` must own. */
const REPO_STATES = [
  'memory/repo',
  'memory/repo/commit/9f8e7d6',
  `memory/repo/file/${encodeURIComponent('lessons/a.md')}`,
].map(parse)

/** The lessons «Память» tab — the bare memory route plus the dream surface. */
const LESSONS_STATES = ['memory', 'memory/dream'].map(parse)

/** Surfaces that are not memory at all: neither entry may light up. */
const NON_MEMORY_STATES = ['notes', 'settings', 'tasks', 'inbox'].map(parse)

const ALL_STATES = [...REPO_STATES, ...LESSONS_STATES, ...NON_MEMORY_STATES]

describe('Memory repository nav and surface', () => {
  it('registers a memoryRepo destination in the More rail group', () => {
    const dest = APP_NAV_DESTINATIONS.find((entry) => entry.id === 'memoryRepo')
    expect(dest).toBeDefined()
    expect(dest?.railGroup).toBe('more')
    expect(dest?.labelKey).toBe('sidebar.memoryRepo')
    expect(dest?.route?.()).toBe(routes.view.memory('repo'))
    expect(dest?.disabledTooltipKey).toBeUndefined()
  })

  it('keeps the five primary services unchanged', () => {
    expect(APP_NAV_DESTINATIONS.filter((entry) => entry.railGroup === 'primary').map((entry) => entry.id))
      .toEqual(['sessions', 'notes', 'memory', 'browser', 'automations'])
  })

  it('activates memoryRepo only on the repository tab', () => {
    const memory = APP_NAV_DESTINATIONS.find((entry) => entry.id === 'memory')!
    const memoryRepo = APP_NAV_DESTINATIONS.find((entry) => entry.id === 'memoryRepo')!

    const repo = parseRouteToNavigationState('memory/repo')!
    const repoCommit = parseRouteToNavigationState('memory/repo/commit/9f8e7d6')!
    const repoFile = parseRouteToNavigationState(`memory/repo/file/${encodeURIComponent('lessons/a.md')}`)!
    const lessons = parseRouteToNavigationState('memory')!
    const dream = parseRouteToNavigationState('memory/dream')!

    for (const state of [repo, repoCommit, repoFile]) {
      expect(memoryRepo.isActive(state)).toBe(true)
      expect(memory.isActive(state)).toBe(false)
    }
    for (const state of [lessons, dream]) {
      expect(memory.isActive(state)).toBe(true)
      expect(memoryRepo.isActive(state)).toBe(false)
    }
  })

  it('wires the repository screen into MainContentPanel', () => {
    expect(mainContentSource).toContain('isMemoryNavigation')
    expect(mainContentSource).toContain('MemoryRepoScreen')
    expect(mainContentSource).toContain("navState.tab === 'repo'")
    expect(mainContentSource).toContain("navState.tab === 'dream'")
  })

  it('gives the repository tab its own sidebar row identity, distinct from the lessons entry', () => {
    // The AppShell sidebar row is keyed by `linkId`: `ShellSidebarNav` resolves
    // the rich row AppShell supplies for that id, and falls back to the
    // registry row otherwise. So the repository tab must own its own link id,
    // glyph and label — a shared id or glyph would collapse the two rows.
    const memory = APP_NAV_DESTINATIONS_BY_ID.memory
    const memoryRepo = APP_NAV_DESTINATIONS_BY_ID.memoryRepo

    expect(memoryRepo.linkId).toBe('nav:memoryRepo')
    expect(memory.linkId).toBe('nav:memory')

    expect(memoryRepo.icon).not.toBe(memory.icon)
    expect(memoryRepo.labelKey).not.toBe(memory.labelKey)

    // Each row navigates to its own surface (the sidebar's click helper
    // resolves the destination route through `APP_NAV_DESTINATIONS_BY_ID`).
    expect(memoryRepo.route?.()).toBe(routes.view.memory('repo'))
    expect(memory.route?.()).toBe(routes.view.memory())
  })

  it('keeps the two memory entries mutually exclusive on every route', () => {
    // The workbench rail (`APP_NAV_DESTINATIONS`) and the classic sidebar
    // (`PRIMARY_NAV`) each carry their own copy of the split; drive the real
    // nav states through both and prove exactly one (or neither) lights up.
    const registries = [
      { memory: APP_NAV_DESTINATIONS_BY_ID.memory, memoryRepo: APP_NAV_DESTINATIONS_BY_ID.memoryRepo },
      {
        memory: PRIMARY_NAV.find((entry) => entry.id === 'memory')!,
        memoryRepo: PRIMARY_NAV.find((entry) => entry.id === 'memoryRepo')!,
      },
    ]

    for (const { memory, memoryRepo } of registries) {
      for (const state of REPO_STATES) {
        expect(memoryRepo.isActive(state)).toBe(true)
        expect(memory.isActive(state)).toBe(false)
      }
      for (const state of LESSONS_STATES) {
        expect(memory.isActive(state)).toBe(true)
        expect(memoryRepo.isActive(state)).toBe(false)
      }
      for (const state of NON_MEMORY_STATES) {
        expect(memory.isActive(state)).toBe(false)
        expect(memoryRepo.isActive(state)).toBe(false)
      }
      // The invariant the two rows rely on: they can never both light up.
      for (const state of ALL_STATES) {
        expect(memory.isActive(state) && memoryRepo.isActive(state)).toBe(false)
      }
    }
  })
})

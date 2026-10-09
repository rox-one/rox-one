/**
 * Memory repository rail destination (spec §8).
 *
 * The repository tab owns its own rail item and must never light up together
 * with the lessons «Память» item.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAV_DESTINATIONS } from '../nav-destinations'
import { parseRouteToNavigationState } from '../../../../shared/route-parser'
import { routes } from '../../../../shared/routes'

const mainContentSource = readFileSync(join(__dirname, '../MainContentPanel.tsx'), 'utf8')
const appShellSource = readFileSync(join(__dirname, '../AppShell.tsx'), 'utf8')

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

  it('renders a nav:memoryRepo entry in the classic AppShell sidebar', () => {
    // The AppShell sidebar is a hand-maintained list, not a map over
    // APP_NAV_DESTINATIONS — the entry has to exist here to be visible.
    expect(appShellSource).toContain('id: "nav:memoryRepo"')
    expect(appShellSource).toContain('APP_NAV_DESTINATIONS_BY_ID.memoryRepo.icon')
    expect(appShellSource).toContain('APP_NAV_DESTINATIONS_BY_ID.memoryRepo.labelKey')
    // Same click helper pattern as the «Память» entry → resolves to
    // routes.view.memory('repo') through APP_NAV_DESTINATIONS_BY_ID.
    expect(appShellSource).toContain("handleServiceClick('memoryRepo')")
    expect(APP_NAV_DESTINATIONS.find((entry) => entry.id === 'memoryRepo')?.route?.())
      .toBe(routes.view.memory('repo'))
  })

  it('keeps the AppShell memory entries mutually exclusive', () => {
    // Each sidebar variant reads `isMemoryNavigation(navState)` and then splits
    // on the repo tab, so the two entries can never both be highlighted.
    expect(appShellSource).toContain(
      'isMemoryNavigation(navState) && navState.tab !== \'repo\' ? "default" : "ghost"',
    )
    expect(appShellSource).toContain(
      'isMemoryNavigation(navState) && navState.tab === \'repo\' ? "default" : "ghost"',
    )
  })
})
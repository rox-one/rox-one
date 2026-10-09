/**
 * Memory repository route round-trips (spec §8).
 *
 * Covers the four new route shapes added by the repository/dreaming wave:
 * memory/repo, memory/repo/file/<enc>, memory/repo/commit/<sha> and
 * memory/dream — parse → navigation state → route must be stable, and the
 * panel key helpers must round-trip the same state.
 */
import { describe, test, expect } from 'bun:test'
import {
  isCompoundRoute,
  parseCompoundRoute,
  parseRouteToNavigationState,
  resolveViewRoute,
  buildRouteFromNavigationState,
} from '../route-parser'
import {
  getNavigationStateKey,
  parseNavigationStateKey,
  isMemoryNavigation,
} from '../types'
import { routes } from '../routes'

const FILE_PATH = 'lessons/workflow/abc123--p44.md'
const ENCODED_FILE = encodeURIComponent(FILE_PATH)
const SHA = '9f8e7d6a1b2c3d4e5f60718293a4b5c6d7e8f901'

describe('memory routes', () => {
  test('route builders emit the memory prefix and tab segments', () => {
    expect(routes.view.memory()).toBe('memory')
    expect(routes.view.memory('lessons')).toBe('memory')
    expect(routes.view.memory('repo')).toBe('memory/repo')
    expect(routes.view.memory('repo', { type: 'file', path: FILE_PATH })).toBe(`memory/repo/file/${ENCODED_FILE}`)
    expect(routes.view.memory('repo', { type: 'commit', sha: SHA })).toBe(`memory/repo/commit/${SHA}`)
    expect(routes.view.memory('dream')).toBe('memory/dream')
  })

  test('memory surfaces are compound route prefixes', () => {
    expect(isCompoundRoute('memory')).toBe(true)
    expect(isCompoundRoute('memory/repo')).toBe(true)
    expect(isCompoundRoute(`memory/repo/file/${ENCODED_FILE}`)).toBe(true)
    expect(isCompoundRoute('memory/dream')).toBe(true)
  })

  test('parses bare and repository routes', () => {
    expect(parseCompoundRoute('memory')).toEqual({ navigator: 'memory', details: null })

    const repo = parseRouteToNavigationState('memory/repo')
    expect(repo).toEqual({ navigator: 'memory', tab: 'repo', details: null })
    expect(repo && isMemoryNavigation(repo)).toBe(true)

    const dream = parseRouteToNavigationState('memory/dream')
    expect(dream).toEqual({ navigator: 'memory', tab: 'dream', details: null })

    const file = parseRouteToNavigationState(`memory/repo/file/${ENCODED_FILE}`)
    expect(file).toEqual({ navigator: 'memory', tab: 'repo', details: { type: 'file', path: FILE_PATH } })

    const commit = parseRouteToNavigationState(`memory/repo/commit/${SHA}`)
    expect(commit).toEqual({ navigator: 'memory', tab: 'repo', details: { type: 'commit', sha: SHA } })
  })

  test('rejects malformed repository routes', () => {
    expect(parseCompoundRoute('memory/repo/file')).toBeNull()
    expect(parseCompoundRoute('memory/repo/commit')).toBeNull()
    expect(parseCompoundRoute('memory/unknown')).toBeNull()
    expect(parseCompoundRoute('memory/dream/extra')).toBeNull()
  })

  test('round-trips navigation state for every new route shape', () => {
    const shapes: Array<{ route: string; state: { navigator: 'memory'; tab?: 'repo' | 'dream'; details: { type: 'file'; path: string } | { type: 'commit'; sha: string } | null } }> = [
      { route: 'memory/repo', state: { navigator: 'memory', tab: 'repo', details: null } },
      { route: `memory/repo/file/${ENCODED_FILE}`, state: { navigator: 'memory', tab: 'repo', details: { type: 'file', path: FILE_PATH } } },
      { route: `memory/repo/commit/${SHA}`, state: { navigator: 'memory', tab: 'repo', details: { type: 'commit', sha: SHA } } },
      { route: 'memory/dream', state: { navigator: 'memory', tab: 'dream', details: null } },
    ]

    for (const { route, state } of shapes) {
      const parsed = parseRouteToNavigationState(route)
      expect(parsed).toEqual(state)
      expect(buildRouteFromNavigationState(parsed!)).toBe(route)
      expect(getNavigationStateKey(parsed!)).toBe(route)
      expect(parseNavigationStateKey(route)).toEqual(state)
      // The canonical address must survive the mounted runtime boundary.
      expect(resolveViewRoute(route)).toEqual(state)
    }
  })

  test('bare memory round-trips as the lessons surface', () => {
    const state = { navigator: 'memory' as const, details: null }
    expect(buildRouteFromNavigationState(state)).toBe('memory')
    expect(getNavigationStateKey(state)).toBe('memory')
    expect(parseNavigationStateKey('memory')).toEqual(state)
  })
})
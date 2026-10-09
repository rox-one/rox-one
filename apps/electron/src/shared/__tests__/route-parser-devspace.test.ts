/**
 * Developer Space / Playbooks route round-trips (2026-10-09 pack, D2/D12).
 */
import { describe, expect, test } from 'bun:test'
import { routes } from '../routes'
import {
  isCompoundRoute,
  parseCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
  resolveViewRoute,
} from '../route-parser'
import {
  getNavigationStateKey,
  parseNavigationStateKey,
  isDevelopersNavigation,
  isPlaybooksNavigation,
} from '../types'

describe('developers / playbooks routes', () => {
  test('route builders emit the destination prefixes', () => {
    expect(routes.view.developers()).toBe('developers')
    expect(routes.view.developers('repo-1')).toBe('developers?repo=repo-1')
    expect(routes.view.playbooks()).toBe('playbooks')
  })

  test('both are compound route prefixes', () => {
    expect(isCompoundRoute('developers')).toBe(true)
    expect(isCompoundRoute('developers?repo=repo-1')).toBe(true)
    expect(isCompoundRoute('playbooks')).toBe(true)
  })

  test('parses the bare developers route', () => {
    expect(parseCompoundRoute('developers')).toEqual({ navigator: 'developers', details: null })
    const state = parseRouteToNavigationState('developers')
    expect(state).toEqual({ navigator: 'developers', details: null })
    expect(state && isDevelopersNavigation(state)).toBe(true)
  })

  test('parses the repo deep-link parameter into devSpaceRepoId', () => {
    expect(parseCompoundRoute('developers?repo=repo-1')).toEqual({
      navigator: 'developers',
      devSpaceRepoId: 'repo-1',
      details: null,
    })
    expect(parseRouteToNavigationState('developers?repo=repo-1')).toEqual({
      navigator: 'developers',
      devSpaceRepoId: 'repo-1',
      details: null,
    })
    expect(resolveViewRoute('developers?repo=repo-1')).toEqual({
      navigator: 'developers',
      devSpaceRepoId: 'repo-1',
      details: null,
    })
  })

  test('parses the playbooks route', () => {
    expect(parseCompoundRoute('playbooks')).toEqual({ navigator: 'playbooks', details: null })
    const state = parseRouteToNavigationState('playbooks')
    expect(state).toEqual({ navigator: 'playbooks', details: null })
    expect(state && isPlaybooksNavigation(state)).toBe(true)
  })

  test('rejects unsupported developers sub-paths', () => {
    expect(parseRouteToNavigationState('developers/extra')).not.toEqual({
      navigator: 'developers',
      details: null,
    })
  })

  test('round-trips navigation state and panel keys', () => {
    const bare = { navigator: 'developers' as const, details: null }
    expect(buildRouteFromNavigationState(bare)).toBe('developers')
    expect(getNavigationStateKey(bare)).toBe('developers')
    expect(parseNavigationStateKey('developers')).toEqual(bare)

    const focused = { navigator: 'developers' as const, devSpaceRepoId: 'repo-1', details: null }
    expect(buildRouteFromNavigationState(focused)).toBe('developers?repo=repo-1')
    expect(getNavigationStateKey(focused)).toBe('developers?repo=repo-1')
    expect(parseNavigationStateKey('developers?repo=repo-1')).toEqual(focused)

    const playbooks = { navigator: 'playbooks' as const, details: null }
    expect(buildRouteFromNavigationState(playbooks)).toBe('playbooks')
    expect(getNavigationStateKey(playbooks)).toBe('playbooks')
    expect(parseNavigationStateKey('playbooks')).toEqual(playbooks)
  })
})
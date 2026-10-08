/**
 * Persisted tabs/history restore `entity/...` states only while
 * `entities.links.v1` is on; when off they return null/unavailable exactly
 * like the main-process deep-link parser.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  parseCompoundRoute,
  parseRouteToNavigationState,
  resetEntityRoutesEnabled,
  resolveRouteNavigationState,
  setEntityRoutesEnabled,
} from '../route-parser'
import { parseNavigationStateKey } from '../types'

describe('entity persisted-state gate', () => {
  beforeEach(() => resetEntityRoutesEnabled())
  afterEach(() => resetEntityRoutesEnabled())

  test('flag off restores nothing for entity keys', () => {
    setEntityRoutesEnabled(false)
    expect(parseNavigationStateKey('entity/goals/goal/g-1')).toBeNull()
    expect(parseNavigationStateKey('entity/docs/file/f-1')).toBeNull()
    expect(parseRouteToNavigationState('goals/goal/g-1')).toBeNull()
    expect(parseCompoundRoute('goals/goal/g-1')).toBeNull()
    expect(resolveRouteNavigationState('goals/goal/g-1')).toEqual({
      navigator: 'unavailable',
      route: 'goals/goal/g-1',
      details: null,
    })
  })

  test('flag on restores entity keys', () => {
    setEntityRoutesEnabled(true)
    expect(parseNavigationStateKey('entity/goals/goal/g-1')).toEqual({
      navigator: 'entity',
      route: 'goals/goal/g-1',
      ref: { kind: 'goal', id: 'g-1' },
      details: null,
    })
    expect(parseRouteToNavigationState('goals/goal/g-1')?.navigator).toBe('entity')
  })

  test('non-entity persisted keys are unaffected by the flag', () => {
    setEntityRoutesEnabled(false)
    expect(parseNavigationStateKey('tasks/task/t-1')?.navigator).toBe('tasks')
    expect(parseNavigationStateKey('home')?.navigator).toBe('home')
  })
})

/**
 * Product decision: entity routes are gated behind `entities.links.v1`.
 * With the flag off, `rox://goals/goal/x`, `rox://docs/file/x` etc. are
 * rejected exactly as on main; with the flag on they parse to `entity`.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  isCompoundRoute,
  isCompoundRoutePrefix,
  isEntityRoutesEnabled,
  parseCompoundRoute,
  parseRouteToNavigationState,
  resetEntityRoutesEnabled,
  resolveRouteNavigationState,
  setEntityRoutesEnabled,
} from '../route-parser'

const ENTITY_ROUTES = ['goals/goal/g-1', 'docs/file/f-1', 'messenger/c-1', 'calendar/event/e-1', 'contacts/person/p-1', 'workflows/wf-1', 'base/b-1', 'forms/fm-1', 'comments/cm-1']

const ENTITY_PREFIXES = ['docs', 'messenger', 'calendar', 'goals', 'contacts', 'workflows', 'base', 'forms', 'comments']

const BASE_ROUTES: Array<[string, boolean]> = [
  ['tasks', true],
  ['tasks/task/t-1', true],
  ['notes/note/n-1', true],
  ['settings/shortcuts', true],
  ['home', true],
  ['allSessions', true],
]

describe('entity routes flag gate', () => {
  beforeEach(() => resetEntityRoutesEnabled())
  afterEach(() => resetEntityRoutesEnabled())

  test('flag off by default (inert)', () => {
    expect(isEntityRoutesEnabled()).toBe(false)
  })

  test('flag off rejects entity routes exactly as on main', () => {
    setEntityRoutesEnabled(false)
    for (const route of ENTITY_ROUTES) {
      expect(isCompoundRoute(route)).toBe(false)
      expect(parseCompoundRoute(route)).toBeNull()
      expect(parseRouteToNavigationState(route)).toBeNull()
      expect(resolveRouteNavigationState(route)).toEqual({ navigator: 'unavailable', route, details: null })
    }
    for (const prefix of ENTITY_PREFIXES) {
      expect(isCompoundRoutePrefix(prefix)).toBe(false)
    }
  })

  test('flag off keeps legacy routes working', () => {
    setEntityRoutesEnabled(false)
    for (const [route, expected] of BASE_ROUTES) {
      expect(isCompoundRoute(route)).toBe(expected)
      expect(parseCompoundRoute(route)).not.toBeNull()
    }
    expect(isCompoundRoutePrefix('tasks')).toBe(true)
    expect(isCompoundRoutePrefix('settings')).toBe(true)
  })

  test('flag on accepts entity routes', () => {
    setEntityRoutesEnabled(true)
    for (const route of ENTITY_ROUTES) {
      expect(isCompoundRoute(route)).toBe(true)
      const parsed = parseCompoundRoute(route)
      expect(parsed?.navigator).toBe('entity')
      expect(parseRouteToNavigationState(route)).not.toBeNull()
    }
    for (const prefix of ENTITY_PREFIXES) {
      expect(isCompoundRoutePrefix(prefix)).toBe(true)
    }
  })

  test('overlapping new shapes stay gated while legacy shapes keep working', () => {
    setEntityRoutesEnabled(false)
    // New kind-first shapes on shared prefixes are rejected when off.
    expect(parseCompoundRoute('tasks/list/tl-1')).toBeNull()
    expect(parseCompoundRoute('projects/milestone/ms-1')).toBeNull()
    expect(parseCompoundRoute('settings/licences/lc-1')).toBeNull()
    expect(parseCompoundRoute('home/apps/app-1')).toBeNull()
    // Legacy shapes on the same prefixes keep working.
    expect(parseCompoundRoute('tasks/task/t-1')?.navigator).toBe('tasks')
    expect(parseCompoundRoute('projects/project/p-1')?.navigator).toBe('projects')

    setEntityRoutesEnabled(true)
    expect(parseCompoundRoute('tasks/list/tl-1')?.navigator).toBe('entity')
    expect(parseCompoundRoute('projects/milestone/ms-1')?.navigator).toBe('entity')
    expect(parseCompoundRoute('settings/licences/lc-1')?.navigator).toBe('entity')
    expect(parseCompoundRoute('home/apps/app-1')?.navigator).toBe('entity')
    // Legacy shapes are not stolen when on.
    expect(parseCompoundRoute('tasks/task/t-1')?.navigator).toBe('tasks')
  })
})

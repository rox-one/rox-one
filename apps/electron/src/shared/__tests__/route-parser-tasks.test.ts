/**
 * Tasks route round-trips (Issue 17).
 */
import { describe, test, expect } from 'bun:test'
import {
  isCompoundRoute,
  parseCompoundRoute,
  buildCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
} from '../route-parser'
import {
  getNavigationStateKey,
  parseNavigationStateKey,
  isTasksNavigation,
} from '../types'
import { routes } from '../routes'

describe('tasks routes', () => {
  test('route builders emit the tasks prefix', () => {
    expect(routes.view.tasks()).toBe('tasks')
    expect(routes.view.tasks('task-a')).toBe('tasks/task/task-a')
  })

  test('tasks is a compound route prefix', () => {
    expect(isCompoundRoute('tasks')).toBe(true)
    expect(isCompoundRoute('tasks/task/task-a')).toBe(true)
  })

  test('parses bare and detail tasks routes', () => {
    expect(parseCompoundRoute('tasks')).toEqual({ navigator: 'tasks', details: null })
    const state = parseRouteToNavigationState('tasks')
    expect(state).toEqual({ navigator: 'tasks', details: null })
    expect(state && isTasksNavigation(state)).toBe(true)

    const detail = parseRouteToNavigationState('tasks/task/task-a')
    expect(detail).toEqual({ navigator: 'tasks', details: { type: 'task', taskId: 'task-a' } })
  })

  test('round-trips navigation state and panel keys', () => {
    const bare = { navigator: 'tasks' as const, details: null }
    expect(buildCompoundRoute(bare)).toBe('tasks')
    expect(buildRouteFromNavigationState(bare)).toBe('tasks')
    expect(getNavigationStateKey(bare)).toBe('tasks')
    expect(parseNavigationStateKey('tasks')).toEqual(bare)

    const detail = { navigator: 'tasks' as const, details: { type: 'task' as const, taskId: 'task-a' } }
    expect(buildRouteFromNavigationState(detail)).toBe('tasks/task/task-a')
    expect(getNavigationStateKey(detail)).toBe('tasks/task/task-a')
    expect(parseNavigationStateKey('tasks/task/task-a')).toEqual(detail)
  })
})

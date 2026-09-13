/**
 * Meetings route round-trips (RMA-I012).
 */
import { describe, test, expect } from 'bun:test'
import {
  isCompoundRoute,
  parseCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
} from '../route-parser'
import {
  getNavigationStateKey,
  parseNavigationStateKey,
  isMeetingsNavigation,
} from '../types'
import { routes } from '../routes'

describe('meetings routes', () => {
  test('route builders emit the meetings prefix', () => {
    expect(routes.view.meetings()).toBe('meetings')
    expect(routes.view.meetings('m-1')).toBe('meetings/meeting/m-1')
  })

  test('meetings is a compound route prefix', () => {
    expect(isCompoundRoute('meetings')).toBe(true)
    expect(isCompoundRoute('meetings/meeting/m-1')).toBe(true)
  })

  test('parses bare and detail meetings routes', () => {
    expect(parseCompoundRoute('meetings')).toEqual({ navigator: 'meetings', details: null })
    const state = parseRouteToNavigationState('meetings')
    expect(state).toEqual({ navigator: 'meetings', details: null })
    expect(state && isMeetingsNavigation(state)).toBe(true)

    const detail = parseRouteToNavigationState('meetings/meeting/m-1')
    expect(detail).toEqual({ navigator: 'meetings', details: { type: 'meeting', meetingId: 'm-1' } })
  })

  test('round-trips navigation state and panel keys', () => {
    const bare = { navigator: 'meetings' as const, details: null }
    expect(buildRouteFromNavigationState(bare)).toBe('meetings')
    expect(getNavigationStateKey(bare)).toBe('meetings')
    expect(parseNavigationStateKey('meetings')).toEqual(bare)

    const detail = { navigator: 'meetings' as const, details: { type: 'meeting' as const, meetingId: 'm-1' } }
    expect(buildRouteFromNavigationState(detail)).toBe('meetings/meeting/m-1')
    expect(parseNavigationStateKey('meetings/meeting/m-1')).toEqual(detail)
  })
})

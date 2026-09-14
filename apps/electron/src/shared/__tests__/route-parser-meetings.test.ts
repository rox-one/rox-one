/**
 * Meetings route round-trips (issue #368 / I012).
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
  isMeetingsNavigation,
} from '../types'
import { routes } from '../routes'

describe('meetings routes', () => {
  test('route builders emit the meetings prefix', () => {
    expect(routes.view.meetings()).toBe('meetings')
    expect(routes.view.meetings('mtg-a')).toBe('meetings/meeting/mtg-a')
  })

  test('meetings is a compound route prefix', () => {
    expect(isCompoundRoute('meetings')).toBe(true)
    expect(isCompoundRoute('meetings/meeting/mtg-a')).toBe(true)
  })

  test('parses bare and detail meetings routes', () => {
    expect(parseCompoundRoute('meetings')).toEqual({ navigator: 'meetings', details: null })
    const state = parseRouteToNavigationState('meetings')
    expect(state).toEqual({ navigator: 'meetings', details: null })
    expect(state && isMeetingsNavigation(state)).toBe(true)

    const detail = parseRouteToNavigationState('meetings/meeting/mtg-a')
    expect(detail).toEqual({ navigator: 'meetings', details: { type: 'meeting', meetingId: 'mtg-a' } })
  })

  test('round-trips navigation state and panel keys', () => {
    const bare = { navigator: 'meetings' as const, details: null }
    expect(buildCompoundRoute(bare)).toBe('meetings')
    expect(buildRouteFromNavigationState(bare)).toBe('meetings')
    expect(getNavigationStateKey(bare)).toBe('meetings')
    expect(parseNavigationStateKey('meetings')).toEqual(bare)

    const detail = { navigator: 'meetings' as const, details: { type: 'meeting' as const, meetingId: 'mtg-a' } }
    expect(buildRouteFromNavigationState(detail)).toBe('meetings/meeting/mtg-a')
    expect(getNavigationStateKey(detail)).toBe('meetings/meeting/mtg-a')
    expect(parseNavigationStateKey('meetings/meeting/mtg-a')).toEqual(detail)
  })
})

/**
 * Meetings route round-trips (RMA-I012).
 *
 * W3.2 (Согласованность-20261009): Встречи moved into the `calendar` surface.
 * The `meetings` routes are legacy aliases — they keep their exact shape but
 * now parse into a `surface` navigation state (`calendar`, with `meetingId`
 * for a selected meeting).
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
  isSurfaceNavigation,
} from '../types'
import { routes } from '../routes'

describe('meetings routes (calendar aliases)', () => {
  test('route builders still emit the meetings prefix', () => {
    expect(routes.view.meetings()).toBe('meetings')
    expect(routes.view.meetings('m-1')).toBe('meetings/meeting/m-1')
  })

  test('meetings stays a compound route prefix', () => {
    expect(isCompoundRoute('meetings')).toBe(true)
    expect(isCompoundRoute('meetings/meeting/m-1')).toBe(true)
  })

  test('parses bare and detail meetings routes into the calendar surface', () => {
    expect(parseCompoundRoute('meetings')).toEqual({ navigator: 'surface', surface: 'calendar', details: null })
    const state = parseRouteToNavigationState('meetings')
    expect(state).toEqual({ navigator: 'surface', surface: 'calendar', details: null })
    expect(state && isSurfaceNavigation(state)).toBe(true)

    const detail = parseRouteToNavigationState('meetings/meeting/m-1')
    expect(detail).toEqual({ navigator: 'surface', surface: 'calendar', details: null, meetingId: 'm-1' })
  })

  test('round-trips navigation state and panel keys', () => {
    const bare = { navigator: 'surface' as const, surface: 'calendar' as const, details: null }
    expect(buildRouteFromNavigationState(bare)).toBe('calendar')
    expect(getNavigationStateKey(bare)).toBe('calendar')
    expect(parseNavigationStateKey('meetings')).toEqual(bare)

    const detail = { navigator: 'surface' as const, surface: 'calendar' as const, details: null, meetingId: 'm-1' }
    expect(buildRouteFromNavigationState(detail)).toBe('meetings/meeting/m-1')
    expect(getNavigationStateKey(detail)).toBe('meetings/meeting/m-1')
    expect(parseNavigationStateKey('meetings/meeting/m-1')).toEqual(detail)
  })
})
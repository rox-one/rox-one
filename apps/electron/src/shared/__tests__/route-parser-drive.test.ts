import { describe, expect, it } from 'bun:test'
import { routes } from '../routes'
import {
  buildCompoundRoute,
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
  resolveRouteNavigationState,
} from '../route-parser'

/**
 * ROX Drive (main, wave 1) meets the cycle's W3.2/W3.3 legacy-alias layer here:
 * `drive` is a first-class navigator while `meetings`/`contacts` stay aliases of
 * the unified surfaces. These tests lock both behaviours on the merged parser,
 * because the alias checks run before the navigator table and a regression in
 * either direction would silently send a deep link to the wrong host.
 */
describe('route-parser: ROX Drive routes', () => {
  it('round-trips the bare drive route', () => {
    expect(routes.view.drive()).toBe('drive')

    const compound = parseCompoundRoute('drive')
    expect(compound).toEqual({ navigator: 'drive', details: null })
    expect(buildCompoundRoute(compound!)).toBe('drive')

    const state = parseRouteToNavigationState('drive')
    expect(state).toEqual({ navigator: 'drive', details: null })
    expect(buildRouteFromNavigationState(state!)).toBe('drive')
  })

  it('round-trips a drive folder deep link', () => {
    expect(routes.view.drive('abc')).toBe('drive/folder/abc')

    const compound = parseCompoundRoute('drive/folder/abc')
    expect(compound).toEqual({ navigator: 'drive', details: { type: 'folder', id: 'abc' } })
    expect(buildCompoundRoute(compound!)).toBe('drive/folder/abc')

    const state = parseRouteToNavigationState('drive/folder/abc')
    expect(state).toEqual({ navigator: 'drive', details: { type: 'folder', folderId: 'abc' } })
    expect(buildRouteFromNavigationState(state!)).toBe('drive/folder/abc')
  })

  it('decodes a percent-encoded folder id and re-encodes it on the way back', () => {
    const state = resolveRouteNavigationState('drive/folder/a%20b')
    expect(state).toEqual({ navigator: 'drive', details: { type: 'folder', folderId: 'a b' } })
    expect(buildRouteFromNavigationState(state)).toBe('drive/folder/a%20b')
  })

  it('rejects an unknown drive subpath instead of guessing a route', () => {
    expect(parseCompoundRoute('drive/unknown/x')).toBeNull()
    expect(resolveRouteNavigationState('drive/unknown/x').navigator).toBe('unavailable')
  })

  it('keeps the legacy meetings alias on the calendar surface beside the drive navigator', () => {
    // W3.2: Встречи render inside the unified calendar surface (not a mode), so
    // `meetings/meeting/{id}` must keep resolving to `surface: 'calendar'`.
    expect(resolveRouteNavigationState('meetings/meeting/m1')).toEqual({
      navigator: 'surface',
      surface: 'calendar',
      details: null,
      meetingId: 'm1',
    })
  })
})
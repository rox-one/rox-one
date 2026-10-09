/**
 * W1-07 (#1504): unified mode roots, route ids and panel kinds.
 * Gate off = baseline (covered byte-for-byte by the platform baseline test);
 * gate on = `messenger|calendar|goals|contacts` parse to a `surface` state.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { entityRoute } from '@rox/core/entities'
import {
  PANEL_KINDS,
  PANEL_KIND_DESCRIPTORS,
  SURFACE_ROUTE_IDS,
  UNIFIED_SURFACE_FLAGS,
  UNIFIED_SURFACE_IDS,
  isPanelKind,
  isSurfaceRouteId,
  isUnifiedSurfaceRouteEnabled,
  resetUnifiedSurfaceRoutes,
  setUnifiedSurfaceRoutesEnabled,
  surfaceRoute,
  surfaceRouteKind,
} from '../surface-routes'
import {
  buildRouteFromNavigationState,
  isCompoundRoute,
  parseRoute,
  parseRouteToNavigationState,
  parseRouteToNavigationStateOrUnavailable,
  resetEntityRoutesEnabled,
  resolveViewRoute,
  setEntityRoutesEnabled,
} from '../route-parser'
import { routes } from '../routes'
import { getNavigationStateKey, isSurfaceNavigation, parseNavigationStateKey } from '../types'

afterEach(() => {
  resetUnifiedSurfaceRoutes()
  resetEntityRoutesEnabled()
})

describe('unified surface gate', () => {
  it('defaults to closed for every surface', () => {
    for (const id of UNIFIED_SURFACE_IDS) expect(isUnifiedSurfaceRouteEnabled(id)).toBe(false)
  })

  it('maps each surface to its literal workbench flag id', () => {
    expect(UNIFIED_SURFACE_FLAGS).toEqual({
      messenger: WORKBENCH_FLAG.modeMessengerV1,
      calendar: WORKBENCH_FLAG.modeCalendarV1,
      goals: WORKBENCH_FLAG.modeGoalsV1,
    })
  })

  it('gate off: mode roots are not routes', () => {
    for (const id of UNIFIED_SURFACE_IDS) {
      expect(isCompoundRoute(id)).toBe(false)
      expect(parseRoute(id)).toBeNull()
      expect(parseRouteToNavigationStateOrUnavailable(id).navigator).toBe('unavailable')
    }
  })

  it('gate on: each enabled root parses to a surface state and round-trips', () => {
    setUnifiedSurfaceRoutesEnabled(['messenger', 'goals'])
    for (const id of ['messenger', 'goals'] as const) {
      expect(isCompoundRoute(id)).toBe(true)
      expect(parseRoute(id)).toEqual({ type: 'view', name: 'surface', params: { surface: id } })
      const state = parseRouteToNavigationState(id)
      expect(state).toEqual({ navigator: 'surface', surface: id, details: null })
      expect(state && isSurfaceNavigation(state)).toBe(true)
      expect(buildRouteFromNavigationState(state!)).toBe(id)
      expect(getNavigationStateKey(state!)).toBe(id)
      expect(parseNavigationStateKey(id)).toEqual(state)
      expect(routes.view.surface(id)).toBe(id)
    }
    // Only the enabled surfaces open.
    expect(parseRoute('calendar')).toBeNull()
    // W3.3: `contacts` is no longer a surface root; it is an alias to Команда.
    expect(parseRouteToNavigationState('contacts')).toEqual({ navigator: 'surface', surface: 'messenger', details: null })
  })

  it('negative: unknown or nested surface segments never parse as surfaces', () => {
    setUnifiedSurfaceRoutesEnabled(UNIFIED_SURFACE_IDS)
    expect(parseRoute('surface/messenger')).toBeNull()
    expect(parseRoute('messengers')).toBeNull()
    expect(parseRouteToNavigationState('goals/unknown/x')?.navigator === 'surface').toBe(false)
  })

  it('entity routes keep priority under the surface root when both gates are on', () => {
    setUnifiedSurfaceRoutesEnabled(UNIFIED_SURFACE_IDS)
    setEntityRoutesEnabled(true)
    expect(parseRouteToNavigationState('goals/goal/g-1')?.navigator).toBe('entity')
    expect(parseRouteToNavigationState('messenger/c-1')?.navigator).toBe('entity')
    expect(parseRouteToNavigationState('goals')?.navigator).toBe('surface')
  })
})

describe('W3.2/W3.3 surface merges', () => {
  it('meetings/contacts aliases resolve with every flag off', () => {
    resetUnifiedSurfaceRoutes()
    resetEntityRoutesEnabled()
    expect(parseRouteToNavigationState('meetings')).toEqual({ navigator: 'surface', surface: 'calendar', details: null })
    expect(parseRouteToNavigationState('meetings/meeting/m-1')).toEqual({
      navigator: 'surface', surface: 'calendar', details: null, meetingId: 'm-1',
    })
    expect(parseRouteToNavigationState('contacts')).toEqual({ navigator: 'surface', surface: 'messenger', details: null })
    // Building the calendar state round-trips both shapes.
    expect(buildRouteFromNavigationState({ navigator: 'surface', surface: 'calendar', details: null })).toBe('calendar')
    expect(buildRouteFromNavigationState({
      navigator: 'surface', surface: 'calendar', details: null, meetingId: 'm-1',
    })).toBe('meetings/meeting/m-1')
    // The legacy builders keep their (aliased) output.
    expect(routes.view.meetings()).toBe('meetings')
    expect(routes.view.meetings('m-1')).toBe('meetings/meeting/m-1')
    // resolveViewRoute accepts the aliases instead of degrading to unavailable.
    expect(resolveViewRoute('meetings').navigator).toBe('surface')
    expect(resolveViewRoute('contacts')).toEqual({ navigator: 'surface', surface: 'messenger', details: null })
    expect(resolveViewRoute('meetings/meeting/m-1')).toEqual({
      navigator: 'surface', surface: 'calendar', details: null, meetingId: 'm-1',
    })
  })

  it('key round-trip keeps the selected meeting', () => {
    const state = { navigator: 'surface', surface: 'calendar', details: null, meetingId: 'm-1' } as const
    expect(getNavigationStateKey(state)).toBe('meetings/meeting/m-1')
    expect(parseNavigationStateKey('meetings/meeting/m-1')).toEqual(state)
    expect(parseNavigationStateKey('meetings')).toEqual({ navigator: 'surface', surface: 'calendar', details: null })
    expect(parseNavigationStateKey('contacts')).toEqual({ navigator: 'surface', surface: 'messenger', details: null })
  })

  it('entity routes keep priority over the aliases when entities.links.v1 is on', () => {
    setEntityRoutesEnabled(true)
    expect(parseRouteToNavigationState('meetings/meeting/m-1')?.navigator).toBe('entity')
    expect(parseRouteToNavigationState('contacts/person/p-1')?.navigator).toBe('entity')
    expect(parseRouteToNavigationState('contacts')?.navigator).toBe('surface')
  })
})

describe('route ids', () => {
  it('static ids resolve to app routes; Docs keeps the notes route', () => {
    expect(surfaceRoute('home.root')).toBe('home')
    expect(surfaceRoute('chat.root')).toBe('allSessions')
    expect(surfaceRoute('messenger.home')).toBe('messenger')
    expect(surfaceRoute('docs.home')).toBe('notes')
    expect(surfaceRoute('goals.workMap')).toBe('goals')
  })

  it('entity ids delegate to #1499 entityRoute', () => {
    expect(surfaceRoute('goals.goal', 'g-1')).toBe(entityRoute({ kind: 'goal', id: 'g-1' }))
    expect(surfaceRoute('messenger.chat', 'c-1')).toBe(entityRoute({ kind: 'channel', id: 'c-1' }))
    expect(surfaceRouteKind('contacts.person')).toBe('person')
    expect(surfaceRouteKind('home.root')).toBeNull()
  })

  it('negative: an entity id without an entity id throws; unknown ids are rejected', () => {
    expect(() => (surfaceRoute as (id: string) => string)('goals.goal')).toThrow('needs an entity id')
    expect(isSurfaceRouteId('goals.nope')).toBe(false)
    expect(isSurfaceRouteId('goals.goal')).toBe(true)
    expect(new Set(SURFACE_ROUTE_IDS).size).toBe(SURFACE_ROUTE_IDS.length)
  })
})

describe('panel kinds', () => {
  it('every kind has a descriptor with a surfaces.panel.* title', () => {
    for (const kind of PANEL_KINDS) {
      const descriptor = PANEL_KIND_DESCRIPTORS[kind]
      expect(descriptor.kind).toBe(kind)
      expect(descriptor.titleKey.startsWith('surfaces.panel.')).toBe(true)
    }
  })

  it('uses the spec widths (quick panels 328, task detail 560, add-item modal 560)', () => {
    expect(PANEL_KIND_DESCRIPTORS['chat.quick.docs'].defaultWidth).toBe(328)
    expect(PANEL_KIND_DESCRIPTORS['task.detail'].defaultWidth).toBe(560)
    expect(PANEL_KIND_DESCRIPTORS['goal.add-item'].placement).toBe('modal')
  })

  it('negative: agent.panel is reserved for #1512 and unknown kinds are rejected', () => {
    expect(isPanelKind('agent.panel')).toBe(false)
    expect(isPanelKind('nope')).toBe(false)
    expect(isPanelKind('thread')).toBe(true)
  })
})

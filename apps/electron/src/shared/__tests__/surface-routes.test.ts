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
      contacts: WORKBENCH_FLAG.modeContactsV1,
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
    expect(parseRoute('contacts')).toBeNull()
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

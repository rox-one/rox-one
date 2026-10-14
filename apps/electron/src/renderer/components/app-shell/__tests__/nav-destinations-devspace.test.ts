/**
 * Feature-flag gating of the Developers / Playbooks / Cookbooks destinations
 * (2026-10-09 pack D1/D12; cookbooks-surface program): the entries exist once in
 * the registry and are visible only while their master atom is on.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import {
  APP_NAV_DESTINATIONS_BY_ID,
  visibleNavDestinationsAtom,
} from '../nav-destinations'
import { devSpaceEnabledAtom } from '../../../atoms/dev-space'
import { playbooksEnabledAtom } from '../../../atoms/playbooks'
import { DEDICATED_FLAG_ATOMS } from '../../../platform/unified-flags'
import { parseRouteToNavigationState } from '../../../../shared/route-parser'
import { routes } from '../../../../shared/routes'

const originalWindow: unknown = globalThis.window

function memoryStorage(): Storage {
  const data: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(data).length
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key]
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null
    },
    setItem(key: string, value: string) {
      data[key] = String(value)
    },
    removeItem(key: string) {
      delete data[key]
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null
    },
  }
}

beforeEach(() => {
  globalThis.window = { localStorage: memoryStorage() } as unknown as typeof window
})

afterEach(() => {
  if (originalWindow) globalThis.window = originalWindow as typeof window
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('developers / playbooks destination gating', () => {
  it('registers the entries once with the frozen identity', () => {
    expect(APP_NAV_DESTINATIONS_BY_ID.developers.linkId).toBe('nav:developers')
    expect(APP_NAV_DESTINATIONS_BY_ID.developers.labelKey).toBe('sidebar.developers')
    expect(APP_NAV_DESTINATIONS_BY_ID.developers.railGroup).toBe('more')
    expect(APP_NAV_DESTINATIONS_BY_ID.playbooks.linkId).toBe('nav:playbooks')
    expect(APP_NAV_DESTINATIONS_BY_ID.playbooks.labelKey).toBe('sidebar.playbooks')
    expect(APP_NAV_DESTINATIONS_BY_ID.playbooks.railGroup).toBe('more')
  })

  it('hides both entries by default and keeps the existing destinations', () => {
    const store = createStore()
    const ids = store.get(visibleNavDestinationsAtom).map((destination) => destination.id)
    expect(ids).not.toContain('developers')
    expect(ids).not.toContain('playbooks')
    expect(ids).toContain('sessions')
    expect(ids).toContain('settings')
  })

  it('shows each entry only while its master flag is on', () => {
    const store = createStore()
    store.set(devSpaceEnabledAtom, true)
    const withDevSpace = store.get(visibleNavDestinationsAtom).map((destination) => destination.id)
    expect(withDevSpace).toContain('developers')
    expect(withDevSpace).not.toContain('playbooks')

    store.set(playbooksEnabledAtom, true)
    const withPlaybooks = store.get(visibleNavDestinationsAtom).map((destination) => destination.id)
    expect(withPlaybooks).toContain('playbooks')
  })
})

describe('cookbooks destination', () => {
  const flag = DEDICATED_FLAG_ATOMS.get(WORKBENCH_FLAG.cookbooksV1)

  it('registers the entry once with the frozen identity', () => {
    const destination = APP_NAV_DESTINATIONS_BY_ID.cookbooks
    expect(destination.linkId).toBe('nav:cookbooks')
    expect(destination.labelKey).toBe('sidebar.cookbooks')
    expect(destination.railGroup).toBe('more')
    // The route is what the tab strip reads to name the surface.
    expect(destination.route?.()).toBe(routes.view.cookbooks())
    expect(destination.isActive(parseRouteToNavigationState(routes.view.cookbooks())!)).toBe(true)
  })

  it('shares the shell kill-switch atom rather than a second storage key', () => {
    expect(flag).toBeDefined()
    expect(APP_NAV_DESTINATIONS_BY_ID.cookbooks.flagAtom).toBe(flag)
  })

  it('is visible by default (cookbooks.v1 defaults ON) and hides with the flag off', () => {
    const store = createStore()
    expect(store.get(visibleNavDestinationsAtom).map((destination) => destination.id)).toContain('cookbooks')

    store.set(flag!, false)
    expect(store.get(visibleNavDestinationsAtom).map((destination) => destination.id)).not.toContain('cookbooks')
  })
})
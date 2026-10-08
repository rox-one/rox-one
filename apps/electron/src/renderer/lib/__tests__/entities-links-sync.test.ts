/**
 * Renderer side of `entities.links.v1`:
 * - review 3 #1: the gate is seeded synchronously before the first render,
 *   so restored entity tabs resolve; navigation re-resolves on change;
 * - review 3 #3: the renderer uses main's EFFECTIVE state (env override);
 * - fix5 A: push failures are logged, not swallowed.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { EntitiesLinksEffectiveState } from '@rox/shared/feature-flags'
import { resolveRouteNavigationState } from '../../../shared/route-parser'
import { parseNavigationStateKey } from '../../../shared/types'
import {
  __resetEntitiesLinksSyncForTests,
  getEntitiesLinksEffectiveState,
  pushEntitiesLinksFlag,
  readPersistedEntitiesLinksFlag,
  seedEntitiesLinksGate,
  subscribeEntitiesLinksEffectiveState,
} from '../entities-links-sync'

const g = globalThis as unknown as { window?: unknown; localStorage?: unknown }
const previousWindow = g.window
const previousStorage = g.localStorage

function installBridge(bridge: Record<string, unknown> | undefined) {
  g.window = bridge === undefined ? {} : { electronAPI: bridge }
}

function installStorage(values: Record<string, string>) {
  g.localStorage = {
    getItem: (key: string) => (key in values ? values[key] : null),
    setItem: () => {},
    removeItem: () => {},
  }
}

const state = (enabled: boolean, persisted: boolean, envOverride?: boolean): EntitiesLinksEffectiveState => ({ enabled, persisted, envOverride })

beforeEach(() => {
  __resetEntitiesLinksSyncForTests()
  installStorage({})
})

afterEach(() => {
  __resetEntitiesLinksSyncForTests()
  g.window = previousWindow
  g.localStorage = previousStorage
})

describe('seedEntitiesLinksGate (review 3 #1)', () => {
  it('reads the persisted atom value and reports it to main synchronously', () => {
    installStorage({ 'craft-feature-entities-links-v1': 'true' })
    const reports: boolean[] = []
    installBridge({ syncEntitiesLinksState: (persisted: boolean) => { reports.push(persisted); return state(persisted, persisted) } })
    expect(readPersistedEntitiesLinksFlag()).toBe(true)
    expect(seedEntitiesLinksGate()).toEqual(state(true, true))
    expect(reports).toEqual([true])
  })

  it('restored entity routes and persisted entity keys resolve on the first pass', () => {
    installBridge({ syncEntitiesLinksState: () => state(true, true) })
    seedEntitiesLinksGate(true)
    expect(resolveRouteNavigationState('goals/goal/g-1').navigator).toBe('entity')
    expect(parseNavigationStateKey('entity/docs/file/f-1')?.navigator).toBe('entity')
  })

  it('without a bridge the toggle alone decides (default OFF)', () => {
    installBridge(undefined)
    expect(seedEntitiesLinksGate()).toEqual(state(false, false))
    expect(resolveRouteNavigationState('goals/goal/g-1').navigator).toBe('unavailable')
    expect(seedEntitiesLinksGate(true).enabled).toBe(true)
  })

  it('main.tsx seeds the gate before createRoot', () => {
    const source = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8')
    const seed = source.indexOf('seedEntitiesLinksGate()')
    expect(seed).toBeGreaterThan(-1)
    expect(seed).toBeLessThan(source.indexOf('ReactDOM.createRoot('))
  })

  it('NavigationContext re-resolves the focused route when the effective state changes', () => {
    const source = readFileSync(new URL('../../contexts/NavigationContext.tsx', import.meta.url), 'utf8')
    expect(source).toContain('const entitiesLinksEnabled = useEntitiesLinksEffectiveState().enabled')
    expect(source).toMatch(/resolveRouteNavigationState\(focusedRoute\)[\s\S]*?\}, \[[^\]]*entitiesLinksEnabled\]\)/)
  })
})

describe('effective state from main (review 3 #3)', () => {
  it('env=1: main forces on although the toggle is off', () => {
    installBridge({ syncEntitiesLinksState: (persisted: boolean) => state(true, persisted, true) })
    expect(seedEntitiesLinksGate(false)).toEqual(state(true, false, true))
    expect(resolveRouteNavigationState('docs/file/f-1').navigator).toBe('entity')
  })

  it('env=0 + toggle on: main forces off, and the push keeps it off', async () => {
    installBridge({
      syncEntitiesLinksState: (persisted: boolean) => state(false, persisted, false),
      setEntitiesLinksEnabled: async (enabled: boolean) => state(false, enabled, false),
    })
    seedEntitiesLinksGate(false)
    const result = await pushEntitiesLinksFlag(true)
    expect(result).toEqual(state(false, true, false))
    expect(resolveRouteNavigationState('docs/file/f-1').navigator).toBe('unavailable')
  })

  it('no env: the push result follows the toggle and notifies subscribers', async () => {
    installBridge({
      syncEntitiesLinksState: (persisted: boolean) => state(persisted, persisted),
      setEntitiesLinksEnabled: async (enabled: boolean) => state(enabled, enabled),
    })
    seedEntitiesLinksGate(false)
    let notified = 0
    const unsubscribe = subscribeEntitiesLinksEffectiveState(() => { notified += 1 })
    await pushEntitiesLinksFlag(true)
    unsubscribe()
    expect(getEntitiesLinksEffectiveState()).toEqual(state(true, true))
    expect(notified).toBe(1)
  })
})

describe('push errors are logged (fix5 A)', () => {
  it('logs a rejected IPC instead of swallowing it', async () => {
    const error = spyOn(console, 'error').mockImplementation(() => {})
    installBridge({ setEntitiesLinksEnabled: () => Promise.reject(new Error('no handler for entities:setLinksEnabled')) })
    await pushEntitiesLinksFlag(true)
    expect(error).toHaveBeenCalled()
    expect(String(error.mock.calls[0]?.[0])).toContain('entities.links.v1')
    error.mockRestore()
  })

  it('logs a throwing bridge', async () => {
    const error = spyOn(console, 'error').mockImplementation(() => {})
    installBridge({ setEntitiesLinksEnabled: () => { throw new Error('bridge gone') } })
    await pushEntitiesLinksFlag(true)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

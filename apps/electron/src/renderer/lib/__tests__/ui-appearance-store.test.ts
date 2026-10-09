/**
 * DISPATCH A6/B10 — shared «Интерфейс» store.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import {
  attachUiAppearanceBridge,
  getUiAppearance,
  resetUiAppearanceBridge,
  saveUiAppearancePatch,
  subscribeUiAppearance,
} from '../ui-appearance-store'
import type { ElectronAPI, SystemAccentSnapshot } from '../../../shared/types'

type AccentListener = (accent: SystemAccentSnapshot) => void

function fakeApi(initial: {
  statusBarVisible: boolean
  accentSource: 'brand' | 'system'
  accent: SystemAccentSnapshot
}) {
  const accentListeners: AccentListener[] = []
  const api = {
    getUiPreferences: async () => ({ ...initial }),
    setUiPreferences: async (patch: { statusBarVisible?: boolean; accentSource?: 'brand' | 'system' }) => ({
      statusBarVisible: patch.statusBarVisible ?? initial.statusBarVisible,
      accentSource: patch.accentSource ?? initial.accentSource,
      accent: initial.accent,
    }),
    onAccentChanged: (cb: AccentListener) => { accentListeners.push(cb); return () => { accentListeners.splice(accentListeners.indexOf(cb), 1) } },
  } as unknown as ElectronAPI
  return { api, accentListeners }
}

afterEach(() => resetUiAppearanceBridge())

describe('ui appearance store', () => {
  it('defaults to a visible status bar and brand accent', () => {
    expect(getUiAppearance()).toEqual({ statusBarVisible: true, accentSource: 'brand', accent: null })
  })

  it('loads the bridge snapshot once and pushes live accents', async () => {
    const { api, accentListeners } = fakeApi({ statusBarVisible: false, accentSource: 'system', accent: { source: 'system', color: 'aabbccdd' } })
    const seen: number[] = []
    subscribeUiAppearance(() => seen.push(1))
    attachUiAppearanceBridge(api)
    await Promise.resolve()
    expect(getUiAppearance().statusBarVisible).toBe(false)
    expect(getUiAppearance().accentSource).toBe('system')

    accentListeners[0]!({ source: 'system', color: 'ff0000ff' })
    expect(getUiAppearance().accent).toEqual({ source: 'system', color: 'ff0000ff' })
    // attach twice must not double-subscribe
    attachUiAppearanceBridge(api)
    expect(accentListeners.length).toBe(1)
    expect(seen.length).toBeGreaterThan(0)
  })

  it('publishes only after a successful save and swallows failures', async () => {
    const { api } = fakeApi({ statusBarVisible: true, accentSource: 'brand', accent: { source: 'brand', color: null } })
    expect(await saveUiAppearancePatch({ statusBarVisible: false }, api)).toBe(true)
    expect(getUiAppearance().statusBarVisible).toBe(false)

    const failing = { setUiPreferences: async () => { throw new Error('nope') } } as unknown as ElectronAPI
    expect(await saveUiAppearancePatch({ statusBarVisible: true }, failing)).toBe(false)
    expect(getUiAppearance().statusBarVisible).toBe(false)
  })
})
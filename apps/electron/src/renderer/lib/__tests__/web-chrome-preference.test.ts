import { describe, expect, it } from 'bun:test'
import {
  WEB_CHROME_PREFERENCE_KEY,
  readWebChromePreference,
  resolveWebChromeMaterial,
  saveWebChromePreference,
  subscribeWebChromePreference,
  type WebChromePreference,
} from '../web-chrome-preference'

function browserHost(values = new Map<string, string>()) {
  const target = new EventTarget()
  return Object.assign(target, {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    },
    values,
    storageEvent(key: string | null, storageArea?: object) {
      const event = Object.assign(new Event('storage'), { key, storageArea })
      target.dispatchEvent(event)
    },
  })
}

describe('browser CSS material preference', () => {
  it('defaults to enabled system glass and rejects malformed stored preferences', () => {
    const host = browserHost()
    expect(readWebChromePreference(host.localStorage)).toEqual({ enabled: true, preference: 'system' })
    for (const raw of ['not JSON', 'null', '[]', '{"enabled":"false","preference":"opaque"}', '{"enabled":false,"preference":"mica"}']) {
      host.values.set(WEB_CHROME_PREFERENCE_KEY, raw)
      expect(readWebChromePreference(host.localStorage)).toEqual({ enabled: true, preference: 'system' })
    }
  })

  it('persists opaque and disabled choices across independent reads and retains the selected material when re-enabled', () => {
    const host = browserHost()
    expect(saveWebChromePreference({ materialPreference: 'opaque' }, host)).toEqual({ enabled: true, preference: 'opaque' })
    expect(resolveWebChromeMaterial(readWebChromePreference(host.localStorage))).toBe('solid')
    saveWebChromePreference({ enabled: false }, host)
    expect(readWebChromePreference(host.localStorage)).toEqual({ enabled: false, preference: 'opaque' })
    expect(resolveWebChromeMaterial(saveWebChromePreference({ enabled: true }, host))).toBe('solid')
    expect(resolveWebChromeMaterial(saveWebChromePreference({ materialPreference: 'glass' }, host))).toBe('glass')
    expect(resolveWebChromeMaterial(saveWebChromePreference({ enabled: false }, host))).toBe('solid')
    expect(host.values.has('craft-theme')).toBe(false)
  })

  it('updates the writing tab immediately and another tab only on a matching storage event', () => {
    const values = new Map<string, string>()
    const writer = browserHost(values)
    const reader = browserHost(values)
    const first: WebChromePreference[] = [], second: WebChromePreference[] = []
    const stopWriter = subscribeWebChromePreference(value => first.push(value), writer)
    const stopReader = subscribeWebChromePreference(value => second.push(value), reader)
    saveWebChromePreference({ materialPreference: 'opaque' }, writer)
    expect(first.at(-1)).toEqual({ enabled: true, preference: 'opaque' })
    expect(second).toEqual([{ enabled: true, preference: 'system' }])
    reader.storageEvent('unrelated')
    expect(second).toHaveLength(1)
    reader.storageEvent(WEB_CHROME_PREFERENCE_KEY, {}) // A sessionStorage event must not affect local preferences.
    expect(second).toHaveLength(1)
    reader.storageEvent(WEB_CHROME_PREFERENCE_KEY)
    expect(second.at(-1)).toEqual({ enabled: true, preference: 'opaque' })
    values.clear()
    reader.storageEvent(null)
    expect(second.at(-1)).toEqual({ enabled: true, preference: 'system' })
    stopWriter(); stopReader()
    const count = second.length
    reader.storageEvent(WEB_CHROME_PREFERENCE_KEY)
    expect(second).toHaveLength(count)
  })

  it('does not publish changes on rejected writes or missing readback, including a write of default values', () => {
    for (const mode of ['reject', 'silent', 'unreadable'] as const) {
      const host = browserHost()
      const events: WebChromePreference[] = []
      const stop = subscribeWebChromePreference(value => events.push(value), host)
      host.localStorage.setItem = () => { if (mode === 'reject') throw new Error('quota denied') }
      if (mode === 'unreadable') host.localStorage.getItem = () => { throw new Error('read denied') }
      expect(() => saveWebChromePreference({ enabled: true, materialPreference: 'system' }, host)).toThrow()
      expect(events).toEqual([{ enabled: true, preference: 'system' }])
      stop()
    }
  })
})

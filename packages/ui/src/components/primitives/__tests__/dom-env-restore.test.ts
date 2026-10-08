/**
 * W1-08 (#1505 fix1): dom-env must restore the process globals it replaces,
 * so suites that run later in the same `bun test` process are unaffected.
 */
import { describe, expect, it } from 'bun:test'

describe('dom-env restore', () => {
  it('uninstallDom() restores window/document/navigator/localStorage/DOM classes', async () => {
    const g = globalThis as Record<string, unknown>
    const keys = ['window', 'document', 'navigator', 'localStorage', 'Event', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']
    const before = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(g, key)]))
    const env = await import('./dom-env')
    expect(env.isDomInstalled()).toBe(true)
    expect(typeof g.document).toBe('object')
    env.uninstallDom()
    expect(env.isDomInstalled()).toBe(false)
    for (const key of keys) {
      const original = before.get(key)
      const now = Object.getOwnPropertyDescriptor(g, key)
      if (!original) expect(now).toBeUndefined()
      else expect(now?.value ?? now?.get).toBe(original.value ?? original.get)
    }
    // Re-installable (later files reuse the same window instance).
    const win = env.installDom()
    expect(g.window).toBe(win)
    env.uninstallDom()
    env.uninstallDom() // idempotent
  })
})

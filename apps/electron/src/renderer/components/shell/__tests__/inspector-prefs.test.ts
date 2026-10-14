import { useDomForFile as installDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { beforeEach, describe, expect, it } from 'bun:test'

installDom()

const prefs = await import('../inspector-prefs')

describe('per-screen inspector prefs', () => {
  beforeEach(() => {
    localStorage.clear()
    prefs.resetInspectorPrefsCache()
  })

  it('stores state per screen key and survives a cache reset (reload)', () => {
    prefs.patchScreenInspector('sessions', { visible: true, width: 500, section: 'git' })
    prefs.patchScreenInspector('docs', { visible: false, width: 300 })
    prefs.resetInspectorPrefsCache()
    expect(prefs.getScreenInspector('sessions')).toEqual({ visible: true, width: 500, section: 'git' })
    expect(prefs.getScreenInspector('docs')).toEqual({ visible: false, width: 300 })
  })

  it('clamps widths and drops junk from storage', () => {
    prefs.patchScreenInspector('tasks', { width: 99_999 })
    expect(prefs.getScreenInspector('tasks')?.width).toBe(prefs.INSPECTOR_PREF_MAX_WIDTH)
    expect(prefs.sanitizeInspectorMap({ a: { width: 'x', visible: 1, pinned: true }, b: null, c: [] })).toEqual({ a: { pinned: true } })
    expect(prefs.sanitizeInspectorMap('nope')).toEqual({})
  })

  it('pin toggles and notifies subscribers only on change', () => {
    let calls = 0
    const off = prefs.subscribeInspectorPrefs(() => { calls++ })
    expect(prefs.patchScreenInspector('feed', { pinned: true })).toBe(true)
    expect(prefs.patchScreenInspector('feed', { pinned: true })).toBe(false)
    expect(prefs.getScreenInspector('feed')?.pinned).toBe(true)
    prefs.patchScreenInspector('feed', { pinned: false })
    expect(prefs.getScreenInspector('feed')?.pinned).toBeUndefined()
    off()
    expect(calls).toBe(2)
  })
})

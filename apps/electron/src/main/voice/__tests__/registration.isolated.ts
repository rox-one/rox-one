import { describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import { getDefaultVoicePrefs } from '@rox/shared/voice'

const fakeApp = new EventEmitter()
const callbacks = new Map<string, () => void>()
const registrations: string[] = []
const removals: string[] = []
let failRegistration = false
mock.module('electron', () => ({
  app: fakeApp,
  BrowserWindow: { getAllWindows: () => [] },
  globalShortcut: {
    register(accelerator: string, callback: () => void) {
      registrations.push(accelerator)
      if (failRegistration) throw new Error('unavailable')
      if (callbacks.has(accelerator)) return false
      callbacks.set(accelerator, callback); return true
    },
    unregister(accelerator: string) { removals.push(accelerator); callbacks.delete(accelerator) },
  },
  screen: {},
}))

const { registerVoiceHotkeys } = await import('../overlay-window')

describe('actual Electron voice shortcut adapter', () => {
  it('global shortcut produces commands, foreground PTT pairs on managed inputs and blur cancels its owner', () => {
    const commands: unknown[] = []; let prefs = getDefaultVoicePrefs(1); prefs.hotkeyMode = 'ptt'
    callbacks.set('OtherAppShortcut', () => {})
    const dispose = registerVoiceHotkeys((...command) => { commands.push(command); return true }, id => id === 17, () => prefs)
    expect(callbacks.has('Escape')).toBe(false)
    callbacks.get(prefs.toggleAccelerator)!(); expect(commands).toEqual([['toggle']])
    const wc = Object.assign(new EventEmitter(), { id: 17, isDestroyed: () => false })
    fakeApp.emit('web-contents-created', {}, wc)
    let suppressed = 0
    wc.emit('before-input-event', { preventDefault() { suppressed++ } }, { type: 'keyDown', code: 'AltRight' })
    wc.emit('before-input-event', { preventDefault() { suppressed++ } }, { type: 'keyDown', code: 'AltRight' })
    fakeApp.emit('browser-window-blur', {}, { webContents: wc })
    wc.emit('before-input-event', { preventDefault() { suppressed++ } }, { type: 'keyUp', code: 'AltRight' })
    expect(commands).toEqual([['toggle'], ['ptt-down', 17], ['cancel', 17]])
    expect(suppressed).toBe(2)
    const foreign = Object.assign(new EventEmitter(), { id: 18, isDestroyed: () => false })
    fakeApp.emit('web-contents-created', {}, foreign)
    foreign.emit('before-input-event', { preventDefault() { suppressed++ } }, { type: 'keyDown', code: 'AltRight' })
    expect(commands).toHaveLength(3)
    prefs = { ...prefs, toggleAccelerator: 'CommandOrControl+Shift+R', cancelAccelerator: 'CommandOrControl+Shift+Escape' }
    fakeApp.emit('browser-window-focus')
    expect(callbacks.has('CommandOrControl+Shift+D')).toBe(false)
    callbacks.get(prefs.cancelAccelerator)!(); expect(commands.at(-1)).toEqual(['cancel'])
    dispose()
    expect(callbacks.has('OtherAppShortcut')).toBe(true)
    expect(callbacks.has(prefs.toggleAccelerator)).toBe(false)
    expect(fakeApp.listenerCount('web-contents-created')).toBe(0)
    expect(wc.listenerCount('before-input-event')).toBe(0)
    expect(foreign.listenerCount('before-input-event')).toBe(0)
  })

  it('reserved or invalid registration cannot capture app commands or crash startup', () => {
    failRegistration = true
    const before = registrations.length
    const dispose = registerVoiceHotkeys(() => true, () => false,
      () => ({ ...getDefaultVoicePrefs(1), toggleAccelerator: 'CommandOrControl+Q', cancelAccelerator: 'Invalid+Binding' }))
    expect(registrations.slice(before)).toEqual(['Invalid+Binding'])
    expect(callbacks.has('CommandOrControl+Q')).toBe(false)
    dispose(); failRegistration = false
  })
})

import { describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { RequestContext } from '@rox/server-core/transport'
import type { OverlayState } from '@rox/shared/voice/overlay-types'

const handlers = new Map<string, (...args: any[]) => unknown>()
const children: FakeWindow[] = []
let nextWebContentsId = 100
class FakeWindow extends EventEmitter {
  destroyed = false; focused = true; shown = 0; hidden = 0; visible = false
  webContents = Object.assign(new EventEmitter(), {
    id: nextWebContentsId++,
    isDestroyed: () => this.destroyed,
    send: (...args: unknown[]) => this.messages.push(args),
    setWindowOpenHandler: (handler: () => unknown) => { this.openHandler = handler },
  })
  messages: unknown[][] = []; openHandler?: () => unknown
  constructor(readonly config: Record<string, any> = {}) { super(); if (config.parent) children.push(this) }
  isDestroyed() { return this.destroyed }
  isFocused() { return this.focused }
  isVisible() { return this.visible }
  getBounds() { return { x: 0, y: 0, width: 900, height: 800 } }
  showInactive() { this.shown++; this.visible = true }
  hide() { this.hidden++; this.visible = false }
  destroy() { this.destroyed = true; this.visible = false; this.emit('closed') }
  async loadURL() {}
  async loadFile() {}
}
mock.module('electron', () => ({ app: { isPackaged: true }, BrowserWindow: FakeWindow,
  ipcMain: {
    handle: (key: string, handler: (...args: any[]) => unknown) => handlers.set(key, handler),
    on: (key: string, handler: (...args: any[]) => unknown) => handlers.set(key, handler),
    removeHandler: (key: string) => handlers.delete(key),
    removeListener: (key: string) => handlers.delete(key),
  },
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) },
}))
const { createNativeVoiceOverlayHost, VOICE_OVERLAY_COMMAND, VOICE_OVERLAY_STATE, VOICE_OVERLAY_LEVEL } = await import('../overlay-owner')
const context: RequestContext = { clientId: 'verified-client', workspaceId: 'ws', webContentsId: 17 }
const state: OverlayState = { recordingId: 'recording-one', phase: 'recording', elapsedMs: 1200, rms: 0, streaming: false }

describe('actual native overlay owner composition', () => {
  it('uses the server-bound child and owner command; refuses foreign sender, repeated stop and wrong recording', () => {
    const owner = new FakeWindow(); const commands: unknown[] = []
    let valid = true
    const port = createNativeVoiceOverlayHost({ resolveOwner: c => c === context && valid ? owner as never : null,
      sendCommand: (...args) => { commands.push(args); return true } })
    port.publish({ context, state, position: 'top', assertCurrent: () => { if (!valid) throw new Error('revoked') } })
    const child = children.at(-1)!
    expect(child.config.parent).toBe(owner); expect(child.config.y).toBe(16)
    expect(child.config.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true })
    expect(child.config.webPreferences.preload).toEndWith('voice-overlay-preload.cjs')
    expect(child.messages.at(-1)).toEqual([VOICE_OVERLAY_STATE, state]); expect(child.shown).toBe(1)
    const command = handlers.get(VOICE_OVERLAY_COMMAND)!
    expect(command({ sender: owner.webContents }, 'stop', state.recordingId)).toEqual({ ok: false })
    expect(command({ sender: child.webContents }, 'stop', 'another-recording')).toEqual({ ok: false })
    expect(command({ sender: child.webContents }, 'stop', state.recordingId)).toEqual({ ok: true })
    expect(command({ sender: child.webContents }, 'stop', state.recordingId)).toEqual({ ok: false })
    expect(commands).toEqual([[context, 'toggle', state.recordingId]])
    expect(command({ sender: child.webContents }, 'cancel', state.recordingId)).toEqual({ ok: true })
    expect(commands.at(-1)).toEqual([context, 'cancel', state.recordingId])
    expect(child.openHandler?.()).toEqual({ action: 'deny' })
    valid = false
    expect(command({ sender: child.webContents }, 'cancel', state.recordingId)).toEqual({ ok: false })
    port.publish({ context, state, position: 'top', assertCurrent: () => { throw new Error('revoked') } })
    expect(child.destroyed).toBe(true)
    expect(owner.listenerCount('focus')).toBe(0)
    port.dispose(); expect(handlers.size).toBe(0)
  })
  it('background actors never replace a live surface; the first publish appears unfocused and blur keeps it visible', () => {
    const owner = new FakeWindow(); const other = new FakeWindow(); other.focused = false
    const remote = { ...context, clientId: 'remote', webContentsId: null }
    const background = { ...context, clientId: 'other', webContentsId: 18 }
    const port = createNativeVoiceOverlayHost({ resolveOwner: c => c === context ? owner as never : c === background ? other as never : null, sendCommand: () => true })
    const before = children.length
    port.publish({ context: remote, state, position: 'bottom', assertCurrent() {} })
    expect(children).toHaveLength(before)
    // A capture started by the global hotkey publishes while the app is in the background:
    // the first surface must still appear, it cannot replace anything.
    owner.focused = false
    port.publish({ context, state, position: 'bottom', assertCurrent() {} })
    const child = children.at(-1)!
    expect(children).toHaveLength(before + 1)
    expect(child.shown).toBe(1)
    expect(child.isVisible()).toBe(true)
    // Another background owner never replaces the live surface.
    port.publish({ context: background, state, position: 'bottom', assertCurrent() {} })
    expect(children.at(-1)).toBe(child)
    // Blur neither hides the mini-window nor disables the surface's own controls.
    owner.emit('blur')
    expect(child.hidden).toBe(0); expect(child.isVisible()).toBe(true)
    const command = handlers.get(VOICE_OVERLAY_COMMAND)!
    expect(command({ sender: owner.webContents }, 'snapshot', null)).toEqual({ ok: false })
    expect(command({ sender: child.webContents }, 'snapshot', null)).toEqual({ ok: true, state })
    expect(command({ sender: owner.webContents }, 'stop', state.recordingId)).toEqual({ ok: false })
    expect(command({ sender: child.webContents }, 'stop', state.recordingId)).toEqual({ ok: true })
    expect(command({ sender: child.webContents }, 'stop', state.recordingId)).toEqual({ ok: false })
    port.retire('remote'); expect(child.destroyed).toBe(false)
    port.retire(context.clientId); expect(child.destroyed).toBe(true)
    port.dispose()
  })
  it('keeps showing the mini-window for any non-hidden phase after the owner loses focus and hides it once the phase becomes hidden', () => {
    const owner = new FakeWindow()
    const port = createNativeVoiceOverlayHost({ resolveOwner: c => c === context ? owner as never : null, sendCommand: () => true })
    port.publish({ context, state, position: 'top', assertCurrent() {} })
    const child = children.at(-1)!
    expect(child.shown).toBe(1); expect(child.isVisible()).toBe(true)
    owner.focused = false; owner.emit('blur')
    expect(child.hidden).toBe(0); expect(child.isVisible()).toBe(true)
    port.publish({ context, state: { ...state, phase: 'ready' }, position: 'top', assertCurrent() {} })
    expect(child.hidden).toBe(0); expect(child.isVisible()).toBe(true)
    owner.focused = true; owner.emit('focus')
    expect(child.shown).toBe(1)
    port.publish({ context, state: { ...state, phase: 'hidden' }, position: 'top', assertCurrent() {} })
    expect(child.destroyed).toBe(true)
    port.dispose()
  })
  it('drives mini-window visibility by the recording phase alone while the owner stays unfocused', () => {
    const owner = new FakeWindow()
    const port = createNativeVoiceOverlayHost({ resolveOwner: c => c === context ? owner as never : null, sendCommand: () => true })
    port.publish({ context, state, position: 'top', assertCurrent() {} })
    const child = children.at(-1)!
    owner.focused = false; owner.emit('blur')
    for (const phase of ['permission', 'recording', 'saving', 'transcribing', 'enhancing', 'ready'] as const) {
      port.publish({ context, state: { ...state, phase }, position: 'top', assertCurrent() {} })
      expect(child.hidden).toBe(0)
      expect(child.isVisible()).toBe(true)
      expect(child.messages.at(-1)).toEqual([VOICE_OVERLAY_STATE, { ...state, phase, rms: 0 }])
    }
    port.publish({ context, state: { ...state, phase: 'hidden' }, position: 'top', assertCurrent() {} })
    expect(child.destroyed).toBe(true)
    port.dispose()
  })
  it('forwards the owner level to the child, ignores foreign senders and clears it when the phase becomes hidden', () => {
    const owner = new FakeWindow()
    const port = createNativeVoiceOverlayHost({ resolveOwner: c => c === context ? owner as never : null, sendCommand: () => true })
    port.publish({ context, state, position: 'top', assertCurrent() {} })
    const child = children.at(-1)!
    const level = handlers.get(VOICE_OVERLAY_LEVEL)!
    expect(child.messages.at(-1)).toEqual([VOICE_OVERLAY_STATE, { ...state, rms: 0 }])
    level({ sender: owner.webContents }, 0.5)
    expect(child.messages.at(-1)).toEqual([VOICE_OVERLAY_STATE, { ...state, rms: 0.5 }])
    const foreign = new FakeWindow()
    level({ sender: foreign.webContents }, 0.9)
    expect(child.messages.at(-1)).toEqual([VOICE_OVERLAY_STATE, { ...state, rms: 0.5 }])
    level({ sender: owner.webContents }, Number.NaN)
    expect(child.messages.at(-1)).toEqual([VOICE_OVERLAY_STATE, { ...state, rms: 0.5 }])
    level({ sender: owner.webContents }, 2)
    expect(child.messages.at(-1)).toEqual([VOICE_OVERLAY_STATE, { ...state, rms: 1 }])
    level({ sender: owner.webContents }, -0.25)
    expect(child.messages.at(-1)).toEqual([VOICE_OVERLAY_STATE, { ...state, rms: 0 }])
    port.publish({ context, state: { ...state, phase: 'hidden' }, position: 'top', assertCurrent() {} })
    expect(child.destroyed).toBe(true)
    port.publish({ context, state: { ...state, recordingId: 'recording-two' }, position: 'top', assertCurrent() {} })
    const next = children.at(-1)!
    expect(next).not.toBe(child)
    expect(next.messages.at(-1)).toEqual([VOICE_OVERLAY_STATE, { ...state, recordingId: 'recording-two', rms: 0 }])
    port.dispose()
  })
})
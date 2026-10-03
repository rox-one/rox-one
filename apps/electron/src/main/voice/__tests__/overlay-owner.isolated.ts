import { describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { RequestContext } from '@rox/server-core/transport'
import type { OverlayState } from '@rox/shared/voice/overlay-types'

const handlers = new Map<string, (...args: any[]) => unknown>()
const children: FakeWindow[] = []
class FakeWindow extends EventEmitter {
  destroyed = false; focused = true; shown = 0; hidden = 0
  webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => this.destroyed,
    send: (...args: unknown[]) => this.messages.push(args),
    setWindowOpenHandler: (handler: () => unknown) => { this.openHandler = handler },
  })
  messages: unknown[][] = []; openHandler?: () => unknown
  constructor(readonly config: Record<string, any> = {}) { super(); if (config.parent) children.push(this) }
  isDestroyed() { return this.destroyed }
  isFocused() { return this.focused }
  getBounds() { return { x: 0, y: 0, width: 900, height: 800 } }
  showInactive() { this.shown++ }
  hide() { this.hidden++ }
  destroy() { this.destroyed = true; this.emit('closed') }
  async loadURL() {}
}
mock.module('electron', () => ({ app: { isPackaged: true }, BrowserWindow: FakeWindow,
  ipcMain: { handle: (key: string, handler: (...args: any[]) => unknown) => handlers.set(key, handler), removeHandler: (key: string) => handlers.delete(key) },
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) },
}))
const { createNativeVoiceOverlayHost, VOICE_OVERLAY_COMMAND, VOICE_OVERLAY_STATE } = await import('../overlay-owner')
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
  it('background and remote actors never create or replace another owner surface; blur/focus and retirement retain scope', () => {
    const owner = new FakeWindow(); const other = new FakeWindow(); other.focused = false
    const remote = { ...context, clientId: 'remote', webContentsId: null }
    const background = { ...context, clientId: 'other', webContentsId: 18 }
    const port = createNativeVoiceOverlayHost({ resolveOwner: c => c === context ? owner as never : c === background ? other as never : null, sendCommand: () => true })
    const before = children.length
    port.publish({ context: remote, state, position: 'bottom', assertCurrent() {} })
    port.publish({ context: background, state, position: 'bottom', assertCurrent() {} })
    expect(children).toHaveLength(before)
    port.publish({ context, state, position: 'bottom', assertCurrent() {} })
    const child = children.at(-1)!; const shown = child.shown
    port.publish({ context: background, state, position: 'bottom', assertCurrent() {} })
    expect(children.at(-1)).toBe(child)
    owner.focused = false; owner.emit('blur'); expect(child.hidden).toBeGreaterThan(0)
    expect(handlers.get(VOICE_OVERLAY_COMMAND)!({ sender: child.webContents }, 'stop', state.recordingId)).toEqual({ ok: false })
    owner.focused = true; owner.emit('focus'); expect(child.shown).toBe(shown + 1)
    port.retire('remote'); expect(child.destroyed).toBe(false)
    port.retire(context.clientId); expect(child.destroyed).toBe(true)
    port.dispose()
  })
})

import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import type { NativeVoiceOverlayHost } from '@rox/server-core/handlers'
import type { RequestContext } from '@rox/server-core/transport'
import type { OverlayState } from '@rox/shared/voice/overlay-types'

export const VOICE_OVERLAY_STATE = 'rox:owned-voice-overlay:state'
export const VOICE_OVERLAY_COMMAND = 'rox:owned-voice-overlay:command'
export const VOICE_OVERLAY_LEVEL = 'rox:owned-voice-overlay:level'

/** One private child surface for the current verified, foreground capture owner. */
export function createNativeVoiceOverlayHost(options: {
  resolveOwner(context: RequestContext): BrowserWindow | null
  sendCommand(context: RequestContext, command: 'toggle' | 'cancel', recordingId: string): boolean
}): NativeVoiceOverlayHost & { dispose(): void } {
  let child: BrowserWindow | null = null
  let owner: BrowserWindow | null = null
  let latest: Parameters<NativeVoiceOverlayHost['publish']>[0] | null = null
  let stopSent = false
  let cancelSent = false
  let terminalTimer: ReturnType<typeof setTimeout> | undefined
  const levels = new Map<number, number>()
  const disposeSurface = () => {
    if (terminalTimer) clearTimeout(terminalTimer)
    terminalTimer = undefined
    owner?.removeListener('focus', onFocus)
    owner?.removeListener('closed', onClosed)
    const old = child
    child = null; owner = null; latest = null; stopSent = false; cancelSent = false
    levels.clear()
    if (old && !old.isDestroyed()) old.destroy()
  }
  const currentOwner = () => {
    if (!latest || !owner || owner.isDestroyed() || owner.webContents.isDestroyed()) return false
    try { latest.assertCurrent() } catch { return false }
    return options.resolveOwner(latest.context) === owner
  }
  const sendState = () => {
    if (!currentOwner() || !child || child.isDestroyed()) { disposeSurface(); return }
    child.webContents.send(VOICE_OVERLAY_STATE, { ...latest!.state, rms: levels.get(owner!.webContents.id) ?? 0 })
    if (latest!.state.phase !== 'hidden') { if (!child.isVisible()) child.showInactive() }
    else { if (child.isVisible()) child.hide() }
  }
  function onFocus() { sendState() }
  function onClosed() { disposeSurface() }
  function onLevel(event: Electron.IpcMainEvent, level: unknown) {
    if (!currentOwner() || event.sender !== owner!.webContents) return
    if (typeof level !== 'number' || !Number.isFinite(level)) return
    levels.set(owner!.webContents.id, Math.min(1, Math.max(0, level)))
    sendState()
  }
  ipcMain.on(VOICE_OVERLAY_LEVEL, onLevel)
  ipcMain.handle(VOICE_OVERLAY_COMMAND, (event, action: unknown, recordingId: unknown) => {
    if (!child || child.isDestroyed() || event.sender !== child.webContents || !currentOwner()) return { ok: false }
    if (action === 'snapshot') return { ok: true, state: latest!.state }
    if (typeof recordingId !== 'string' || !recordingId || recordingId !== latest!.state.recordingId) return { ok: false }
    const phase = latest!.state.phase
    if (action === 'stop') {
      if (phase !== 'recording' || stopSent || cancelSent) return { ok: false }
      stopSent = true
      // A forward that never lands must not latch the command out: the surface
      // is still showing this recording, so a later stop for it must be allowed.
      const sent = options.sendCommand(latest!.context, 'toggle', recordingId)
      if (!sent) stopSent = false
      return { ok: sent }
    }
    if (action === 'cancel') {
      if (!['permission', 'recording', 'saving', 'transcribing', 'enhancing'].includes(phase) || cancelSent) return { ok: false }
      cancelSent = true
      const sent = options.sendCommand(latest!.context, 'cancel', recordingId)
      if (!sent) cancelSent = false
      return { ok: sent }
    }
    return { ok: false }
  })
  return {
    publish(input) {
      try { input.assertCurrent() } catch { this.retire(input.context.clientId); return }
      const nextOwner = options.resolveOwner(input.context)
      if (!nextOwner || nextOwner.isDestroyed() || nextOwner.webContents.isDestroyed()) { this.retire(input.context.clientId); return }
      if (input.state.phase === 'hidden') { this.retire(input.context.clientId); return }
      // A visible capture is never replaced by a background actor, but the first
      // surface must still appear while the app is in the background (hotkey paths).
      if (child && nextOwner !== owner && !nextOwner.isFocused()) return
      if (nextOwner !== owner || latest?.context.clientId !== input.context.clientId) disposeSurface()
      if (latest?.state.recordingId !== input.state.recordingId) { stopSent = false; cancelSent = false }
      latest = input
      if (!child) {
        owner = nextOwner
        owner.on('focus', onFocus); owner.on('closed', onClosed)
        const display = screen.getDisplayMatching(owner.getBounds())
        const width = 420, height = 72
        child = new BrowserWindow({ parent: owner, width, height,
          x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
          y: input.position === 'top' ? display.workArea.y + 16 : display.workArea.y + display.workArea.height - height - 24,
          frame: false, transparent: true, skipTaskbar: true, alwaysOnTop: true,
          focusable: false, show: false,
          webPreferences: { preload: join(__dirname, 'voice-overlay-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
        })
        const created = child
        created.webContents.on('will-navigate', event => event.preventDefault())
        created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        created.webContents.once('did-finish-load', () => { if (child === created) sendState() })
        created.once('closed', () => { if (child === created) disposeSurface() })
        // Packaged builds keep every renderer entry under dist/renderer next to main.cjs (see browser-pane-manager).
        const loading = app.isPackaged
          ? created.loadFile(join(__dirname, 'renderer', 'voice-overlay.html'))
          : created.loadURL(`${process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'}/voice-overlay.html`)
        void loading.catch(() => { if (child === created) disposeSurface() })
      }
      sendState()
      if (terminalTimer) clearTimeout(terminalTimer)
      terminalTimer = undefined
      if (input.state.phase === 'ready' || input.state.phase === 'error') terminalTimer = setTimeout(disposeSurface, 1500)
    },
    retire(clientId) { if (latest?.context.clientId === clientId) disposeSurface() },
    dispose() { disposeSurface(); ipcMain.removeListener(VOICE_OVERLAY_LEVEL, onLevel); ipcMain.removeHandler(VOICE_OVERLAY_COMMAND) },
  }
}

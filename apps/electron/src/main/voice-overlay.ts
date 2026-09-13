import { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  emptyVoiceOverlayState,
  parseVoiceOverlayState,
  VOICE_OVERLAY_IPC,
  type VoiceOverlayCommand,
  type VoiceOverlayState,
} from '../shared/voice-overlay-ipc'
import { loadVoicePrefs, type VoiceOverlayPosition } from '@craft-agent/shared/voice'

const OVERLAY_WIDTH = 360
const OVERLAY_HEIGHT = 56
export const VOICE_OVERLAY_TITLE = 'ROX Voice'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let overlay: BrowserWindow | null = null
let lastState: VoiceOverlayState = emptyVoiceOverlayState()
let ipcRegistered = false

function getIpcMain(): Electron.IpcMain {
  return (require('electron') as typeof import('electron')).ipcMain
}

function overlayUrl(): { kind: 'url' | 'file'; value: string } {
  if (VITE_DEV_SERVER_URL) {
    return { kind: 'url', value: `${VITE_DEV_SERVER_URL}/voice-overlay.html` }
  }
  return { kind: 'file', value: join(__dirname, 'renderer/voice-overlay.html') }
}

function overlayPreloadPath(): string {
  return join(__dirname, 'voice-overlay-preload.cjs')
}

export function isVoiceOverlayWindow(win: BrowserWindow | null): boolean {
  if (!win || win.isDestroyed()) return false
  return win.getTitle() === VOICE_OVERLAY_TITLE
}

export function registerVoiceOverlayIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  const ipcMain = getIpcMain()
  try {
    ipcMain.removeHandler(VOICE_OVERLAY_IPC.COMMAND)
  } catch {
    /* ignore */
  }
  ipcMain.handle(VOICE_OVERLAY_IPC.COMMAND, async (_event, action: unknown) => {
    if (action !== 'toggle' && action !== 'cancel') {
      throw new Error('Unknown voice overlay command')
    }
    const { sendVoiceCommand } = await import('./voice-hotkeys')
    sendVoiceCommand({ action: action as VoiceOverlayCommand })
    return { ok: true }
  })
}

export function pushVoiceOverlayState(state: VoiceOverlayState): void {
  lastState = state
  if (!overlay || overlay.isDestroyed() || overlay.webContents.isDestroyed()) return
  overlay.webContents.send(VOICE_OVERLAY_IPC.STATE, state)
}

export async function setVoiceOverlayVisible(visible: boolean, meter?: Partial<VoiceOverlayState>): Promise<void> {
  registerVoiceOverlayIpc()
  const next: VoiceOverlayState = {
    ...lastState,
    ...parseVoiceOverlayState({ ...meter, visible }),
    visible,
  }
  lastState = next
  if (!visible) {
    if (overlay && !overlay.isDestroyed()) overlay.hide()
    pushVoiceOverlayState(next)
    return
  }
  const win = await ensureOverlay()
  if (!win) return
  const { screen } = require('electron') as typeof import('electron')
  const display = screen.getPrimaryDisplay()
  const x = Math.round(display.workArea.x + (display.workArea.width - OVERLAY_WIDTH) / 2)
  const position: VoiceOverlayPosition = loadVoicePrefs().overlayPosition
  const y = position === 'bottom'
    ? Math.round(display.workArea.y + display.workArea.height - OVERLAY_HEIGHT - 24)
    : Math.round(display.workArea.y + 24)
  win.setPosition(x, y, false)
  win.showInactive()
  pushVoiceOverlayState(next)
}

async function ensureOverlay(): Promise<BrowserWindow | null> {
  if (overlay && !overlay.isDestroyed()) return overlay
  const preload = overlayPreloadPath()
  if (!existsSync(preload)) return null
  overlay = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    title: VOICE_OVERLAY_TITLE,
    hiddenInMissionControl: true,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlay.setIgnoreMouseEvents(false)
  overlay.on('closed', () => {
    overlay = null
  })
  overlay.webContents.on('did-finish-load', () => {
    pushVoiceOverlayState(lastState)
  })
  const target = overlayUrl()
  if (target.kind === 'url') {
    await overlay.loadURL(target.value)
  } else if (existsSync(target.value)) {
    await overlay.loadFile(target.value)
  }
  return overlay
}

export function destroyVoiceOverlay(): void {
  lastState = emptyVoiceOverlayState()
  if (overlay && !overlay.isDestroyed()) overlay.destroy()
  overlay = null
}

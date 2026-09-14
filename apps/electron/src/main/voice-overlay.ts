import { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  emptyVoiceOverlayState,
  isVoiceOverlayCommand,
  parseVoiceOverlayState,
  VOICE_OVERLAY_IPC,
  type VoiceOverlayCommand,
  type VoiceOverlayState,
} from '../shared/voice-overlay-ipc'
import { loadVoicePrefs, type VoiceOverlayPosition } from '@craft-agent/shared/voice'

const OVERLAY_WIDTH = 360
const OVERLAY_HEIGHT = 56
export const VOICE_OVERLAY_TITLE = 'ROX Voice'
export const MEETING_OVERLAY_WIDTH = 420
export const MEETING_OVERLAY_HEIGHT = 120

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let overlay: BrowserWindow | null = null
let lastState: VoiceOverlayState = emptyVoiceOverlayState()
let lastRendererState: unknown = lastState
let occupant: 'voice' | 'meeting' | null = null
let ipcRegistered = false
let commandOverride: ((action: VoiceOverlayCommand) => void) | null = null

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

export function getVoiceOverlayWindow(): BrowserWindow | null {
  return overlay && !overlay.isDestroyed() ? overlay : null
}

export function getVoiceOverlayOccupant(): 'voice' | 'meeting' | null {
  return occupant
}

export function setVoiceOverlayOccupant(kind: 'voice' | 'meeting' | null): void {
  occupant = kind
}

export function setOverlayCommandOverride(handler: ((action: VoiceOverlayCommand) => void) | null): void {
  commandOverride = handler
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
    if (!isVoiceOverlayCommand(action)) {
      throw new Error('Unknown voice overlay command')
    }
    if (commandOverride) {
      commandOverride(action)
      return { ok: true }
    }
    if (action !== 'toggle' && action !== 'cancel') {
      return { ok: true }
    }
    const { sendVoiceCommand } = await import('./voice-hotkeys')
    sendVoiceCommand({ action })
    return { ok: true }
  })
}

export function pushVoiceOverlayState(state: VoiceOverlayState): void {
  lastState = state
  lastRendererState = state
  sendRendererState(state)
}

export function pushOverlayRendererState(state: unknown): void {
  lastRendererState = state
  sendRendererState(state)
}

function sendRendererState(state: unknown): void {
  if (!overlay || overlay.isDestroyed() || overlay.webContents.isDestroyed()) return
  overlay.webContents.send(VOICE_OVERLAY_IPC.STATE, state)
}

export function positionVoiceOverlay(
  win: BrowserWindow,
  opts?: { position?: VoiceOverlayPosition; displayId?: number; width?: number; height?: number },
): { displayId?: number } {
  const { screen } = require('electron') as typeof import('electron')
  const displays = screen.getAllDisplays()
  const remembered = opts?.displayId === undefined
    ? undefined
    : displays.find((display) => display.id === opts.displayId)
  const display = remembered ?? screen.getPrimaryDisplay()
  const width = opts?.width ?? OVERLAY_WIDTH
  const height = opts?.height ?? OVERLAY_HEIGHT
  const position: VoiceOverlayPosition = opts?.position ?? loadVoicePrefs().overlayPosition
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2)
  const y = position === 'bottom'
    ? Math.round(display.workArea.y + display.workArea.height - height - 24)
    : Math.round(display.workArea.y + 24)
  win.setSize(width, height)
  win.setPosition(x, y, false)
  return { displayId: display.id }
}

export async function setVoiceOverlayVisible(visible: boolean, meter?: Partial<VoiceOverlayState>): Promise<void> {
  registerVoiceOverlayIpc()
  if (occupant === 'meeting' && visible) return
  const next: VoiceOverlayState = {
    ...lastState,
    ...parseVoiceOverlayState({ ...meter, visible }),
    visible,
  }
  lastState = next
  if (!visible) {
    if (occupant !== 'meeting' && overlay && !overlay.isDestroyed()) overlay.hide()
    pushVoiceOverlayState(next)
    return
  }
  occupant = 'voice'
  const win = await ensureOverlay()
  if (!win) return
  positionVoiceOverlay(win)
  win.showInactive()
  pushVoiceOverlayState(next)
}

export async function ensureVoiceOverlayWindow(): Promise<BrowserWindow | null> {
  return ensureOverlay()
}

export function hideVoiceOverlay(): void {
  if (overlay && !overlay.isDestroyed()) overlay.hide()
}

export function applyOverlayContentProtection(win: BrowserWindow): { attempted: boolean; supported: boolean } {
  try {
    win.setContentProtection(true)
    return { attempted: true, supported: process.platform === 'darwin' || process.platform === 'win32' }
  } catch {
    return { attempted: true, supported: false }
  }
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
    occupant = null
  })
  overlay.webContents.on('did-finish-load', () => {
    sendRendererState(lastRendererState)
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
  lastRendererState = lastState
  occupant = null
  commandOverride = null
  if (overlay && !overlay.isDestroyed()) overlay.destroy()
  overlay = null
}

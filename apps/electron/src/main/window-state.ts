import { resolveConfigDir } from '@rox/shared/config/paths'
import { existsSync, mkdirSync } from 'fs'
import { readJsonFileSync, atomicWriteFileSync } from '@rox/shared/utils/files'
import { mainLog } from './logger'
import { join } from 'path'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface SavedWindow {
  type: 'main'
  workspaceId: string
  bounds: WindowBounds
  focused?: boolean
  // Full URL captured from webContents.getURL() at quit time.
  // May be localhost (dev) or file:// (prod) — both are safe to store because
  // createWindow() never loads this URL directly. It extracts query params
  // (workspaceId, route, focused, etc.) and rebuilds the URL from __dirname
  // (prod) or the current dev server (dev). See window-manager.ts restoreUrl.
  url?: string
}

export interface WindowState {
  windows: SavedWindow[]
  lastFocusedWorkspaceId?: string
}

const WINDOW_STATE_FILE = join(resolveConfigDir(), 'window-state.json')

function isSavedWindow(value: unknown): value is SavedWindow {
  if (!value || typeof value !== 'object'
    || !('type' in value) || value.type !== 'main'
    || !('workspaceId' in value) || typeof value.workspaceId !== 'string' || value.workspaceId.length === 0
    || !('bounds' in value) || !value.bounds || typeof value.bounds !== 'object') {
    return false
  }

  const bounds = value.bounds
  if (!('x' in bounds) || !('y' in bounds) || !('width' in bounds) || !('height' in bounds)) {
    return false
  }
  const { x, y, width, height } = bounds
  if (typeof x !== 'number' || !Number.isFinite(x)
    || typeof y !== 'number' || !Number.isFinite(y)
    || typeof width !== 'number' || !Number.isFinite(width) || width <= 0
    || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    return false
  }

  if ('focused' in value && typeof value.focused !== 'boolean') return false
  if ('url' in value && typeof value.url !== 'string') return false
  return true
}

/**
 * Save the current window state (windows with bounds and type)
 */
export function saveWindowState(state: WindowState): boolean {
  try {
    // Ensure config directory exists
    if (!existsSync(resolveConfigDir())) {
      mkdirSync(resolveConfigDir(), { recursive: true })
    }

    atomicWriteFileSync(WINDOW_STATE_FILE, JSON.stringify(state, null, 2))
    mainLog.info('[WindowState] Saved window state:', state.windows.length, 'windows')
    return true
  } catch (error) {
    mainLog.error('[WindowState] Failed to save window state:', error)
    return false
  }
}

/**
 * Load the saved window state
 */
export function loadWindowState(): WindowState | null {
  try {
    if (!existsSync(WINDOW_STATE_FILE)) {
      return null
    }

    const raw = readJsonFileSync<unknown>(WINDOW_STATE_FILE)
    if (!raw || typeof raw !== 'object' || !('windows' in raw) || !Array.isArray(raw.windows)) {
      mainLog.warn('[WindowState] Invalid window state file, ignoring')
      return null
    }

    const windows = raw.windows.filter(isSavedWindow)
    if (windows.length !== raw.windows.length) {
      mainLog.warn('[WindowState] Ignored invalid saved window entries')
    }

    return {
      windows,
      ...('lastFocusedWorkspaceId' in raw && typeof raw.lastFocusedWorkspaceId === 'string'
        ? { lastFocusedWorkspaceId: raw.lastFocusedWorkspaceId }
        : {}),
    }
  } catch (error) {
    mainLog.error('[WindowState] Failed to load window state:', error)
    return null
  }
}

/**
 * Clear the saved window state
 */
export function clearWindowState(): void {
  try {
    if (existsSync(WINDOW_STATE_FILE)) {
      atomicWriteFileSync(WINDOW_STATE_FILE, JSON.stringify({ windows: [] }, null, 2))
      mainLog.info('[WindowState] Cleared window state')
    }
  } catch (error) {
    mainLog.error('[WindowState] Failed to clear window state:', error)
  }
}

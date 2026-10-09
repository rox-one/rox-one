/**
 * Finder / filesystem affordances for a user-visible path.
 *
 * Backs the `files:*` LOCAL_ONLY channels. Every entry point validates that the
 * caller passed a non-empty absolute path (after `~` expansion) and returns a
 * structured `{ ok, error? }` result — a bad path never throws to the renderer.
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { resolveAppIconPngPath } from './app-icon-paths'
import { closeQuickLook, quickLook } from './quicklook'

// Electron's clipboard/nativeImage/shell are loaded lazily so this module can be
// imported by unit tests without the real Electron runtime; the test-time
// `electron` mock then intercepts the dynamic import.
const electronApi = () => import('electron')

export interface FileActionResult {
  ok: boolean
  error?: string
}

/** Expand a leading `~` and require an absolute, NUL-free path. */
export function normalizeAbsolutePath(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed || trimmed.includes('\0')) return null
  const expanded = trimmed === '~'
    ? homedir()
    : trimmed.startsWith('~/')
      ? join(homedir(), trimmed.slice(2))
      : trimmed
  return isAbsolute(expanded) ? resolve(expanded) : null
}

export async function revealInFinder(input: unknown): Promise<FileActionResult> {
  const path = normalizeAbsolutePath(input)
  if (!path) return { ok: false, error: 'INVALID_PATH' }
  const { shell } = await electronApi()
  shell.showItemInFolder(path)
  return { ok: true }
}

export async function openPath(input: unknown): Promise<FileActionResult> {
  const path = normalizeAbsolutePath(input)
  if (!path) return { ok: false, error: 'INVALID_PATH' }
  const { shell } = await electronApi()
  const error = await shell.openPath(path)
  return error ? { ok: false, error } : { ok: true }
}

export async function copyPath(input: unknown): Promise<FileActionResult> {
  const path = normalizeAbsolutePath(input)
  if (!path) return { ok: false, error: 'INVALID_PATH' }
  const { clipboard } = await electronApi()
  clipboard.writeText(path)
  return { ok: true }
}

export function quickLookPath(input: unknown): FileActionResult {
  const path = normalizeAbsolutePath(input)
  if (!path) return { ok: false, error: 'INVALID_PATH' }
  return quickLook(path)
}

export function closeQuickLookPath(): FileActionResult {
  return closeQuickLook()
}

/**
 * Begin a native drag-out from the requesting window's webContents. The icon
 * is the caller-provided PNG when valid, else the app icon, else an empty image.
 */
export async function startDrag(
  webContents: Electron.WebContents | null | undefined,
  input: unknown,
): Promise<FileActionResult> {
  if (!webContents || webContents.isDestroyed()) return { ok: false, error: 'WINDOW_UNAVAILABLE' }
  const record = (input ?? {}) as { path?: unknown; iconPath?: unknown }
  const file = normalizeAbsolutePath(record.path)
  if (!file) return { ok: false, error: 'INVALID_PATH' }

  const { nativeImage } = await electronApi()
  const explicitIcon = normalizeAbsolutePath(record.iconPath)
  const icon = explicitIcon
    ? nativeImage.createFromPath(explicitIcon)
    : nativeImage.createFromPath(resolveAppIconPngPath() ?? '')
  try {
    webContents.startDrag({ file, icon: icon.isEmpty() ? nativeImage.createEmpty() : icon })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'DRAG_FAILED' }
  }
}
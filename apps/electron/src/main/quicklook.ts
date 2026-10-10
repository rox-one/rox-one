/**
 * macOS Quick Look bridge (`files:quickLook` / `files:quickLookClose`).
 *
 * `qlmanage -p` opens a Quick Look preview panel for a path. Only the most
 * recent preview is tracked: opening a new one first kills the previous child,
 * and `quickLookClose()` kills whatever is live. Non-darwin platforms report
 * `UNSUPPORTED_PLATFORM` instead of spawning a missing binary.
 */

import { spawn, type ChildProcess } from 'node:child_process'

let current: ChildProcess | null = null

export interface QuickLookResult {
  ok: boolean
  error?: string
}

export function quickLook(path: string): QuickLookResult {
  if (process.platform !== 'darwin') return { ok: false, error: 'UNSUPPORTED_PLATFORM' }
  closeQuickLook()
  try {
    const child = spawn('qlmanage', ['-p', path], { detached: true, stdio: 'ignore' })
    child.on('error', () => {
      if (current === child) current = null
    })
    child.on('exit', () => {
      if (current === child) current = null
    })
    // Detach so the parent event loop never waits on the preview panel.
    child.unref()
    current = child
    return { ok: true }
  } catch (error) {
    current = null
    return { ok: false, error: error instanceof Error ? error.message : 'QUICK_LOOK_FAILED' }
  }
}

export function closeQuickLook(): QuickLookResult {
  const child = current
  current = null
  if (child) {
    try {
      child.kill()
    } catch {
      // Already exited; nothing to close.
    }
  }
  return { ok: true }
}
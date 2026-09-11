/**
 * Crash-safe replace of dest with a fully-written tmp sibling.
 *
 * POSIX: rename(tmp, dest) replaces atomically; dest is never unlinked first,
 * so a crash mid-write leaves the original dest intact.
 *
 * WINDOWS RESIDUAL (follow-up, not this ship): rename cannot replace an existing
 * dest. The fallback is copyFile(tmp→dest) then unlink(tmp). A crash mid-copy
 * can tear dest while tmp still holds the complete journal; recoverSessionJournal
 * currently treats dest-exists as success and may delete tmp. Prefer Win32
 * ReplaceFile / rename-aside, or keep/promote tmp when dest is unreadable.
 * Tracked as ROX-001 follow-up — Mark authorized POSIX-first ship 2026-09-11.
 */
import { copyFile, rename, unlink } from 'fs/promises'
import { copyFileSync, renameSync, unlinkSync } from 'fs'

function isWindowsReplaceFailure(error: unknown): boolean {
  if (process.platform !== 'win32') return false
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPERM' || code === 'EEXIST' || code === 'EACCES'
}

export async function replaceFileAtomically(tmpPath: string, destPath: string): Promise<void> {
  try {
    await rename(tmpPath, destPath)
  } catch (error) {
    if (!isWindowsReplaceFailure(error)) throw error
    await copyFile(tmpPath, destPath)
    try { await unlink(tmpPath) } catch { /* dest already holds the new bytes */ }
  }
}

export function replaceFileAtomicallySync(tmpPath: string, destPath: string): void {
  try {
    renameSync(tmpPath, destPath)
  } catch (error) {
    if (!isWindowsReplaceFailure(error)) throw error
    copyFileSync(tmpPath, destPath)
    try { unlinkSync(tmpPath) } catch { /* dest already holds the new bytes */ }
  }
}

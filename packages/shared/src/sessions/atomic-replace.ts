/**
 * Crash-safe replace of dest with a fully-written tmp sibling.
 *
 * POSIX: rename(tmp, dest) replaces atomically; dest is never unlinked first,
 * so a crash mid-write leaves the original dest intact.
 * Windows: rename cannot replace an existing dest. Do not unlink dest first.
 * After tmp is complete, copyFile overwrites dest in place (dest stays present),
 * then tmp is removed.
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

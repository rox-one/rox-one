/**
 * Crash recovery for the session.jsonl replace protocol.
 *
 * dest exists: leftover dest.tmp is an orphan of a completed (or superseded)
 * replace and can be deleted.
 * dest missing + dest.tmp has a readable header: promote tmp → dest. That tmp
 * is the only copy — never delete it.
 */
import { existsSync, unlinkSync } from 'fs'
import { readSessionHeader } from './jsonl.ts'
import { replaceFileAtomicallySync } from './atomic-replace.ts'
import { debug } from '../utils/debug.ts'

export function recoverSessionJournal(destPath: string): boolean {
  const tmpPath = destPath + '.tmp'
  const destExists = existsSync(destPath)
  const tmpExists = existsSync(tmpPath)

  if (destExists) {
    if (tmpExists) {
      try { unlinkSync(tmpPath) } catch { /* leftover tmp after a successful replace */ }
    }
    return true
  }

  if (!tmpExists) return false

  // dest is gone. Only promote a tmp that parses as a valid journal header.
  // Never delete a tmp that is the only remaining copy, even if unreadable.
  if (!readSessionHeader(tmpPath)) return false

  try {
    replaceFileAtomicallySync(tmpPath, destPath)
    return existsSync(destPath)
  } catch (error) {
    debug('[journal-recover] Failed to promote session.jsonl.tmp:', destPath, error)
    return false
  }
}

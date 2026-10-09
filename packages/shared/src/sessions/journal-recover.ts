/**
 * Crash recovery for the session.jsonl replace protocol.
 *
 * Writers use per-writer tmp names (`session.jsonl.<pid>.<random>.tmp`), and the
 * legacy fixed name (`session.jsonl.tmp`) must keep working. Recovery therefore
 * considers the whole sibling family `session.jsonl*.tmp`:
 * - dest exists: reap only AGED tmps (> ORPHAN_TMP_MAX_AGE_MS), so a fresh
 *   in-flight write is never deleted. Several aged tmps may be reaped.
 * - dest missing: promote the NEWEST tmp that parses as a valid journal header.
 *   Never delete a tmp (it is the only remaining copy), and never throw.
 */
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, join } from 'path'
import { readSessionHeader } from './jsonl.ts'
import { replaceFileAtomicallySync } from './atomic-replace.ts'
import { debug } from '../utils/debug.ts'

const ORPHAN_TMP_MAX_AGE_MS = 5000

export function recoverSessionJournal(destPath: string): boolean {
  const destExists = existsSync(destPath)

  // Sibling tmp family: `<journal>*.tmp` (legacy `<journal>.tmp` plus per-writer
  // `<journal>.<pid>.<random>.tmp`). A missing sibling dir yields no candidates.
  const dir = dirname(destPath)
  const journalName = basename(destPath)
  let tmpPaths: string[] = []
  try {
    tmpPaths = readdirSync(dir)
      .filter((name) => name.startsWith(journalName) && name.endsWith('.tmp'))
      .map((name) => join(dir, name))
  } catch { /* missing/unreadable session dir: no candidates */ }

  if (destExists) {
    const now = Date.now()
    for (const tmpPath of tmpPaths) {
      // Never delete a fresh tmp: it may be an in-flight write whose rename has
      // not happened yet. Only reap an aged orphan.
      try {
        if (now - statSync(tmpPath).mtimeMs > ORPHAN_TMP_MAX_AGE_MS) {
          unlinkSync(tmpPath)
        }
      } catch { /* tmp vanished or is unreadable: leave it */ }
    }
    return true
  }

  // dest is gone. Promote the newest tmp that parses as a valid journal header.
  // Never delete a tmp that is the only remaining copy, even if unreadable.
  let newest: string | null = null
  let newestMtimeMs = -Infinity
  for (const tmpPath of tmpPaths) {
    try {
      const { mtimeMs } = statSync(tmpPath)
      if (mtimeMs <= newestMtimeMs) continue
      if (!readSessionHeader(tmpPath)) continue
      newest = tmpPath
      newestMtimeMs = mtimeMs
    } catch { /* vanished/unreadable: skip this candidate */ }
  }

  if (!newest) return false

  try {
    replaceFileAtomicallySync(newest, destPath)
    return existsSync(destPath)
  } catch (error) {
    debug('[journal-recover] Failed to promote session.jsonl tmp:', destPath, error)
    return false
  }
}
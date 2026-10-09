import { writeFile } from 'fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname } from 'path'
import type { StoredSession, SessionHeader } from './types.js'
import { getSessionFilePath, ensureSessionsDir, ensureSessionDir } from './storage.js'
import { toPortablePath } from '../utils/paths.js'
import { createSessionHeader, makeSessionPathPortable, readSessionHeader, rewriteSessionJsonlHeader } from './jsonl.js'
import { notifySessionJournalShadow } from './journal-shadow.js'
import { trySessionJournalPrimary } from './journal-primary.js'
import { replaceFileAtomically } from './atomic-replace.js'
import { debug } from '../utils/debug.js'

interface PendingWrite {
  data: StoredSession
  timer: ReturnType<typeof setTimeout>
}

interface HeaderMetadataSignature {
  projectId?: string
  projectIds?: string[]
  name?: string
  labels?: string[]
  isFlagged?: boolean
  sessionStatus?: string
  permissionMode?: string
  hasUnread?: boolean
  lastReadMessageId?: string
  owner?: unknown
  participants?: unknown
  visibility?: string
}

function getHeaderMetadataSignature(header: SessionHeader): string {
  const signature: HeaderMetadataSignature = {
    projectId: header.projectId,
    projectIds: header.projectIds,
    name: header.name,
    labels: header.labels,
    isFlagged: header.isFlagged,
    sessionStatus: header.sessionStatus,
    permissionMode: header.permissionMode,
    hasUnread: header.hasUnread,
    lastReadMessageId: header.lastReadMessageId,
    owner: header.owner,
    participants: header.participants,
    visibility: header.visibility,
  }
  return JSON.stringify(signature)
}

function mergeHeaderWithExternalMetadata(localHeader: SessionHeader, diskHeader: SessionHeader): SessionHeader {
  return {
    ...localHeader,
    projectId: diskHeader.projectId,
    projectIds: diskHeader.projectIds,
    name: diskHeader.name,
    labels: diskHeader.labels,
    isFlagged: diskHeader.isFlagged,
    sessionStatus: diskHeader.sessionStatus,
    permissionMode: diskHeader.permissionMode,
    hasUnread: diskHeader.hasUnread,
    lastReadMessageId: diskHeader.lastReadMessageId,
    owner: diskHeader.owner,
    participants: diskHeader.participants,
    visibility: diskHeader.visibility,
  }
}

/**
 * Debounced async session persistence queue.
 * Prevents main thread blocking by using async writes and coalescing
 * rapid successive persist calls into a single write.
 *
 * IMPORTANT: Writes are serialized per-session to prevent race conditions
 * when rapid successive flushes (e.g., clearSessionForRecovery + onSdkSessionIdUpdate)
 * would otherwise write to the same .tmp file concurrently.
 */
class SessionPersistenceQueue {
  private pending = new Map<string, PendingWrite>()
  private writeInProgress = new Map<string, Promise<void>>()
  private lastWrittenHeaderSignature = new Map<string, string>()
  private writeFailures = new Map<string, unknown>()
  /**
   * Session ids whose persistence was cancelled because the session is being
   * deleted. A late enqueue (for example the fs.watch metadata echo that fires
   * while the in-flight write lands) must not recreate the session on disk.
   */
  private sealed = new Set<string>()
  private debounceMs: number

  constructor(debounceMs = 500) {
    this.debounceMs = debounceMs
  }

  /**
   * Queue a session for persistence. If a write is already pending for this
   * session, it will be replaced with the new data and the timer reset.
   */
  enqueue(session: StoredSession): void {
    if (this.sealed.has(session.id)) {
      debug(`[PersistenceQueue] Ignoring enqueue for deleted session ${session.id}`)
      return
    }
    const existing = this.pending.get(session.id)
    if (existing) {
      clearTimeout(existing.timer)
    }

    const timer = setTimeout(() => {
      void this.runWrite(session.id)
    }, this.debounceMs)

    this.pending.set(session.id, { data: session, timer })
  }

  /**
   * Write a session to disk immediately in JSONL format.
   * Uses atomic write (write-to-temp-then-rename) to prevent corruption on crash.
   */
  private async write(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId)
    if (!entry) return

    this.pending.delete(sessionId)
    if (this.sealed.has(sessionId)) return

    try {
      const { data } = entry
      ensureSessionsDir(data.workspaceRootPath)
      ensureSessionDir(data.workspaceRootPath, sessionId)

      const filePath = getSessionFilePath(data.workspaceRootPath, sessionId)

      // Prepare session with portable paths for cross-machine compatibility
      const storageSession: StoredSession = {
        ...data,
        workspaceRootPath: toPortablePath(data.workspaceRootPath),
        workingDirectory: data.workingDirectory ? toPortablePath(data.workingDirectory) : undefined,
        sdkCwd: data.sdkCwd ? toPortablePath(data.sdkCwd) : undefined,
        lastUsedAt: Date.now(),
      }

      // Create JSONL content: header + messages (one per line)
      // Filter out intermediate messages - they're transient streaming status updates
      const localHeader = createSessionHeader(storageSession)
      const localSig = getHeaderMetadataSignature(localHeader)
      const diskHeader = readSessionHeader(filePath)
      const previousSig = this.lastWrittenHeaderSignature.get(sessionId)
      const diskSig = diskHeader ? getHeaderMetadataSignature(diskHeader) : undefined

      // Queue writes should never clobber session metadata changed externally
      // (watcher edits, direct header edits, other instances), but they must
      // still persist local metadata updates (e.g. generated title).
      //
      // Preserve disk metadata only when disk diverged from our last written
      // signature, which indicates an external mutation.
      const hasMetadataMismatch = !!diskHeader && !!diskSig && diskSig !== localSig
      const hasExternalMetadataChange = !!diskHeader && !!diskSig && !!previousSig && diskSig !== previousSig
      const header = hasExternalMetadataChange && diskHeader
        ? mergeHeaderWithExternalMetadata(localHeader, diskHeader)
        : localHeader

      if (hasMetadataMismatch) {
        const baseline = previousSig ? `, previousSig=${previousSig.slice(0, 12)}` : ', previousSig=<none>'
        const mode = hasExternalMetadataChange ? 'disk preserved' : 'local preserved'
        debug(`[PersistenceQueue] Session ${sessionId} metadata mismatch detected (${mode}${baseline})`)
      }

      const persistableMessages = storageSession.messages
      // Use original absolute sessionDir (before toPortablePath) for path replacement
      const sessionDir = dirname(filePath)
      const lines = [
        makeSessionPathPortable(JSON.stringify(header), sessionDir),
        ...persistableMessages.map(m => makeSessionPathPortable(JSON.stringify(m), sessionDir)),
      ]

      // Atomic write: write to .tmp then replace dest without unlinking it first.
      // If the process crashes mid-write, only the .tmp is corrupted —
      // the original session.jsonl remains intact.
      //
      // Update signature BEFORE the write so that fs.watch events fired
      // during replace are correctly identified as self-writes.
      // Without this, onSessionMetadataChange sees the stale signature
      // and reverts in-memory metadata on idle sessions.
      const finalSignature = getHeaderMetadataSignature(header)
      this.lastWrittenHeaderSignature.set(sessionId, finalSignature)

      const wrotePrimary = await trySessionJournalPrimary(sessionDir, lines)
      if (!wrotePrimary) {
        // Unique tmp per writer: two writers (or a concurrent crash-recovery
        // pass over the sibling tmp family) must not target one shared
        // session.jsonl.tmp, which can make this rename throw ENOENT and drop
        // the write.
        const tmpFile = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
        await writeFile(tmpFile, lines.join('\n') + '\n', 'utf-8')
        await replaceFileAtomically(tmpFile, filePath)
      }
      notifySessionJournalShadow(sessionDir, lines)
      this.writeFailures.delete(sessionId)
      debug(`[PersistenceQueue] Wrote session ${sessionId}${wrotePrimary ? ' (native primary)' : ''}`)
    } catch (error) {
      this.writeFailures.set(sessionId, error)
      console.error(`[PersistenceQueue] Failed to write session ${sessionId}:`, error)
    }
  }

  /**
   * Run write() through the per-session writeInProgress chain so debounce
   * and flush never share one .tmp concurrently.
   */
  private runWrite(sessionId: string): Promise<void> {
    const previous = this.writeInProgress.get(sessionId) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => this.write(sessionId))
    this.writeInProgress.set(sessionId, next)
    void next.finally(() => {
      if (this.writeInProgress.get(sessionId) === next) {
        this.writeInProgress.delete(sessionId)
      }
    })
    return next
  }

  /**
   * Immediately flush a specific session if pending.
   * Waits for any in-progress write to complete before starting a new one
   * to prevent race conditions on the shared .tmp file.
   *
   * Rejects with the recorded error if the awaited write failed, so callers
   * that rely on the session being durable (branching, export, transfer) never
   * proceed against a stale or missing file.
   */
  async flush(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId)
    if (entry) {
      clearTimeout(entry.timer)
      await this.runWrite(sessionId)
      this.throwIfWriteFailed(sessionId)
      return
    }
    const inProgress = this.writeInProgress.get(sessionId)
    if (inProgress) {
      await inProgress
      this.throwIfWriteFailed(sessionId)
    }
  }

  /**
   * Drop a queued write for a session without sealing it.
   *
   * Used before re-persisting externally-updated metadata: it discards the
   * stale pending snapshot (and our last-written signature so the fresh write
   * is compared against disk) while still allowing the immediate re-enqueue.
   * Unlike cancel(), this does not mark the session deleted.
   */
  dropPendingWrites(sessionId: string): void {
    const entry = this.pending.get(sessionId)
    if (entry) {
      clearTimeout(entry.timer)
      this.pending.delete(sessionId)
    }
    this.lastWrittenHeaderSignature.delete(sessionId)
  }

  /**
   * Cancel persistence for a session that is being deleted.
   *
   * Drops any queued write, invalidates our last-written signature, and seals
   * the session so a late enqueue (an fs.watch metadata echo arriving as the
   * in-flight write lands, a debounced timer) cannot recreate it on disk.
   *
   * Resolves once any in-flight write has settled. Callers MUST await this
   * before deleting the session files — otherwise an already-started write
   * would run after the delete and resurrect the session.
   */
  async cancel(sessionId: string): Promise<void> {
    this.dropPendingWrites(sessionId)
    this.writeFailures.delete(sessionId)
    this.sealed.add(sessionId)
    const inProgress = this.writeInProgress.get(sessionId)
    if (inProgress) await inProgress.catch(() => {})
    debug(`[PersistenceQueue] Cancelled pending write for session ${sessionId}`)
  }

  /**
   * Lift a deletion seal after the on-disk delete succeeded.
   *
   * Session ids are human-readable slugs regenerated from the set of existing
   * session directories (see slug-generator/storage), so once a deleted
   * session's directory is gone its id becomes available again. If the seal
   * outlived the deletion, a later session that legitimately reuses the id
   * (createSession / getOrCreateSessionById -> saveSession -> enqueue) would be
   * dropped silently by enqueue()/write() and never hit disk.
   *
   * Callers MUST only unseal after the on-disk delete returned success. A
   * failed delete leaves the tombstone in place so a late fs.watch metadata
   * echo cannot resurrect the (still present) file.
   */
  unseal(sessionId: string): void {
    if (this.sealed.delete(sessionId)) {
      debug(`[PersistenceQueue] Unsealed session ${sessionId} after successful delete`)
    }
  }

  /**
   * Flush all pending sessions. Call this on app quit.
   *
   * Waits for EVERY queued write (Promise.allSettled) before returning, so one
   * failing session can no longer abort the wait and truncate the flush of the
   * remaining sessions during shutdown. Once all writes have settled the
   * failures are aggregated into a single visible warning/error.
   */
  async flushAll(): Promise<void> {
    const sessionIds = [...this.pending.keys()]
    if (sessionIds.length === 0) return

    const results = await Promise.allSettled(sessionIds.map(id => this.flush(id)))
    const failures = results
      .map((result, index) => (result.status === 'rejected' ? { id: sessionIds[index]!, error: result.reason } : null))
      .filter((entry): entry is { id: string; error: unknown } => entry !== null)

    if (failures.length > 0) {
      const detail = failures
        .map(({ id, error }) => `${id}: ${error instanceof Error ? error.message : String(error)}`)
        .join('; ')
      console.warn(`[PersistenceQueue] flushAll: ${failures.length}/${sessionIds.length} session write(s) failed: ${detail}`)
      throw new Error(`Failed to flush ${failures.length} of ${sessionIds.length} pending session write(s): ${detail}`)
    }
  }

  /**
   * Check if a session has a pending write.
   */
  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId)
  }

  /**
   * Get the metadata signature of the last header we wrote for a session.
   * Used by ConfigWatcher to suppress self-triggered metadata change events.
   */
  getLastWrittenSignature(sessionId: string): string | undefined {
    return this.lastWrittenHeaderSignature.get(sessionId)
  }

  /**
   * Get count of pending writes.
   */
  get pendingCount(): number {
    return this.pending.size
  }
  private throwIfWriteFailed(sessionId: string): void {
    const failure = this.writeFailures.get(sessionId)
    if (failure !== undefined) throw failure
  }

  private serialize(sessionId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.writeInProgress.get(sessionId)
    const next = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(operation)
    this.writeInProgress.set(sessionId, next)
    void next.then(
      () => {
        if (this.writeInProgress.get(sessionId) === next) {
          this.writeInProgress.delete(sessionId)
        }
      },
      () => {
        if (this.writeInProgress.get(sessionId) === next) {
          this.writeInProgress.delete(sessionId)
        }
      },
    )
    return next
  }

  async updateSessionHeader(
    sessionId: string,
    workspaceRootPath: string,
    patch: Partial<SessionHeader>,
  ): Promise<void> {
    await this.flush(sessionId)
    this.throwIfWriteFailed(sessionId)

    await this.serialize(sessionId, async () => {
      // A full snapshot may have been queued while this update waited.
      const pending = this.pending.get(sessionId)
      if (pending) {
        clearTimeout(pending.timer)
        await this.write(sessionId)
        this.throwIfWriteFailed(sessionId)
      }

      ensureSessionsDir(workspaceRootPath)
      ensureSessionDir(workspaceRootPath, sessionId)
      const filePath = getSessionFilePath(workspaceRootPath, sessionId)
      const previousSignature = this.lastWrittenHeaderSignature.get(sessionId)
      try {
        await rewriteSessionJsonlHeader(
          filePath,
          header => ({ ...header, ...patch }),
          header => {
            this.lastWrittenHeaderSignature.set(sessionId, getHeaderMetadataSignature(header))
          },
        )
      } catch (error) {
        if (previousSignature === undefined) {
          this.lastWrittenHeaderSignature.delete(sessionId)
        } else {
          this.lastWrittenHeaderSignature.set(sessionId, previousSignature)
        }
        throw error
      }
      debug(`[PersistenceQueue] Updated session ${sessionId} header`)
    })
  }

}

// Singleton instance
export const sessionPersistenceQueue = new SessionPersistenceQueue()

// Named exports for testing/customization
export { SessionPersistenceQueue, getHeaderMetadataSignature, mergeHeaderWithExternalMetadata }

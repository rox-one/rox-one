/**
 * Automatic, incremental foreign chat import.
 *
 * Runs in the background (Electron main process only): shortly after startup
 * and then periodically, it rescans the supported local chat sources
 * (Claude Code, Codex, Cursor, Grok, ChatGPT/DeepSeek exports, …) with an
 * mtime-based cache, imports new recent chats and appends new turns to chats
 * that were already imported. The scan yields to the event loop so the app
 * never freezes; persistence runs in batches (ADR-0025) that yield between
 * each other and stop on abort. Settings + last status live in `<workspace>/.rox/`.
 */

import { getActiveWorkspace, getWorkspaceByNameOrId } from '@rox/shared/config'
import {
  discoverForeignSessionsAsync,
  loadForeignImportRegistry,
  persistForeignSessions,
  type ForeignAutoImportStatus,
  type ForeignImportMode,
  type ForeignIndexEntry,
  type ForeignPersistIo,
  type ForeignPersistResult,
} from '@rox/shared/sessions'
import type { HandlerDeps } from '../handler-deps'
import { readAutoImportFile, writeAutoImportFile } from './session-foreign-auto-import-storage'

export const AUTO_IMPORT_RECENT_DAYS = 30
export const AUTO_IMPORT_MAX_PER_RUN = 150
const STARTUP_DELAY_MS = 20_000
const INTERVAL_MS = 15 * 60_000

interface AutoImportWorkspace {
  id: string
  rootPath: string
}

export interface ForeignAutoImporterOptions {
  /** Home directory whose chat roots are scanned; defaults to the OS home. */
  homeDir?: string
  resolveWorkspace?: (workspaceId?: string) => AutoImportWorkspace | null | undefined
  persistIo?: Partial<ForeignPersistIo>
}

function emptyStatus(workspaceId: string | null, enabled: boolean): ForeignAutoImportStatus {
  return {
    workspaceId,
    enabled,
    state: enabled ? 'idle' : 'disabled',
    found: 0,
    alreadyImported: 0,
    imported: 0,
    updated: 0,
    remaining: 0,
    bySource: {},
    failed: 0,
    failureReasons: {},
    truncated: false,
    lastRunAt: null,
  }
}

/** Hand one persisted batch to the session list: one ingest and one `sessions_imported` event. */
export function ingestPersistedBatch(deps: HandlerDeps, workspaceId: string, batch: readonly ForeignPersistResult[]): void {
  const sessionIds = batch.flatMap((result) =>
    result.sessionId && (result.action === 'created' || result.action === 'appended' || result.action === 'replaced')
      ? [result.sessionId]
      : [],
  )
  if (sessionIds.length === 0) return
  try {
    deps.sessionManager.ingestImportedSessions(workspaceId, sessionIds)
  } catch {
    // Persisted sessions remain available; list refresh can happen on the next load.
  }
}

function countResult(status: ForeignAutoImportStatus, result: ForeignPersistResult): void {
  if (result.sessionId && (result.action === 'created' || result.action === 'appended')) {
    if (result.action === 'created') {
      status.imported += 1
      status.alreadyImported += 1
    } else {
      status.updated += 1
    }
  } else if (result.reason !== 'already-imported' && result.reason !== 'source-unchanged') {
    const reason = result.reason ?? 'import-failed'
    status.failed += 1
    status.remaining += 1
    status.failureReasons[reason] = (status.failureReasons[reason] ?? 0) + 1
  }
}

export class ForeignAutoImporter {
  private running = new Map<string, Promise<ForeignAutoImportStatus>>()
  /** One automatic run at a time across all workspaces. */
  private lane: Promise<unknown> = Promise.resolve()
  private controllers = new Map<string, AbortController>()
  private live = new Map<string, ForeignAutoImportStatus>()
  private timers: ReturnType<typeof setTimeout>[] = []
  private consentRevision = new Map<string, number>()
  constructor(
    private readonly deps: HandlerDeps,
    private readonly options: ForeignAutoImporterOptions = {},
  ) {}

  private resolveWorkspace(workspaceId?: string): AutoImportWorkspace | null | undefined {
    if (this.options.resolveWorkspace) return this.options.resolveWorkspace(workspaceId)
    return workspaceId ? getWorkspaceByNameOrId(workspaceId) : getActiveWorkspace()
  }

  isEnabled(workspaceRoot: string): boolean {
    return readAutoImportFile(workspaceRoot).enabled === true
  }

  status(workspaceId?: string): ForeignAutoImportStatus {
    const workspace = this.resolveWorkspace(workspaceId)
    if (!workspace) return emptyStatus(null, false)
    const live = this.live.get(workspace.id)
    if (live) return live
    const file = readAutoImportFile(workspace.rootPath)
    const enabled = file.enabled === true
    const base = emptyStatus(workspace.id, enabled)
    const saved = file.status ?? {}
    return {
      ...base,
      ...saved,
      workspaceId: workspace.id,
      enabled,
      state: saved.state === 'partial'
        ? 'partial'
        : !enabled
          ? 'disabled'
          : saved.state === 'error'
            ? 'error'
            : saved.lastRunAt
              ? 'done'
              : 'idle',
      lastRunAt: file.lastRunAt ?? saved.lastRunAt ?? null,
    }
  }

  setEnabled(workspaceId: string | undefined, enabled: boolean): ForeignAutoImportStatus {
    const workspace = this.resolveWorkspace(workspaceId)
    if (!workspace) throw new Error('sessions.foreignAutoSet: workspace not found')
    const file = readAutoImportFile(workspace.rootPath)
    writeAutoImportFile(workspace.rootPath, { ...file, enabled })
    if (!enabled) {
      this.consentRevision.set(workspace.id, (this.consentRevision.get(workspace.id) ?? 0) + 1)
      this.controllers.get(workspace.id)?.abort()
    }
    const live = this.live.get(workspace.id)
    if (live && !enabled) {
      live.enabled = false
      live.state = 'partial'
    }
    if (enabled) void this.run({ workspaceId: workspace.id })
    return this.status(workspace.id)
  }

  /**
   * Run one incremental import pass. Runs are de-duplicated per workspace and
   * never overlap across workspaces; `signal` stops the pass between batches.
   */
  run(opts: { workspaceId?: string; all?: boolean; force?: boolean; signal?: AbortSignal } = {}): Promise<ForeignAutoImportStatus> {
    const workspace = this.resolveWorkspace(opts.workspaceId)
    if (!workspace) return Promise.resolve(emptyStatus(null, false))
    const active = this.running.get(workspace.id)
    if (active) return active
    const run = this.lane
      .then(() => this.runOnce({ ...opts, workspaceId: workspace.id }))
      .finally(() => {
        if (this.running.get(workspace.id) === run) this.running.delete(workspace.id)
      })
    this.lane = run.catch(() => {})
    this.running.set(workspace.id, run)
    return run
  }

  private async runOnce(opts: { workspaceId?: string; all?: boolean; force?: boolean; signal?: AbortSignal }): Promise<ForeignAutoImportStatus> {
    const workspace = this.resolveWorkspace(opts.workspaceId)
    if (!workspace) return emptyStatus(null, false)
    const root = workspace.rootPath
    const enabled = this.isEnabled(root)
    if (!enabled && !opts.force) return this.status(workspace.id)
    const consentRevision = this.consentRevision.get(workspace.id) ?? 0
    const consentHeld = () => (this.consentRevision.get(workspace.id) ?? 0) === consentRevision
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (opts.signal?.aborted) abort()
    opts.signal?.addEventListener('abort', abort, { once: true })
    this.controllers.set(workspace.id, controller)

    const status: ForeignAutoImportStatus = {
      ...this.status(workspace.id),
      enabled,
      state: 'scanning',
      error: undefined,
      failed: 0,
      failureReasons: {},
      truncated: false,
      partialReason: undefined,
      imported: 0,
      updated: 0,
    }
    this.live.set(workspace.id, status)
    try {
      const scan = await discoverForeignSessionsAsync({
        workspaceRoot: root,
        homeDir: this.options.homeDir,
        reuseCache: true,
        shouldContinue: () => !controller.signal.aborted && consentHeld() && (enabled || opts.force === true),
      })
      const importable = scan.entries.filter((entry) => entry.userTurns > 0 && !entry.skipReason)
      const registry = loadForeignImportRegistry(root)
      const bySource: Record<string, number> = {}
      for (const entry of importable) bySource[entry.kind] = (bySource[entry.kind] ?? 0) + 1
      if (scan.aborted) {
        Object.assign(status, {
          state: 'partial' as const,
          found: importable.length,
          bySource,
          remaining: importable.length,
          truncated: scan.truncated ?? false,
          partialReason: consentHeld() ? undefined : 'consent-revoked' as const,
          lastRunAt: Date.now(),
        })
        writeAutoImportFile(root, { ...readAutoImportFile(root), lastRunAt: status.lastRunAt, status: { ...status } })
        return status
      }

      const recentCutoff = Date.now() - AUTO_IMPORT_RECENT_DAYS * 24 * 60 * 60_000
      const fresh: ForeignIndexEntry[] = []
      const changed: ForeignIndexEntry[] = []
      let older = 0
      for (const entry of importable) {
        const record = registry[entry.sourcePath]
        if (record) {
          // Grok sources are directories, so their own mtime misses edits to the
          // chat_history file inside. Re-fingerprint those snapshots on each opt-in pass.
          const shouldRefresh =
            entry.kind === 'grok' ||
            (entry.mtimeMs !== undefined && entry.mtimeMs > (record.sourceMtimeMs ?? record.importedAt))
          if (shouldRefresh) changed.push(entry)
          continue
        }
        if (opts.all || (entry.mtimeMs ?? 0) >= recentCutoff) fresh.push(entry)
        else older += 1
      }
      fresh.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
      const limit = opts.all ? Number.POSITIVE_INFINITY : AUTO_IMPORT_MAX_PER_RUN
      const toCreate = fresh.slice(0, limit)
      const overLimit = fresh.length - toCreate.length

      Object.assign(status, {
        state: 'importing' as const,
        found: importable.length,
        alreadyImported: importable.length - fresh.length - older,
        remaining: older + overLimit + (scan.truncated ? 1 : 0),
        bySource,
        truncated: scan.truncated ?? false,
      })

      const work: Array<{ sourcePath: string; mode: ForeignImportMode }> = [
        ...changed.map((entry) => ({ sourcePath: entry.sourcePath, mode: 'append' as const })),
        ...toCreate.map((entry) => ({ sourcePath: entry.sourcePath, mode: 'skip' as const })),
      ]
      const results = await persistForeignSessions(root, work, 'skip', this.options.homeDir, {
        signal: controller.signal,
        registry,
        scanEntries: scan.entries,
        io: this.options.persistIo,
        onBatch: (batch) => {
          for (const result of batch) countResult(status, result)
          ingestPersistedBatch(this.deps, workspace.id, batch)
        },
      })
      const interrupted = results.length < work.length
      if (interrupted) status.remaining += work.length - results.length

      const lastRunAt = Date.now()
      const partialReason = interrupted && !consentHeld()
        ? 'consent-revoked'
        : status.failed > 0
          ? 'source-failure'
          : scan.truncated
            ? 'scan-truncated'
            : undefined
      const state = interrupted || partialReason ? 'partial' : 'done'
      Object.assign(status, { state, partialReason, lastRunAt })
      writeAutoImportFile(root, { ...readAutoImportFile(root), lastRunAt, status: { ...status } })
    } catch (error) {
      Object.assign(status, { state: 'error' as const, error: error instanceof Error ? error.message : String(error) })
      writeAutoImportFile(root, { ...readAutoImportFile(root), status: { ...status } })
    } finally {
      this.live.delete(workspace.id)
      opts.signal?.removeEventListener('abort', abort)
      if (this.controllers.get(workspace.id) === controller) this.controllers.delete(workspace.id)
    }
    return this.status(workspace.id)
  }

  /** Background schedule: once after startup, then every INTERVAL_MS. */
  start(): void {
    if (this.timers.length > 0) return
    const tick = () => {
      void this.run().catch(() => {})
    }
    const first = setTimeout(tick, STARTUP_DELAY_MS)
    const repeat = setInterval(tick, INTERVAL_MS)
    ;(first as { unref?: () => void }).unref?.()
    ;(repeat as { unref?: () => void }).unref?.()
    this.timers.push(first, repeat as unknown as ReturnType<typeof setTimeout>)
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
    for (const controller of this.controllers.values()) controller.abort()
  }
}

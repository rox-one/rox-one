/**
 * Automatic, incremental foreign chat import.
 *
 * Runs in the background (Electron main process only): shortly after startup
 * and then periodically, it rescans the supported local chat sources
 * (Claude Code, Codex, Cursor, Grok, ChatGPT/DeepSeek exports, …) with an
 * mtime-based cache, imports new recent chats and appends new turns to chats
 * that were already imported. The scan yields to the event loop so the app
 * never freezes. Settings + last status live in `<workspace>/.rox/`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getActiveWorkspace, getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  discoverForeignSessionsAsync,
  loadForeignImportRegistry,
  persistForeignSession,
  type ForeignAutoImportStatus,
  type ForeignIndexEntry,
} from '@craft-agent/shared/sessions'
import type { HandlerDeps } from '../handler-deps'

export const AUTO_IMPORT_RECENT_DAYS = 30
export const AUTO_IMPORT_MAX_PER_RUN = 150
const STARTUP_DELAY_MS = 20_000
const INTERVAL_MS = 15 * 60_000

interface AutoImportFile {
  enabled?: boolean
  lastRunAt?: number | null
  status?: Partial<ForeignAutoImportStatus>
}

function autoImportPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.rox', 'foreign-auto-import.json')
}

function readAutoImportFile(workspaceRoot: string): AutoImportFile {
  const path = autoImportPath(workspaceRoot)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AutoImportFile
  } catch {
    return {}
  }
}

function writeAutoImportFile(workspaceRoot: string, data: AutoImportFile): void {
  const path = autoImportPath(workspaceRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
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

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

export class ForeignAutoImporter {
  private running = new Map<string, Promise<ForeignAutoImportStatus>>()
  private live = new Map<string, ForeignAutoImportStatus>()
  private timers: ReturnType<typeof setTimeout>[] = []
  private consentRevision = new Map<string, number>()
  constructor(private readonly deps: HandlerDeps) {}

  private resolveWorkspace(workspaceId?: string) {
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
    if (!enabled) this.consentRevision.set(workspace.id, (this.consentRevision.get(workspace.id) ?? 0) + 1)
    const live = this.live.get(workspace.id)
    if (live && !enabled) {
      live.enabled = false
      live.state = 'partial'
    }
    if (enabled) void this.run({ workspaceId: workspace.id })
    return this.status(workspace.id)
  }

  /** Run one incremental import pass; runs are de-duplicated per workspace. */
  run(opts: { workspaceId?: string; all?: boolean; force?: boolean } = {}): Promise<ForeignAutoImportStatus> {
    const workspace = this.resolveWorkspace(opts.workspaceId)
    if (!workspace) return Promise.resolve(emptyStatus(null, false))
    const active = this.running.get(workspace.id)
    if (active) return active
    const run = this.runOnce({ ...opts, workspaceId: workspace.id }).finally(() => {
      if (this.running.get(workspace.id) === run) this.running.delete(workspace.id)
    })
    this.running.set(workspace.id, run)
    return run
  }

  private async runOnce(opts: { workspaceId?: string; all?: boolean; force?: boolean }): Promise<ForeignAutoImportStatus> {
    const workspace = this.resolveWorkspace(opts.workspaceId)
    if (!workspace) return emptyStatus(null, false)
    const root = workspace.rootPath
    const enabled = this.isEnabled(root)
    if (!enabled && !opts.force) return this.status(workspace.id)
    const consentRevision = this.consentRevision.get(workspace.id) ?? 0

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
        reuseCache: true,
        shouldContinue: () =>
          (this.consentRevision.get(workspace.id) ?? 0) === consentRevision &&
          (enabled || opts.force === true),
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
          partialReason: 'consent-revoked' as const,
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

      const work: Array<{ entry: ForeignIndexEntry; mode: 'skip' | 'append' }> = [
        ...changed.map((entry) => ({ entry, mode: 'append' as const })),
        ...toCreate.map((entry) => ({ entry, mode: 'skip' as const })),
      ]
      let interrupted = false
      let processed = 0
      for (const { entry, mode } of work) {
        if ((this.consentRevision.get(workspace.id) ?? 0) !== consentRevision) {
          interrupted = true
          status.remaining += work.length - processed
          break
        }
        try {
          const result = await persistForeignSession({ workspaceRoot: root, sourcePath: entry.sourcePath, mode })
          if (result.sessionId && (result.action === 'created' || result.action === 'appended')) {
            if (result.action === 'created') {
              status.imported += 1
              status.alreadyImported += 1
            } else {
              status.updated += 1
            }
            try {
              this.deps.sessionManager.ingestImportedSession(workspace.id, result.sessionId)
              this.deps.sessionManager.notifySessionCreated(workspace.id, result.sessionId)
            } catch {
              // The session file is durable; refresh notification may be retried separately.
            }
          } else if (result.reason !== 'already-imported' && result.reason !== 'source-unchanged') {
            const reason = result.reason ?? 'import-failed'
            status.failed += 1
            status.remaining += 1
            status.failureReasons[reason] = (status.failureReasons[reason] ?? 0) + 1
          }
        } catch {
          status.failed += 1
          status.remaining += 1
          status.failureReasons['import-failed'] = (status.failureReasons['import-failed'] ?? 0) + 1
        }
        processed += 1
        await yieldToLoop()
      }

      const lastRunAt = Date.now()
      const partialReason = interrupted
        ? 'consent-revoked'
        : status.failed > 0
          ? 'source-failure'
          : scan.truncated
            ? 'scan-truncated'
            : undefined
      const state = partialReason ? 'partial' : 'done'
      Object.assign(status, { state, partialReason, lastRunAt })
      writeAutoImportFile(root, { ...readAutoImportFile(root), lastRunAt, status: { ...status } })
    } catch (error) {
      Object.assign(status, { state: 'error' as const, error: error instanceof Error ? error.message : String(error) })
      writeAutoImportFile(root, { ...readAutoImportFile(root), status: { ...status } })
    } finally {
      this.live.delete(workspace.id)
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
  }
}

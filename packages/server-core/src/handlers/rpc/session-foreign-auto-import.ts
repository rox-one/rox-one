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
    lastRunAt: null,
  }
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

export class ForeignAutoImporter {
  private running: Promise<ForeignAutoImportStatus> | null = null
  private live = new Map<string, ForeignAutoImportStatus>()
  private timers: ReturnType<typeof setTimeout>[] = []

  constructor(private readonly deps: HandlerDeps) {}

  private resolveWorkspace(workspaceId?: string) {
    return workspaceId ? getWorkspaceByNameOrId(workspaceId) : getActiveWorkspace()
  }

  isEnabled(workspaceRoot: string): boolean {
    return readAutoImportFile(workspaceRoot).enabled !== false
  }

  status(workspaceId?: string): ForeignAutoImportStatus {
    const workspace = this.resolveWorkspace(workspaceId)
    if (!workspace) return emptyStatus(null, false)
    const live = this.live.get(workspace.id)
    if (live) return live
    const file = readAutoImportFile(workspace.rootPath)
    const enabled = file.enabled !== false
    const base = emptyStatus(workspace.id, enabled)
    const saved = file.status ?? {}
    return {
      ...base,
      ...saved,
      workspaceId: workspace.id,
      enabled,
      state: !enabled ? 'disabled' : saved.state === 'error' ? 'error' : saved.lastRunAt ? 'done' : 'idle',
      lastRunAt: file.lastRunAt ?? saved.lastRunAt ?? null,
    }
  }

  setEnabled(workspaceId: string | undefined, enabled: boolean): ForeignAutoImportStatus {
    const workspace = this.resolveWorkspace(workspaceId)
    if (!workspace) throw new Error('sessions.foreignAutoSet: workspace not found')
    const file = readAutoImportFile(workspace.rootPath)
    writeAutoImportFile(workspace.rootPath, { ...file, enabled })
    this.live.delete(workspace.id)
    if (enabled) void this.run({ workspaceId: workspace.id })
    return this.status(workspace.id)
  }

  /** Run one incremental import pass. Concurrent calls share the same run. */
  run(opts: { workspaceId?: string; all?: boolean; force?: boolean } = {}): Promise<ForeignAutoImportStatus> {
    if (this.running) return this.running
    this.running = this.runOnce(opts).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async runOnce(opts: { workspaceId?: string; all?: boolean; force?: boolean }): Promise<ForeignAutoImportStatus> {
    const workspace = this.resolveWorkspace(opts.workspaceId)
    if (!workspace) return emptyStatus(null, false)
    const root = workspace.rootPath
    const file = readAutoImportFile(root)
    const enabled = file.enabled !== false
    if (!enabled && !opts.force && !opts.all) return this.status(workspace.id)

    const status: ForeignAutoImportStatus = { ...this.status(workspace.id), state: 'scanning', error: undefined, imported: 0, updated: 0 }
    this.live.set(workspace.id, status)
    try {
      const scan = await discoverForeignSessionsAsync({ workspaceRoot: root, reuseCache: true })
      const importable = scan.entries.filter((entry) => entry.userTurns > 0 && !entry.skipReason)
      const registry = loadForeignImportRegistry(root)
      const bySource: Record<string, number> = {}
      for (const entry of importable) bySource[entry.kind] = (bySource[entry.kind] ?? 0) + 1

      const recentCutoff = Date.now() - AUTO_IMPORT_RECENT_DAYS * 24 * 60 * 60_000
      const fresh: ForeignIndexEntry[] = []
      const changed: ForeignIndexEntry[] = []
      let older = 0
      for (const entry of importable) {
        const record = registry[entry.sourcePath]
        if (record) {
          if (entry.mtimeMs !== undefined && entry.mtimeMs > record.importedAt) changed.push(entry)
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
        remaining: older + overLimit,
        bySource,
      })

      const work: Array<{ entry: ForeignIndexEntry; mode: 'skip' | 'append' }> = [
        ...changed.map((entry) => ({ entry, mode: 'append' as const })),
        ...toCreate.map((entry) => ({ entry, mode: 'skip' as const })),
      ]
      for (const { entry, mode } of work) {
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
              // Session list refresh is best-effort; the file is already on disk.
            }
          }
        } catch (error) {
          this.deps.platform.logger?.warn?.('[foreign-auto-import] persist failed', entry.sourcePath, error)
        }
        await yieldToLoop()
      }

      const lastRunAt = Date.now()
      Object.assign(status, { state: 'done' as const, lastRunAt })
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

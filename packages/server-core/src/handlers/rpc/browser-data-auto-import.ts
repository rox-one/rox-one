/** Repeated history/bookmark import is bound to one explicitly authorized profile. */
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWriteFileSync } from '@craft-agent/shared/utils/files'
import type { BrowserDataAutoStatus } from '@craft-agent/shared/browser/profile-import'
import type { BrowserImportCategory } from '@craft-agent/shared/environment'

interface Workspace { id: string; rootPath: string }
interface StoredData {
  enabled?: boolean
  profileId?: string
  imported?: { history: number; bookmarks: number }
  lastRunAt?: number
  error?: string
}
interface AutoImportDependencies {
  workspace: (id: string) => Workspace | null
  workspaceIds?: () => readonly string[]
  isBusy?: (workspaceId: string) => boolean
  preferences: () => readonly BrowserImportCategory[]
  importData: (workspace: Workspace, profileId: string, categories: { history: boolean; bookmarks: boolean }) => { history: number; bookmarks: number }
}

interface AutoImportScheduler {
  setTimeout: typeof setTimeout
  setInterval: typeof setInterval
  clearTimeout: typeof clearTimeout
  clearInterval: typeof clearInterval
}

const scheduler: AutoImportScheduler = { setTimeout, setInterval, clearTimeout, clearInterval }
const errorCodes = new Set(['browser-data-snapshot-busy', 'browser-data-read-failed', 'browser-bookmarks-format-unsupported', 'browser-profile-unavailable'])
function validProfileId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && /^(chromium|firefox|safari):[^\r\n\0]+$/.test(value)
}
function safeError(error: unknown): string {
  return error instanceof Error && errorCodes.has(error.message) ? error.message : 'browser-data-read-failed'
}

function statePath(root: string): string { return join(root, '.rox', 'browser-data-auto-import.json') }
function readState(root: string): StoredData {
  try {
    const path = statePath(root)
    if (!existsSync(path)) return {}
    const raw = JSON.parse(readFileSync(path, 'utf8')) as StoredData
    if (!raw || typeof raw !== 'object') return {}
    return {
      enabled: raw.enabled === true && validProfileId(raw.profileId),
      profileId: validProfileId(raw.profileId) ? raw.profileId : undefined,
      lastRunAt: typeof raw.lastRunAt === 'number' && Number.isFinite(raw.lastRunAt) && raw.lastRunAt >= 0 ? raw.lastRunAt : undefined,
      imported: raw.imported && Number.isSafeInteger(raw.imported.history) && raw.imported.history >= 0 && Number.isSafeInteger(raw.imported.bookmarks) && raw.imported.bookmarks >= 0 ? raw.imported : undefined,
      error: typeof raw.error === 'string' && errorCodes.has(raw.error) ? raw.error : undefined,
    }
  } catch { return {} }
}
function writeState(root: string, data: StoredData): void {
  const path = statePath(root)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  atomicWriteFileSync(path, JSON.stringify(data, null, 2), { durable: true })
  chmodSync(path, 0o600)
}

export class BrowserDataAutoImporter {
  private readonly workspaces = new Set<string>()
  private readonly running = new Set<string>()
  private readonly failures = new Map<string, string>()
  private firstTimer?: ReturnType<typeof setTimeout>
  private repeatTimer?: ReturnType<typeof setInterval>
  constructor(private readonly deps: AutoImportDependencies, private readonly clock: AutoImportScheduler = scheduler) {}

  status(workspaceId: string): BrowserDataAutoStatus {
    const workspace = this.deps.workspace(workspaceId)
    if (!workspace) {
      this.workspaces.delete(workspaceId)
      this.failures.delete(workspaceId)
      return { workspaceId: null, enabled: false, profileId: null, state: 'off', imported: { history: 0, bookmarks: 0 }, lastRunAt: null }
    }
    this.workspaces.add(workspaceId)
    const stored = readState(workspace.rootPath)
    const enabled = stored.enabled === true && Boolean(stored.profileId)
    const error = this.failures.get(workspaceId) ?? stored.error
    return {
      workspaceId, enabled, profileId: stored.profileId ?? null,
      state: !enabled ? 'off' : error ? 'error' : stored.lastRunAt ? 'done' : 'idle',
      imported: stored.imported ?? { history: 0, bookmarks: 0 }, lastRunAt: stored.lastRunAt ?? null, error,
    }
  }

  set(workspaceId: string, enabled: boolean, profileId?: string): BrowserDataAutoStatus {
    const workspace = this.deps.workspace(workspaceId)
    if (!workspace) throw new Error('browser-workspace-unavailable')
    const stored = readState(workspace.rootPath)
    const selected = profileId ?? stored.profileId
    if (enabled && !validProfileId(selected)) throw new Error('browser-profile-unavailable')
    // Counts from the old profile do not describe the newly selected profile.
    writeState(workspace.rootPath, { ...(selected === stored.profileId ? stored : {}), enabled, profileId: selected, error: undefined })
    this.failures.delete(workspaceId)
    this.workspaces.add(workspaceId)
    return enabled ? this.run(workspaceId) : this.status(workspaceId)
  }

  run(workspaceId: string): BrowserDataAutoStatus {
    const workspace = this.deps.workspace(workspaceId)
    if (!workspace) return this.status(workspaceId)
    if (this.running.has(workspaceId) || this.deps.isBusy?.(workspaceId)) return this.status(workspaceId)
    const stored = readState(workspace.rootPath)
    if (!stored.enabled || !stored.profileId) return this.status(workspaceId)
    this.running.add(workspaceId)
    try {
      // Every pass rechecks the saved preference, including explicit empty/skipped choices.
      const categories = this.deps.preferences()
      const history = categories.includes('history'), bookmarks = categories.includes('bookmarks')
      if (!history && !bookmarks) return this.status(workspaceId)
      const imported = this.deps.importData(workspace, stored.profileId, { history, bookmarks })
      writeState(workspace.rootPath, { ...stored, imported, lastRunAt: Date.now(), error: undefined })
      this.failures.delete(workspaceId)
    } catch (error) {
      const code = safeError(error)
      this.failures.set(workspaceId, code)
      // A full or unwritable workspace must not prevent other workspaces from running.
      try { writeState(workspace.rootPath, { ...stored, lastRunAt: Date.now(), error: code }) } catch {}
    } finally {
      this.running.delete(workspaceId)
    }
    return this.status(workspaceId)
  }

  start(workspaceIds: readonly string[]): void {
    for (const id of workspaceIds) this.workspaces.add(id)
    if (this.repeatTimer !== undefined) return
    const tick = () => {
      try { for (const id of this.deps.workspaceIds?.() ?? []) this.workspaces.add(id) } catch {}
      for (const id of this.workspaces) {
        try { this.run(id) } catch (error) { this.failures.set(id, safeError(error)) }
      }
    }
    this.firstTimer = this.clock.setTimeout(tick, 25_000)
    this.repeatTimer = this.clock.setInterval(tick, 15 * 60_000)
    this.firstTimer.unref?.(); this.repeatTimer.unref?.()
  }

  stop(): void {
    if (this.firstTimer !== undefined) this.clock.clearTimeout(this.firstTimer)
    if (this.repeatTimer !== undefined) this.clock.clearInterval(this.repeatTimer)
    this.firstTimer = undefined
    this.repeatTimer = undefined
  }
}

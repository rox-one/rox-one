/** Repeated history/bookmark import is bound to one explicitly authorized profile. */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
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
  preferences: () => readonly BrowserImportCategory[]
  importData: (workspace: Workspace, profileId: string, categories: { history: boolean; bookmarks: boolean }) => { history: number; bookmarks: number }
}

function statePath(root: string): string { return join(root, '.rox', 'browser-data-auto-import.json') }
function readState(root: string): StoredData {
  try {
    const path = statePath(root)
    if (!existsSync(path)) return {}
    const raw = JSON.parse(readFileSync(path, 'utf8')) as StoredData
    if (!raw || typeof raw !== 'object') return {}
    return {
      enabled: raw.enabled === true,
      profileId: typeof raw.profileId === 'string' ? raw.profileId : undefined,
      lastRunAt: typeof raw.lastRunAt === 'number' && Number.isFinite(raw.lastRunAt) ? raw.lastRunAt : undefined,
      imported: raw.imported && Number.isSafeInteger(raw.imported.history) && Number.isSafeInteger(raw.imported.bookmarks) ? raw.imported : undefined,
      error: typeof raw.error === 'string' ? raw.error : undefined,
    }
  } catch { return {} }
}
function writeState(root: string, data: StoredData): void {
  const path = statePath(root)
  mkdirSync(dirname(path), { recursive: true })
  atomicWriteFileSync(path, JSON.stringify(data, null, 2))
}

export class BrowserDataAutoImporter {
  private readonly workspaces = new Set<string>()
  private readonly timers: ReturnType<typeof setTimeout>[] = []
  constructor(private readonly deps: AutoImportDependencies) {}

  status(workspaceId: string): BrowserDataAutoStatus {
    const workspace = this.deps.workspace(workspaceId)
    if (!workspace) return { workspaceId: null, enabled: false, profileId: null, state: 'off', imported: { history: 0, bookmarks: 0 }, lastRunAt: null }
    this.workspaces.add(workspaceId)
    const stored = readState(workspace.rootPath)
    const enabled = stored.enabled === true && Boolean(stored.profileId)
    return {
      workspaceId, enabled, profileId: stored.profileId ?? null,
      state: !enabled ? 'off' : stored.error ? 'error' : stored.lastRunAt ? 'done' : 'idle',
      imported: stored.imported ?? { history: 0, bookmarks: 0 }, lastRunAt: stored.lastRunAt ?? null, error: stored.error,
    }
  }

  set(workspaceId: string, enabled: boolean, profileId?: string): BrowserDataAutoStatus {
    const workspace = this.deps.workspace(workspaceId)
    if (!workspace) throw new Error('browser-workspace-unavailable')
    const stored = readState(workspace.rootPath)
    const selected = profileId ?? stored.profileId
    if (enabled && (!selected || !/^(chromium|firefox|safari):.+/.test(selected))) throw new Error('browser-profile-unavailable')
    writeState(workspace.rootPath, { ...stored, enabled, profileId: selected, error: undefined })
    this.workspaces.add(workspaceId)
    return enabled ? this.run(workspaceId) : this.status(workspaceId)
  }

  run(workspaceId: string): BrowserDataAutoStatus {
    const workspace = this.deps.workspace(workspaceId)
    if (!workspace) return this.status(workspaceId)
    const stored = readState(workspace.rootPath)
    if (!stored.enabled || !stored.profileId) return this.status(workspaceId)
    // Every pass rechecks the saved preference, including explicit empty/skipped choices.
    const categories = this.deps.preferences()
    const history = categories.includes('history'), bookmarks = categories.includes('bookmarks')
    if (!history && !bookmarks) return this.status(workspaceId)
    try {
      const imported = this.deps.importData(workspace, stored.profileId, { history, bookmarks })
      writeState(workspace.rootPath, { ...stored, imported, lastRunAt: Date.now(), error: undefined })
    } catch (error) {
      const code = error instanceof Error && ['browser-data-snapshot-busy', 'browser-data-read-failed', 'browser-bookmarks-format-unsupported', 'browser-profile-unavailable'].includes(error.message)
        ? error.message : 'browser-data-read-failed'
      writeState(workspace.rootPath, { ...stored, lastRunAt: Date.now(), error: code })
    }
    return this.status(workspaceId)
  }

  start(workspaceIds: readonly string[]): void {
    for (const id of workspaceIds) this.workspaces.add(id)
    if (this.timers.length) return
    const tick = () => { for (const id of this.workspaces) this.run(id) }
    const first = setTimeout(tick, 25_000), repeat = setInterval(tick, 15 * 60_000)
    first.unref?.(); repeat.unref?.()
    this.timers.push(first, repeat)
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.length = 0
  }
}

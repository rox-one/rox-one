/**
 * Dev Space auto-watch (P6/D3 v1.x levers "В8" watch + "В11" auto-regeneration; closed 2026-10-10).
 *
 * No daemon, no separate process: the sweep lives in the app process, defers a
 * first run (STARTUP_DELAY), then repeats on a fixed cadence. Both timers are
 * `unref()`'d so watching never keeps the host alive, and the handle's `stop()`
 * aborts in-flight git work. Every step is wrapped so a tick NEVER throws.
 *
 * Consent model: `watchEnabled === true` is an explicit per-repository opt-in to
 * background network git operations for that repository only. Watching refreshes
 * remote-tracking refs and (only with `watchAutoPull`) fast-forwards the working
 * copy. Auto-regeneration is a further per-repo opt-in (`watchRegenerate`, В11):
 * after a successful fast-forward the tick awaits the injected `regenerate` sink
 * under try/catch — a failure is audited, never fatal. Cadence is per-repo
 * (`watchIntervalMs`) enforced against `lastWatchAt`.
 */
import type { DevSpaceRepositoryRecord, DevSpaceRepositoryStatus } from '@rox/shared/dev-space'
import { DEV_SPACE_WATCH_DEFAULT_INTERVAL_MS } from '@rox/shared/dev-space'
import { CloneError, readGitTrackingState, runGitFetch, runGitPull } from './clone.ts'
import type { GitFetchInput, GitTrackingInput, GitTrackingState } from './clone.ts'

/** First sweep is deferred so startup is not fought by network git work (browser-intel precedent). */
export const DEV_SPACE_WATCH_STARTUP_DELAY_MS = 30_000
/** Base cadence: equals the minimum accepted per-repo interval, so a due repo is never late by more than this. */
export const DEV_SPACE_WATCH_TICK_MS = DEV_SPACE_WATCH_DEFAULT_INTERVAL_MS

/** Catalog shape as owned by `dev-space.ts`; structurally compatible, kept private to avoid a cycle. */
export interface DevSpaceWatchCatalog {
  schemaVersion: 1
  repositories: DevSpaceRepositoryRecord[]
}

export interface DevSpaceWatchWorkspace {
  readonly id: string
  readonly rootPath: string
}

export interface DevSpaceWatchDeps {
  /** Workspace roots to sweep; production passes the host's accessible workspaces. */
  readonly listWorkspaces: () => readonly DevSpaceWatchWorkspace[]
  readonly readCatalog: (root: string) => Promise<DevSpaceWatchCatalog>
  readonly writeCatalog: (root: string, catalog: DevSpaceWatchCatalog) => Promise<void>
  /** Absolute working copy for a repo, or null when it has no git working copy to fetch. */
  readonly workingDirectoryFor: (root: string, record: DevSpaceRepositoryRecord) => string | null
  /** Catalog-change notification; the tick only fires it when a status actually moved. */
  readonly pushChanged: (workspaceId: string, repositoryId: string, status: DevSpaceRepositoryStatus) => void
  readonly resolveToken?: (workspaceId: string, repositoryId: string) => Promise<string | null>
  /**
   * Auto-regeneration sink (В11): refresh the snapshot and run the pipeline for
   * a repository whose fast-forward just succeeded. Only invoked for a record
   * carrying `watchEnabled && watchAutoPull && watchRegenerate`. The signal is
   * the handle's own controller, so `stop()` aborts an in-flight regeneration's
   * git work exactly like any other tick. Absent means watching never
   * regenerates — the pre-В11 behaviour.
   */
  readonly regenerate?: (record: DevSpaceRepositoryRecord, signal: AbortSignal) => Promise<void>
  /** Best-effort audit sink for the regeneration trail; a failure here never affects the tick. */
  readonly audit?: (root: string, projectSlug: string, event: Record<string, unknown>) => Promise<void>
  readonly now?: () => number
  readonly fetch?: (input: GitFetchInput) => Promise<void>
  readonly pull?: (input: GitFetchInput) => Promise<void>
  readonly readTracking?: (input: GitTrackingInput) => Promise<GitTrackingState>
  readonly startupDelayMs?: number
  readonly tickIntervalMs?: number
  readonly log?: (message: string, error?: unknown) => void
}

export interface DevSpaceWatchHandle {
  /** One sweep, awaited; safe to call directly (tests) and re-entrancy guarded. */
  tick(): Promise<void>
  /** Abort in-flight git work and clear both timers; idempotent. */
  stop(): void
}

function omitError(record: DevSpaceRepositoryRecord): DevSpaceRepositoryRecord {
  const next: DevSpaceRepositoryRecord = { ...record }
  Reflect.deleteProperty(next, 'lastError')
  return next
}

/** Default sink: watching is best-effort, so silence unless the host injects a logger. */
const NOOP_LOG = (): void => { /* no-op */ }

export function startDevSpaceWatch(deps: DevSpaceWatchDeps): DevSpaceWatchHandle {
  const controller = new AbortController()
  const now = deps.now ?? Date.now
  const fetch = deps.fetch ?? runGitFetch
  const pull = deps.pull ?? runGitPull
  const readTracking = deps.readTracking ?? readGitTrackingState
  const startupDelayMs = deps.startupDelayMs ?? DEV_SPACE_WATCH_STARTUP_DELAY_MS
  const tickIntervalMs = deps.tickIntervalMs ?? DEV_SPACE_WATCH_TICK_MS
  const log = deps.log ?? NOOP_LOG

  let stopped = false
  let ticking = false
  let startupTimer: ReturnType<typeof setTimeout> | null = null
  let intervalTimer: ReturnType<typeof setInterval> | null = null

  async function resolveToken(record: DevSpaceRepositoryRecord): Promise<string | null> {
    if (!deps.resolveToken) return null
    try {
      return await deps.resolveToken(record.workspaceId, record.repositoryId)
    } catch (error) {
      log('token resolution failed; fetching anonymously', error)
      return null
    }
  }

  /**
   * Inspect one opted-in repository: fetch, compare local `HEAD` with `@{u}`,
   * and (optionally) fast-forward. Returns the next record plus whether a pull
   * actually ran to success, or a null record when the repository has no
   * working copy. Never throws.
   */
  async function inspect(root: string, record: DevSpaceRepositoryRecord, at: number): Promise<{ next: DevSpaceRepositoryRecord | null; pulled: boolean }> {
    const workingDirectory = deps.workingDirectoryFor(root, record)
    if (workingDirectory === null) return { next: null, pulled: false }
    const token = await resolveToken(record)
    try {
      await fetch({ workingDirectory, repositoryId: record.repositoryId, token, signal: controller.signal })
    } catch (error) {
      const code = error instanceof CloneError ? error.code : 'fetch-failed'
      return { next: { ...record, lastWatchAt: at, lastError: { code, at } }, pulled: false }
    }

    let head: string
    let upstream: string | null
    try {
      const state = await readTracking({ workingDirectory, signal: controller.signal })
      head = state.head
      upstream = state.upstream
    } catch (error) {
      const code = error instanceof CloneError ? error.code : 'tracking-unavailable'
      return { next: { ...record, lastWatchAt: at, lastError: { code, at } }, pulled: false }
    }

    const behind = upstream !== null && upstream !== head
    if (behind && upstream !== null) {
      let next: DevSpaceRepositoryRecord = {
        ...omitError(record), status: 'stale', lastWatchAt: at, lastRemoteHead: upstream,
      }
      let pulled = false
      if (record.watchAutoPull === true) {
        try {
          await pull({ workingDirectory, repositoryId: record.repositoryId, token, signal: controller.signal })
          pulled = true
        } catch (error) {
          const code = error instanceof CloneError ? error.code : 'pull-failed'
          next = { ...next, lastError: { code, at } }
        }
      }
      return { next, pulled }
    }

    return { next: { ...omitError(record), lastWatchAt: at, ...(upstream !== null ? { lastRemoteHead: upstream } : {}) }, pulled: false }
  }

  /** Regeneration is audited but never fatal to the tick (В11). */
  async function audit(root: string, projectSlug: string, event: Record<string, unknown>): Promise<void> {
    try {
      await deps.audit?.(root, projectSlug, event)
    } catch (error) {
      log(`watch audit failed for ${projectSlug}`, error)
    }
  }

  async function regenerate(root: string, record: DevSpaceRepositoryRecord): Promise<void> {
    if (!deps.regenerate) return
    await audit(root, record.projectSlug, { event: 'watch-regenerate-started', repositoryId: record.repositoryId })
    try {
      await deps.regenerate(record, controller.signal)
      await audit(root, record.projectSlug, { event: 'watch-regenerate-succeeded', repositoryId: record.repositoryId })
    } catch (error) {
      log(`watch regeneration failed for ${record.repositoryId}`, error)
      await audit(root, record.projectSlug, { event: 'watch-regenerate-failed', repositoryId: record.repositoryId })
    }
  }

  async function tick(): Promise<void> {
    if (stopped || ticking) return
    ticking = true
    try {
      for (const workspace of deps.listWorkspaces()) {
        if (stopped) return
        let catalog: DevSpaceWatchCatalog
        try {
          catalog = await deps.readCatalog(workspace.rootPath)
        } catch (error) {
          log(`catalog read failed for workspace ${workspace.id}`, error)
          continue
        }
        let changed = false
        // Regeneration runs only after the sweep's catalog write, so the
        // refresh+pipeline observe the freshly persisted record instead of
        // clobbering this tick's status/lastWatchAt.
        const regenerations: DevSpaceRepositoryRecord[] = []
        for (const record of catalog.repositories) {
          if (stopped) break
          if (record.watchEnabled !== true) continue
          const at = now()
          const interval = record.watchIntervalMs ?? DEV_SPACE_WATCH_DEFAULT_INTERVAL_MS
          if (record.lastWatchAt !== undefined && at - record.lastWatchAt < interval) continue
          const wantsRegenerate = record.watchEnabled === true && record.watchAutoPull === true && record.watchRegenerate === true
          let inspected: { next: DevSpaceRepositoryRecord | null; pulled: boolean }
          try {
            inspected = await inspect(workspace.rootPath, record, at)
          } catch (error) {
            log(`watch inspection threw for ${record.repositoryId}`, error)
            continue
          }
          const next = inspected.next
          if (next === null) continue
          if (next.status !== record.status) deps.pushChanged(record.workspaceId, record.repositoryId, next.status)
          catalog.repositories = catalog.repositories.map((entry) => (entry.id === next.id ? next : entry))
          changed = true
          if (inspected.pulled && wantsRegenerate) regenerations.push(next)
        }
        if (changed) {
          try {
            await deps.writeCatalog(workspace.rootPath, catalog)
          } catch (error) {
            log(`catalog write failed for workspace ${workspace.id}`, error)
          }
        }
        for (const record of regenerations) {
          if (stopped) break
          await regenerate(workspace.rootPath, record)
        }
      }
    } catch (error) {
      // A sweep must never crash the host — the timer survives a bad tick.
      log('watch tick failed', error)
    } finally {
      ticking = false
    }
  }

  const runTick = (): void => {
    void tick().catch((error) => log('watch tick rejected', error))
  }

  if (startupDelayMs > 0) {
    startupTimer = setTimeout(() => {
      startupTimer = null
      runTick()
    }, startupDelayMs)
    startupTimer.unref?.()
  }
  intervalTimer = setInterval(runTick, tickIntervalMs)
  intervalTimer.unref?.()

  return {
    tick,
    stop() {
      if (stopped) return
      stopped = true
      controller.abort()
      if (startupTimer) {
        clearTimeout(startupTimer)
        startupTimer = null
      }
      if (intervalTimer) {
        clearInterval(intervalTimer)
        intervalTimer = null
      }
    },
  }
}
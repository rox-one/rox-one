import { afterEach, describe, expect, it } from 'bun:test'
import type { DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import {
  DEV_SPACE_WATCH_DEFAULT_INTERVAL_MS, DEV_SPACE_WATCH_MAX_INTERVAL_MS, DEV_SPACE_WATCH_MIN_INTERVAL_MS,
  isValidDevSpaceWatchInterval,
} from '@rox/shared/dev-space'
import { CloneError } from '../clone.ts'
import type { GitFetchInput, GitTrackingInput, GitTrackingState } from '../clone.ts'
import { startDevSpaceWatch, type DevSpaceWatchCatalog, type DevSpaceWatchHandle } from '../watch.ts'

const ROOT = '/ws'
const WORKDIR = `${ROOT}/projects/demo/repo`

function record(overrides: Partial<DevSpaceRepositoryRecord> = {}): DevSpaceRepositoryRecord {
  return {
    schemaVersion: 1,
    id: 'devrepo_a',
    repositoryId: 'repo_a',
    workspaceId: 'ws',
    projectId: 'p1',
    projectSlug: 'demo',
    origin: { kind: 'git-url', url: 'https://github.com/rox/one.git', provider: 'github' },
    displayName: 'one',
    status: 'ready',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

interface Harness {
  readonly catalog: DevSpaceWatchCatalog
  readonly fetchCalls: GitFetchInput[]
  readonly pullCalls: GitFetchInput[]
  readonly pushes: Array<{ workspaceId: string; repositoryId: string; status: string }>
  readonly writes: DevSpaceWatchCatalog[]
  readonly regenerations: DevSpaceRepositoryRecord[]
  readonly regenerateSignals: AbortSignal[]
  readonly audits: Array<{ root: string; projectSlug: string; event: Record<string, unknown> }>
  readonly handle: DevSpaceWatchHandle
  tick(): Promise<void>
}

const handles: Array<{ stop(): void }> = []
afterEach(() => { for (const handle of handles.splice(0)) handle.stop() })

function harness(options: {
  records: DevSpaceRepositoryRecord[]
  tracking?: (input: GitTrackingInput) => Promise<GitTrackingState>
  fetch?: (input: GitFetchInput) => Promise<void>
  pull?: (input: GitFetchInput) => Promise<void>
  regenerate?: (record: DevSpaceRepositoryRecord, signal: AbortSignal) => Promise<void>
  /** Simulates a host that composed no regeneration sink at all. */
  omitRegenerate?: boolean
  now?: number
  startupDelayMs?: number
}): Harness {
  const catalog: DevSpaceWatchCatalog = { schemaVersion: 1, repositories: [...options.records] }
  const fetchCalls: GitFetchInput[] = []
  const pullCalls: GitFetchInput[] = []
  const pushes: Harness['pushes'] = []
  const writes: DevSpaceWatchCatalog[] = []
  const regenerations: DevSpaceRepositoryRecord[] = []
  const regenerateSignals: AbortSignal[] = []
  const audits: Harness['audits'] = []
  const handle = startDevSpaceWatch({
    listWorkspaces: () => [{ id: 'ws', rootPath: ROOT }],
    readCatalog: async () => catalog,
    writeCatalog: async (_root, next) => { writes.push(next) },
    workingDirectoryFor: () => WORKDIR,
    pushChanged: (workspaceId, repositoryId, status) => { pushes.push({ workspaceId, repositoryId, status }) },
    now: () => options.now ?? 1_000_000,
    startupDelayMs: options.startupDelayMs ?? 0,
    tickIntervalMs: DEV_SPACE_WATCH_DEFAULT_INTERVAL_MS,
    fetch: async (input) => { fetchCalls.push(input); if (options.fetch) await options.fetch(input) },
    pull: async (input) => { pullCalls.push(input); if (options.pull) await options.pull(input) },
    readTracking: options.tracking ?? (async () => ({ head: 'head', upstream: null })),
    audit: async (root, projectSlug, event) => { audits.push({ root, projectSlug, event }) },
    ...(options.omitRegenerate ? {} : {
      regenerate: async (record: DevSpaceRepositoryRecord, signal: AbortSignal) => {
        regenerations.push(record)
        regenerateSignals.push(signal)
        if (options.regenerate) await options.regenerate(record, signal)
      },
    }),
  })
  handles.push(handle)
  return { catalog, fetchCalls, pullCalls, pushes, writes, regenerations, regenerateSignals, audits, handle, tick: () => handle.tick() }
}

describe('dev-space auto-watch (O10)', () => {
  it('fetches only repositories with explicit watch consent', async () => {
    const watched = record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true })
    const skipped = record({ id: 'devrepo_off', repositoryId: 'repo_off', watchEnabled: false })
    const h = harness({ records: [watched, skipped] })
    await h.tick()
    expect(h.fetchCalls.map((call) => call.repositoryId)).toEqual(['repo_watch'])
    expect(h.writes).toHaveLength(1)
    expect(h.catalog.repositories.find((r) => r.id === 'devrepo_off')).toEqual(skipped)
  })

  it('marks a repository stale and emits a change when the upstream moved', async () => {
    const h = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true })],
      tracking: async () => ({ head: 'aaaa', upstream: 'bbbb' }),
      now: 42,
    })
    await h.tick()
    const next = h.catalog.repositories[0]!
    expect(next.status).toBe('stale')
    expect(next.lastRemoteHead).toBe('bbbb')
    expect(next.lastWatchAt).toBe(42)
    expect(h.pushes).toEqual([{ workspaceId: 'ws', repositoryId: 'repo_watch', status: 'stale' }])
  })

  it('pulls when watchAutoPull is on and the upstream moved', async () => {
    const h = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true, watchAutoPull: true })],
      tracking: async () => ({ head: 'aaaa', upstream: 'bbbb' }),
    })
    await h.tick()
    expect(h.pullCalls).toHaveLength(1)
    expect(h.catalog.repositories[0]!.status).toBe('stale')
  })

  it('regenerates after a successful pull when watchRegenerate is on (В11)', async () => {
    const h = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true, watchAutoPull: true, watchRegenerate: true })],
      tracking: async () => ({ head: 'aaaa', upstream: 'bbbb' }),
    })
    await h.tick()
    expect(h.pullCalls).toHaveLength(1)
    expect(h.regenerations.map((entry) => entry.id)).toEqual(['devrepo_watch'])
    // Audit trail brackets the run: started then succeeded, both on the project.
    expect(h.audits.map((entry) => entry.event.event)).toEqual(['watch-regenerate-started', 'watch-regenerate-succeeded'])
    expect(h.audits.every((entry) => entry.root === ROOT && entry.projectSlug === 'demo')).toBe(true)
  })

  it('does not regenerate without watchRegenerate or without auto-pull', async () => {
    const optedOut = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true, watchAutoPull: true })],
      tracking: async () => ({ head: 'aaaa', upstream: 'bbbb' }),
    })
    await optedOut.tick()
    expect(optedOut.pullCalls).toHaveLength(1)
    expect(optedOut.regenerations).toHaveLength(0)

    const noPull = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true, watchRegenerate: true })],
      tracking: async () => ({ head: 'aaaa', upstream: 'bbbb' }),
    })
    await noPull.tick()
    expect(noPull.pullCalls).toHaveLength(0)
    expect(noPull.regenerations).toHaveLength(0)
    expect(noPull.audits).toHaveLength(0)
  })

  it('does not regenerate when the pull itself fails', async () => {
    const h = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true, watchAutoPull: true, watchRegenerate: true })],
      tracking: async () => ({ head: 'aaaa', upstream: 'bbbb' }),
      pull: async () => { throw new CloneError('network-unavailable') },
    })
    await h.tick()
    expect(h.regenerations).toHaveLength(0)
    expect(h.catalog.repositories[0]!.lastError?.code).toBe('network-unavailable')
  })

  it('keeps the tick alive and audits a failed regeneration', async () => {
    const h = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true, watchAutoPull: true, watchRegenerate: true })],
      tracking: async () => ({ head: 'aaaa', upstream: 'bbbb' }),
      regenerate: async () => { throw new Error('pipeline exploded') },
    })
    await expect(h.tick()).resolves.toBeUndefined()
    expect(h.audits.map((entry) => entry.event.event)).toEqual(['watch-regenerate-started', 'watch-regenerate-failed'])
    expect(h.catalog.repositories[0]!.status).toBe('stale')
  })

  it('hands the handle\'s own abort signal to the regeneration sink', async () => {
    const h = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true, watchAutoPull: true, watchRegenerate: true })],
      tracking: async () => ({ head: 'aaaa', upstream: 'bbbb' }),
    })
    await h.tick()
    expect(h.regenerateSignals).toHaveLength(1)
    expect(h.regenerateSignals[0]!.aborted).toBe(false)
    h.handle.stop()
    expect(h.regenerateSignals[0]!.aborted).toBe(true)
  })

  it('is a no-op when the host composed no regeneration sink', async () => {
    const h = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true, watchAutoPull: true, watchRegenerate: true })],
      tracking: async () => ({ head: 'aaaa', upstream: 'bbbb' }),
      omitRegenerate: true,
    })
    await expect(h.tick()).resolves.toBeUndefined()
    expect(h.pullCalls).toHaveLength(1)
    expect(h.audits).toHaveLength(0)
  })

  it('records lastError and never throws when fetch fails', async () => {
    const h = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true })],
      fetch: async () => { throw new CloneError('network-unavailable') },
    })
    await expect(h.tick()).resolves.toBeUndefined()
    const next = h.catalog.repositories[0]!
    expect(next.status).toBe('ready')
    expect(next.lastError?.code).toBe('network-unavailable')
    expect(next.lastWatchAt).toBe(1_000_000)
  })

  it('skips a repository that is not due at its per-repo interval', async () => {
    const h = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true, lastWatchAt: 999_000, watchIntervalMs: DEV_SPACE_WATCH_MIN_INTERVAL_MS })],
      now: 1_000_000,
    })
    await h.tick()
    expect(h.fetchCalls).toHaveLength(0)
    expect(h.writes).toHaveLength(0)
  })

  it('clears a prior error on a successful sweep', async () => {
    const h = harness({
      records: [record({ id: 'devrepo_watch', repositoryId: 'repo_watch', watchEnabled: true, lastError: { code: 'network-unavailable', at: 1 } })],
      tracking: async () => ({ head: 'same', upstream: 'same' }),
    })
    await h.tick()
    expect(h.catalog.repositories[0]!.lastError).toBeUndefined()
  })

  it('validates the watch interval bounds', () => {
    expect(isValidDevSpaceWatchInterval(DEV_SPACE_WATCH_MIN_INTERVAL_MS)).toBe(true)
    expect(isValidDevSpaceWatchInterval(DEV_SPACE_WATCH_MAX_INTERVAL_MS)).toBe(true)
    expect(isValidDevSpaceWatchInterval(DEV_SPACE_WATCH_MIN_INTERVAL_MS - 1)).toBe(false)
    expect(isValidDevSpaceWatchInterval(DEV_SPACE_WATCH_MAX_INTERVAL_MS + 1)).toBe(false)
    expect(isValidDevSpaceWatchInterval(60_000.5)).toBe(false)
    expect(isValidDevSpaceWatchInterval('60000')).toBe(false)
  })

  it('stop() aborts in-flight work and clears the timers', async () => {
    const h = harness({ records: [record({ watchEnabled: true })] })
    h.handle.stop()
    h.handle.stop()
    await h.tick()
    expect(h.fetchCalls).toHaveLength(0)
  })
})
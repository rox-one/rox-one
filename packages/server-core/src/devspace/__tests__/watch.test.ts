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
  now?: number
  startupDelayMs?: number
}): Harness {
  const catalog: DevSpaceWatchCatalog = { schemaVersion: 1, repositories: [...options.records] }
  const fetchCalls: GitFetchInput[] = []
  const pullCalls: GitFetchInput[] = []
  const pushes: Harness['pushes'] = []
  const writes: DevSpaceWatchCatalog[] = []
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
  })
  handles.push(handle)
  return { catalog, fetchCalls, pullCalls, pushes, writes, handle, tick: () => handle.tick() }
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
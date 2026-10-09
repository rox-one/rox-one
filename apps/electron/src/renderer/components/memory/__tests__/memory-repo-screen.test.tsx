/**
 * Память — MemoryRepoScreen: stale-guard invalidation (F1) and the dream
 * `error` event transition (F5). Mounted in happy-dom against a mocked
 * `window.electronAPI` so the real effects/generations run end-to-end.
 *
 * Only modules no sibling test file in this suite imports are mocked: the
 * files/history panels and react-i18next stay real, so running this file next
 * to the panel tests in one `bun test` process does not leak stubs into them.
 */
import { setupEntityTestEnv, resetDom } from '../../entities/__tests__/test-env'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MemoryRepoScreen as MemoryRepoScreenComponent } from '../MemoryRepoScreen'

setupEntityTestEnv()

// Mutable navigation state the mocked useNavigation returns at call time.
let navState: unknown = { navigator: 'memory', tab: 'repo', details: null }

mock.module('@/contexts/NavigationContext', () => ({
  useNavigation: () => ({ navigationState: navState, navigate: () => {} }),
  routes: { view: { memory: (tab?: string) => (tab ? `memory/${tab}` : 'memory'), notes: (id: string) => `notes/${id}`, allSessions: (id: string) => `sessions/${id}` } },
}))
mock.module('@/features/product-tour/runtime/hooks', () => ({ useTourTarget: () => ({ current: null }) }))
mock.module('../repo/MemoryRepoDreamsPanel', () => ({ MemoryRepoDreamsPanel: () => null }))
mock.module('../repo/MemoryRepoGraphPanel', () => ({ MemoryRepoGraphPanel: () => null }))
mock.module('../repo/MemoryRepoSearchOverlay', () => ({ MemoryRepoSearchOverlay: () => null }))

let MemoryRepoScreen: typeof MemoryRepoScreenComponent

beforeAll(async () => {
  // Dynamic import: the module graph must load only after the `mock.module`
  // factories above are registered, which static (hoisted) imports would beat.
  ({ MemoryRepoScreen } = await import('../MemoryRepoScreen'))
})

afterEach(() => {
  resetDom()
  navState = { navigator: 'memory', tab: 'repo', details: null }
})
afterAll(() => { mock.restore() })

const REPO_STATUS = {
  bankId: 'ws:ws-1', scope: 'workspace', repoPath: '/tmp/memory-repo', mode: 'git',
  head: null, lastMaterializeAt: null, dirty: false, editedFiles: [], foreignTree: false,
  pendingImportCount: 0,
  dream: { lastRunAt: null, nextRunAt: null, intervalHours: 4, costTodayUsd: 0, costIsEstimate: false },
}

function baseApi(extra: Record<string, unknown> = {}) {
  return {
    listMemoryRepoBanks: mock(async () => [{ id: 'ws:ws-1', label: 'Workspace', isMain: true }]),
    getMemoryRepoStatus: mock(async () => REPO_STATUS),
    getMemoryRepoTree: mock(async () => []),
    listMemoryRepoCommits: mock(async () => []),
    getMemoryDreamStatus: mock(async () => ({ bankId: 'ws:ws-1', running: false, lastRun: null, nextRunAt: null, intervalHours: 4, costTodayUsd: 0, costIsEstimate: false, pendingNoteIds: [] })),
    getMemoryDreamLog: mock(async () => []),
    getMemoryRepoGraph: mock(async () => ({ nodes: [], edges: [] })),
    readMemoryRepoFile: mock(async () => null),
    getMemoryRepoCommitDiff: mock(async () => []),
    runMemoryDream: mock(async () => ({ status: 'ok' })),
    exportMemoryRepo: mock(async () => ({ path: '/tmp/x', bytes: 1 })),
    onMemoryRepoChanged: () => () => {},
    onMemoryDreamEvent: () => () => {},
    onMemoryDreamDone: () => () => {},
    ...extra,
  }
}

function setApi(api: Record<string, unknown>): void {
  Object.assign(window, { electronAPI: api })
}

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return { container, root }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => { root.unmount() })
}

async function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  await act(async () => { await promise })
}

function byTestId(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}

describe('MemoryRepoScreen', () => {
  it('keeps the run disabled across a mid-run `error` event and re-enables on `end` (F5)', async () => {
    let emit: ((event: unknown) => void) | null = null
    setApi(baseApi({ onMemoryDreamEvent: (cb: (event: unknown) => void) => { emit = cb; return () => {} } }))

    const { container, root } = await render(<MemoryRepoScreen workspaceId="ws-1" />)
    await flush()

    expect(byTestId(container, 'memory-repo-dream-now')!.hasAttribute('disabled')).toBe(false)

    await act(async () => { emit!({ bankId: 'ws:ws-1', kind: 'start' }) })
    expect(byTestId(container, 'memory-repo-dream-now')!.hasAttribute('disabled')).toBe(true)

    // A step failure mid-run must not re-enable «Собрать сейчас».
    await act(async () => { emit!({ bankId: 'ws:ws-1', kind: 'error', message: 'step failed' }) })
    expect(byTestId(container, 'memory-repo-dream-now')!.hasAttribute('disabled')).toBe(true)

    await act(async () => { emit!({ bankId: 'ws:ws-1', kind: 'end', status: 'error' }) })
    expect(byTestId(container, 'memory-repo-dream-now')!.hasAttribute('disabled')).toBe(false)

    await unmount(root)
  })

  it('keeps the run disabled when the RPC times out after a `start` event, re-enables on `end`', async () => {
    const run = Promise.withResolvers<unknown>()
    let emit: ((event: unknown) => void) | null = null
    setApi(baseApi({
      runMemoryDream: mock(() => run.promise),
      onMemoryDreamEvent: (cb: (event: unknown) => void) => { emit = cb; return () => {} },
    }))

    const { container, root } = await render(<MemoryRepoScreen workspaceId="ws-1" />)
    await flush()

    await act(async () => { byTestId(container, 'memory-repo-dream-now')!.click() })
    await flush()
    expect(byTestId(container, 'memory-repo-dream-now')!.hasAttribute('disabled')).toBe(true)

    // The server run started; the RPC promise is still pending.
    await act(async () => { emit!({ bankId: 'ws:ws-1', kind: 'start' }) })

    // Transport timeout fires at 30 s while the run is alive: the button must
    // stay disabled for a run that will still emit `end`.
    await act(async () => { run.reject(new Error('Request timeout: memory:dreamRun (30000ms)')) })
    await flush()
    expect(byTestId(container, 'memory-repo-dream-now')!.hasAttribute('disabled')).toBe(true)

    await act(async () => { emit!({ bankId: 'ws:ws-1', kind: 'end' }) })
    expect(byTestId(container, 'memory-repo-dream-now')!.hasAttribute('disabled')).toBe(false)

    await unmount(root)
  })

  it('re-enables the run when the RPC fails before any `start` event', async () => {
    const run = Promise.withResolvers<unknown>()
    setApi(baseApi({ runMemoryDream: mock(() => run.promise) }))

    const { container, root } = await render(<MemoryRepoScreen workspaceId="ws-1" />)
    await flush()

    await act(async () => { byTestId(container, 'memory-repo-dream-now')!.click() })
    await flush()
    expect(byTestId(container, 'memory-repo-dream-now')!.hasAttribute('disabled')).toBe(true)

    // No `start` ever arrived (runtime not started): an immediate failure, so
    // the button is re-enabled for a retry.
    await act(async () => { run.reject(new Error('runtime not started')) })
    await flush()
    expect(byTestId(container, 'memory-repo-dream-now')!.hasAttribute('disabled')).toBe(false)

    await unmount(root)
  })

  it('ignores a late file-read response for a dropped selection (F1)', async () => {
    const read = Promise.withResolvers<unknown>()
    setApi(baseApi({ readMemoryRepoFile: mock(() => read.promise) }))

    navState = { navigator: 'memory', tab: 'repo', details: { type: 'file', path: 'a.md' } }
    const { container, root } = await render(<MemoryRepoScreen workspaceId="ws-1" />)
    await flush()

    // Selection is being read: a per-selection loading branch, no viewer yet.
    expect(byTestId(container, 'memory-repo-files-loading')).not.toBeNull()
    expect(byTestId(container, 'memory-repo-file-viewer')).toBeNull()

    // Drop the selection before the read resolves.
    navState = { navigator: 'memory', tab: 'repo', details: null }
    await act(async () => { root.render(<MemoryRepoScreen workspaceId="ws-1" />) })
    await flush()
    expect(byTestId(container, 'memory-repo-files-no-selection')).not.toBeNull()

    // The late response must hit the invalidated stale guard and be dropped:
    // no stale content for a selection that no longer exists.
    await act(async () => { read.resolve({ path: 'a.md', content: 'x', truncated: false, edited: false }) })
    await flush()
    expect(byTestId(container, 'memory-repo-file-viewer')).toBeNull()
    expect(byTestId(container, 'memory-repo-files-no-selection')).not.toBeNull()

    await unmount(root)
  })
})
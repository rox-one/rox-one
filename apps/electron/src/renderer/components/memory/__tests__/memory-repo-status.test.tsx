/**
 * Память — repository status line. Mounted in happy-dom against a mocked
 * `window.electronAPI` so the real effects and RPC wiring run end-to-end.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
// Keep every real export (notably `setI18n`) in the mocked namespace so this
// process-wide stub cannot break a sibling file that imports a named export.
import * as actualReactI18next from 'react-i18next'
import type { MemoryScreen as MemoryScreenComponent } from '../MemoryScreen'

useDomForFile()

// The graph must load after the i18n/route mocks are registered.
mock.module('react-i18next', () => ({
  ...actualReactI18next,
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const base = LABELS[key] ?? key
      return vars ? `${base} ${Object.values(vars).join(' ')}` : base
    },
    i18n: { language: 'ru' },
  }),
}))
mock.module('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
mock.module('@/contexts/NavigationContext', () => ({
  useNavigation: () => ({ navigate: () => {} }),
  routes: { view: { memory: (tab?: string, _details?: unknown) => (tab ? `memory/${tab}` : 'memory') } },
}))
mock.module('@/components/app-shell/MemoryListPanel', () => ({ MemoryListPanel: () => null }))
mock.module('jotai', () => ({ useAtomValue: () => new Map(), atom: (value: unknown) => value }))
mock.module('@/atoms/sessions', () => ({ sessionMetaMapAtom: {} }))
// MemoryScreen imports ImportReviewDialog, whose graph reaches @rox/ui + the
// local dialog primitives (browser-only assets). The dialog stays closed here.
mock.module('@rox/ui', () => ({ UnifiedDiffViewer: () => null }))
mock.module('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  DialogContent: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  DialogHeader: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  DialogTitle: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  DialogDescription: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  DialogFooter: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
}))
mock.module('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: { children?: React.ReactNode }) => React.createElement('button', { type: 'button', ...rest }, children),
}))

const LABELS: Record<string, string> = {
  'memory.repo.head': 'HEAD',
  'memory.repo.headNone': 'нет коммитов',
  'memory.repo.lastDream': 'Последний сон',
  'memory.repo.lastDreamNever': 'Сон: ещё не было',
  'memory.repo.costToday': 'Сегодня',
  'memory.repo.costEstimate': 'оценка',
  'memory.repo.open': 'Открыть репозиторий',
  'memory.repo.action.dreamNow': 'Собрать сейчас',
  'memory.repo.state.dreamRunning': 'Собираю…',
  'memory.repo.inspector.lessonPath': 'В репозитории',
}

let MemoryScreen: typeof MemoryScreenComponent

beforeAll(async () => {
  ({ MemoryScreen } = await import('../MemoryScreen'))
})

afterEach(() => { resetDom() })
afterAll(() => { mock.restore() })

const lesson = {
  ts: '2026-09-01T00:00:00.000Z',
  rule: 'alpha rule',
  category: 'workflow',
  scope: 'workspace',
  source: { trigger: 'distillation' as const },
}

function repoStatus(overrides: Record<string, unknown> = {}) {
  return {
    bankId: 'ws:ws-1', scope: 'workspace' as const, repoPath: '/tmp/memory-repo', mode: 'git' as const,
    head: { sha: '3f9a2c1deadbeef', message: 'memory(workspace): dream', ts: '2026-10-09T09:00:00.000Z' },
    lastMaterializeAt: '2026-10-09T09:00:00.000Z', dirty: false, editedFiles: [], foreignTree: false,
    pendingImportCount: 0,
    dream: { lastRunAt: '2026-10-09T10:00:00.000Z', nextRunAt: null, intervalHours: 4, costTodayUsd: 0.12, costIsEstimate: true },
    ...overrides,
  }
}

function dreamStatus(overrides: Record<string, unknown> = {}) {
  return {
    bankId: 'ws:ws-1', running: false,
    lastRun: { dreamId: 'd1', bankId: 'ws:ws-1', startedAt: '2026-10-09T09:50:00.000Z', endedAt: '2026-10-09T10:00:00.000Z', status: 'ok' as const, costUsd: 0.12, costIsEstimate: true },
    nextRunAt: null, intervalHours: 4, costTodayUsd: 0.12, costIsEstimate: true, pendingNoteIds: [],
    ...overrides,
  }
}

function graph(nodes: Array<{ kind: string; label: string; path?: string }>) {
  return { nodes, edges: [] }
}

function baseApi(extra: Record<string, unknown> = {}) {
  return {
    listMemoryLessons: mock(async () => [lesson]),
    listMemoryArchive: mock(async () => []),
    listPromotionCandidates: mock(async () => []),
    onMemoryChanged: () => () => {},
    getMemoryRepoStatus: mock(async () => repoStatus()),
    getMemoryDreamStatus: mock(async () => dreamStatus()),
    getMemoryRepoGraph: mock(async () => graph([{ kind: 'lesson', label: 'alpha rule', path: 'lessons/workflow/alpha--abc123.md' }])),
    runMemoryDream: mock(async () => dreamStatus().lastRun),
    exportMemoryRepo: mock(async () => ({ path: '/tmp/export.zip', bytes: 10 })),
    previewMemoryRepoImport: mock(async () => ({ bankId: 'ws:ws-1', edits: [], conflicts: 0 })),
    applyMemoryRepoImport: mock(async () => ({ applied: 0 })),
    revertMemoryRepoImport: mock(async () => ({ reverted: 0 })),
    onMemoryRepoChanged: () => () => {},
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

describe('MemoryScreen repository status line', () => {
  it('renders HEAD, today cost (estimated) and last dream from mocked RPC', async () => {
    const api = baseApi()
    setApi(api)
    const { container, root } = await render(<MemoryScreen workspaceId="ws-1" />)
    await flush()

    expect(api.getMemoryRepoStatus).toHaveBeenCalledWith('ws:ws-1')
    expect(api.getMemoryDreamStatus).toHaveBeenCalledWith('ws:ws-1')

    expect(byTestId(container, 'memory-repo-head')?.textContent).toContain('3f9a2c1')
    const cost = byTestId(container, 'memory-repo-cost')
    expect(cost?.textContent).toContain('0.12')
    expect(cost?.textContent).toContain('оценка')
    expect(cost?.getAttribute('data-estimated')).toBe('true')
    expect(byTestId(container, 'memory-repo-dream')?.textContent).toContain('Последний сон')
    await unmount(root)
  })

  it('disables [Собрать сейчас] while a dream runs and calls runMemoryDream otherwise', async () => {
    setApi(baseApi({ getMemoryDreamStatus: mock(async () => dreamStatus({ running: true })) }))
    const running = await render(<MemoryScreen workspaceId="ws-1" />)
    await flush()
    expect(byTestId(running.container, 'memory-repo-run')?.hasAttribute('disabled')).toBe(true)
    await unmount(running.root)

    const api = baseApi()
    setApi(api)
    const idle = await render(<MemoryScreen workspaceId="ws-1" />)
    await flush()
    const run = byTestId(idle.container, 'memory-repo-run')!
    expect(run.hasAttribute('disabled')).toBe(false)
    await act(async () => { run.click() })
    await flush()
    expect(api.runMemoryDream).toHaveBeenCalledWith('ws:ws-1')
    await unmount(idle.root)
  })

  it('shows the repository path row for a materialized lesson and hides it otherwise', async () => {
    setApi(baseApi())
    const withPath = await render(<MemoryScreen workspaceId="ws-1" />)
    await flush()
    await act(async () => { byTestId(withPath.container, 'memory-row')!.click() })
    await flush()
    expect(byTestId(withPath.container, 'memory-repo-lesson-path')?.textContent).toBe('lessons/workflow/alpha--abc123.md')
    await unmount(withPath.root)

    setApi(baseApi({ getMemoryRepoGraph: mock(async () => graph([{ kind: 'topic', label: 'alpha rule', path: 'TOPIC.md' }])) }))
    const without = await render(<MemoryScreen workspaceId="ws-1" />)
    await flush()
    await act(async () => { byTestId(without.container, 'memory-row')!.click() })
    await flush()
    expect(byTestId(without.container, 'memory-detail')).not.toBeNull()
    expect(byTestId(without.container, 'memory-repo-lesson-path')).toBeNull()
    await unmount(without.root)
  })
})
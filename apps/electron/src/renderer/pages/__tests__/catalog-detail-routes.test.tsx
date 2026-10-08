import { beforeAll, describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { Provider } from 'jotai'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { PersonalTaskStore } from '@rox/core/tasks/personal'
import { AppShellProvider, type AppShellContextType } from '../../context/AppShellContext'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { routes } from '../../../shared/routes'
import { persistPersonalTaskStore, setPersonalTaskScope } from '../../lib/personal-tasks'
import TasksPage from '../TasksPage'
import { loadMeetingSelection } from '../meetings/selection'

const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: {} } } })
})

function renderPage(page: ReactNode): string {
  const shell = { workspaces: [], activeWorkspaceId: null } as unknown as AppShellContextType
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <Provider><AppShellProvider value={shell}>{page}</AppShellProvider></Provider>
    </I18nextProvider>,
  )
}

/**
 * The personal-task store only serves a caller that holds a scope, and its cache
 * layer writes through `localStorage`, which the test runtime does not provide.
 * A throwaway storage plus a local (non-identity) scope covers both.
 */
function withScopedTaskStore<T>(run: () => T): T {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    },
  })
  setPersonalTaskScope({ authority: 'local', userId: 'catalog-detail-routes', workspaceId: null })
  try {
    return run()
  } finally {
    setPersonalTaskScope(null)
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

describe('catalog detail route rendering', () => {
  it('renders the requested task for direct and back/forward route states, without a first-item fallback', () => {
    withScopedTaskStore(() => {
      const store = new PersonalTaskStore()
      const first = store.create({ title: 'First task' })
      const second = store.create({ title: 'Requested task' })
      persistPersonalTaskStore(store)

      // Direct open, next route, back, forward use the same controlled page contract.
      for (const [id, title] of [[second.id, 'Requested task'], [first.id, 'First task'], [second.id, 'Requested task'], [first.id, 'First task']] as const) {
        const state = parseRouteToNavigationState(routes.view.tasks(id))!
        if (state.navigator !== 'tasks') throw new Error('Expected tasks route')
        const html = renderPage(<TasksPage selectedId={state.details?.taskId ?? null} />)
        const detailStart = html.indexOf('data-testid="task-detail"')
        expect(detailStart).toBeGreaterThan(-1)
        expect(html.slice(detailStart)).toContain(`value="${title}"`)
      }
      for (const [route, marker] of [[routes.view.tasks(), 'tasks-select-hint'], [routes.view.tasks('missing-task'), 'tasks-not-found']] as const) {
        const state = parseRouteToNavigationState(route)!
        if (state.navigator !== 'tasks') throw new Error('Expected tasks route')
        const html = renderPage(<TasksPage selectedId={state.details?.taskId ?? null} />)
        expect(html).not.toContain('data-testid="task-detail"')
        expect(html).toContain(`data-testid="${marker}"`)
        expect(html).toContain('First task')
        expect(html).toContain('Requested task')
      }
    })
  })

  // The catalog-prop MeetingsPage case is superseded: the converged page is
  // workspace-scoped (meetingsApi + selectedId) and its route contract — route-bound
  // selection, no `meetings[0]` fallback, not-found state — is asserted against the
  // page source by pages/__tests__/meetings-catalog-deeplink.test.ts.
  it('loads the exact meeting outside a catalog page and rejects missing or mismatched results', async () => {
    const calls: string[][] = []
    const meeting = { workspaceId: 'workspace', meetingId: 'outside-page', title: 'Older meeting', status: 'completed' }
    expect(await loadMeetingSelection({
      api: { getMeeting: async (...args) => { calls.push(args); return meeting } },
      workspaceId: 'workspace',
      meetingId: 'outside-page',
    })).toEqual({ id: 'outside-page', title: 'Older meeting', status: 'completed' })
    expect(calls).toEqual([['workspace', 'outside-page']])
    for (const result of [null, { ...meeting, meetingId: 'different' }, { ...meeting, workspaceId: 'different' }]) {
      expect(await loadMeetingSelection({
        api: { getMeeting: async () => result },
        workspaceId: 'workspace',
        meetingId: 'outside-page',
      })).toBeNull()
    }
  })
})
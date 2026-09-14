import { beforeAll, describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { Provider } from 'jotai'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { PersonalTaskStore, PERSONAL_TASKS_STORAGE_KEY } from '@craft-agent/core/tasks/personal'
import { AppShellProvider, type AppShellContextType } from '../../context/AppShellContext'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { routes } from '../../../shared/routes'
import TasksPage from '../TasksPage'
import MeetingsPage from '../MeetingsPage'
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

describe('catalog detail route rendering', () => {
  it('renders the requested task for direct and back/forward route states, without a first-item fallback', () => {
    const store = new PersonalTaskStore()
    const first = store.create({ title: 'First task' })
    const second = store.create({ title: 'Requested task' })
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (key: string) => key === PERSONAL_TASKS_STORAGE_KEY ? store.exportJson() : null },
    })
    try {
      // Direct open, next route, back, forward use the same controlled page contract.
      for (const id of [second.id, first.id, second.id, first.id]) {
        const state = parseRouteToNavigationState(routes.view.tasks(id))!
        if (state.navigator !== 'tasks') throw new Error('Expected tasks route')
        const html = renderPage(<TasksPage selectedId={state.details?.taskId ?? null} />)
        expect(html).toContain(`data-testid="task-detail" data-entity-id="${id}"`)
      }
      for (const route of [routes.view.tasks(), routes.view.tasks('missing-task')]) {
        const state = parseRouteToNavigationState(route)!
        if (state.navigator !== 'tasks') throw new Error('Expected tasks route')
        const html = renderPage(<TasksPage selectedId={state.details?.taskId ?? null} />)
        expect(html).not.toContain('data-testid="task-detail"')
        expect(html).toContain('First task')
        expect(html).toContain('Requested task')
      }
    } finally {
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('renders meeting route selections and preserves the catalog for missing or bare IDs', () => {
    const meetings = [
      { id: 'meeting-first', title: 'First meeting', status: 'planned' },
      { id: 'meeting/second', title: 'Requested meeting', status: 'completed' },
    ]
    for (const id of [meetings[1].id, meetings[0].id, meetings[1].id, meetings[0].id]) {
      const state = parseRouteToNavigationState(routes.view.meetings(id))!
      if (state.navigator !== 'meetings') throw new Error('Expected meetings route')
      const html = renderPage(<MeetingsPage meetings={meetings} selectedId={state.details?.meetingId ?? null} />)
      expect(html).toContain(`data-testid="meeting-detail" data-entity-id="call:${id}"`)
    }
    for (const route of [routes.view.meetings(), routes.view.meetings('missing-meeting')]) {
      const state = parseRouteToNavigationState(route)!
      if (state.navigator !== 'meetings') throw new Error('Expected meetings route')
      const html = renderPage(<MeetingsPage meetings={meetings} selectedId={state.details?.meetingId ?? null} />)
      expect(html).not.toContain('data-testid="meeting-detail"')
      expect(html).toContain('First meeting')
      expect(html).toContain('Requested meeting')
    }
  })

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

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  buildRouteFromNavigationState,
  parseRouteToNavigationState,
  resetEntityRoutesEnabled,
  setEntityRoutesEnabled,
} from '../../../shared/route-parser'
import { routes } from '../../../shared/routes'
import { isDetailNavState } from '../../lib/nav-helpers'
import { loadMeetingSelection } from '../meetings/selection'

describe('meeting deep-link selection loader', () => {
  it('resolves a meeting outside the catalog page through the production getMeeting api', async () => {
    // Catches: loadMeetingSelection stop fetching the deep-linked id (or resolving a different one).
    const calls: Array<[string, string]> = []
    const api = {
      getMeeting: async (workspaceId: string, meetingId: string) => {
        calls.push([workspaceId, meetingId])
        return { meetingId, workspaceId, title: 'Older meeting', status: 'completed' }
      },
    }

    const selected = await loadMeetingSelection({ api, workspaceId: 'workspace', meetingId: 'outside-page' })

    expect(calls).toEqual([['workspace', 'outside-page']])
    expect(selected).toEqual({ id: 'outside-page', title: 'Older meeting', status: 'completed' })
  })

  it('refuses a missing api/workspace or a meeting record that does not match the route', async () => {
    // Catches: a null / mismatched getMeeting result silently selecting an unrelated meeting.
    expect(await loadMeetingSelection({ api: null, workspaceId: 'workspace', meetingId: 'outside-page' })).toBeNull()
    expect(await loadMeetingSelection({
      api: { getMeeting: async () => ({}) },
      workspaceId: null,
      meetingId: 'outside-page',
    })).toBeNull()

    const shell = { meetingId: 'outside-page', workspaceId: 'workspace', title: 'Older meeting', status: 'completed' }
    for (const result of [
      null,
      42,
      { ...shell, meetingId: 'different' },
      { ...shell, workspaceId: 'different' },
      { ...shell, title: 7 },
      { ...shell, status: null },
    ]) {
      expect(await loadMeetingSelection({
        api: { getMeeting: async () => result },
        workspaceId: 'workspace',
        meetingId: 'outside-page',
      })).toBeNull()
    }
  })
})

describe('catalog deep-link route wiring', () => {
  // The kind-first entity routes are flag-gated and off by default; pin the base
  // contract so the legacy `meetings/meeting/{id}` alias keeps owning its address.
  beforeEach(() => { setEntityRoutesEnabled(false) })
  afterEach(() => { resetEntityRoutesEnabled() })

  it('keeps the deep-linked task id on the navigator state MainContentPanel forwards to TasksPage', () => {
    // Catches: routes.view.tasks losing the task id before the page receives selectedId.
    expect(parseRouteToNavigationState(routes.view.tasks('task-7'))).toMatchObject({
      navigator: 'tasks',
      details: { type: 'task', taskId: 'task-7' },
    })
    expect(parseRouteToNavigationState(routes.view.tasks())).toMatchObject({ navigator: 'tasks', details: null })
  })

  it('keeps the legacy meeting id on the calendar surface state MainContentPanel forwards as meetingId', () => {
    // Catches: the calendar surface dropping the meeting id a deep link addresses.
    const state = parseRouteToNavigationState(routes.view.meetings('meeting-9'))
    expect(state).toMatchObject({ navigator: 'surface', surface: 'calendar', meetingId: 'meeting-9' })
    expect(buildRouteFromNavigationState(state!)).toBe('meetings/meeting/meeting-9')
  })
})

describe('compact detail detection for catalog deep links', () => {
  beforeEach(() => { setEntityRoutesEnabled(false) })
  afterEach(() => { resetEntityRoutesEnabled() })

  it('treats a calendar meeting surface and a selected task as detail routes', () => {
    // Catches: isDetailNavState no longer covering the surface navigator, which
    // would drop the compact-mode back affordance on a deep-linked meeting.
    expect(isDetailNavState(parseRouteToNavigationState(routes.view.meetings('meeting-9'))!)).toBe(true)
    expect(isDetailNavState(parseRouteToNavigationState(routes.view.tasks('task-7'))!)).toBe(true)
    expect(isDetailNavState(parseRouteToNavigationState(routes.view.tasks())!)).toBe(false)
  })
})
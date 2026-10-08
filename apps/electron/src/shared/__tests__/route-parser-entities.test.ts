/**
 * Kind-first entity route round-trips (W1-01).
 *
 * Every new entity route parses to navigator 'entity', round-trips through the
 * compound pair and the NavigationState pair, and is recognised as a compound
 * route. Legacy routes keep their own navigators (no stealing).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  isCompoundRoute,
  parseCompoundRoute,
  buildCompoundRoute,
  parseRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
  resolveRouteNavigationState,
  degradeSurfaceNavigationState,
  setEntityRoutesEnabled,
  resetEntityRoutesEnabled,
  type NavigatorType,
} from '../route-parser'
import { isEntityCompoundRoute, parseEntityRoute } from '../entity-routes'
import {
  getNavigationStateKey,
  parseNavigationStateKey,
  isEntityNavigationState,
} from '../types'
import { formatEntityRef, type EntityKind, type EntityRef } from '@rox/core/entities'
import { routes } from '../routes'

type Case = {
  label: string
  route: string
  ref: EntityRef
  build: () => string
}

const cases: Case[] = [
  { label: 'file', route: 'docs/file/f-1', ref: { kind: 'file', id: 'f-1' }, build: () => routes.view.entityFile('f-1') },
  { label: 'folder', route: 'docs/folder/d-1', ref: { kind: 'folder', id: 'd-1' }, build: () => routes.view.entityFolder('d-1') },
  { label: 'drive-link', route: 'docs/link/l-1', ref: { kind: 'drive-link', id: 'l-1' }, build: () => routes.view.entityDriveLink('l-1') },
  { label: 'wiki-space bare', route: 'docs/wiki/w-1', ref: { kind: 'wiki-space', id: 'w-1' }, build: () => routes.view.entityWikiSpace('w-1') },
  { label: 'wiki-space nested', route: 'docs/wiki/w-1/space/a', ref: { kind: 'wiki-space', id: 'w-1', fragment: 'space/a' }, build: () => routes.view.entityWikiSpace('w-1', 'space/a') },
  { label: 'channel', route: 'messenger/c-1', ref: { kind: 'channel', id: 'c-1' }, build: () => routes.view.entityChannel('c-1') },
  { label: 'channel-message', route: 'messenger/c-1?seq=128', ref: { kind: 'channel-message', id: 'c-1', fragment: '128' }, build: () => routes.view.entityChannelMessage('c-1', '128') },
  { label: 'calendar-event', route: 'calendar/event/e-1', ref: { kind: 'calendar-event', id: 'e-1' }, build: () => routes.view.entityCalendarEvent('e-1') },
  { label: 'reminder', route: 'calendar/reminder/r-1', ref: { kind: 'reminder', id: 'r-1' }, build: () => routes.view.entityReminder('r-1') },
  { label: 'calendar', route: 'calendar/cal/cal-1', ref: { kind: 'calendar', id: 'cal-1' }, build: () => routes.view.entityCalendar('cal-1') },
  { label: 'room', route: 'calendar/room/room-1', ref: { kind: 'room', id: 'room-1' }, build: () => routes.view.entityRoom('room-1') },
  { label: 'goal', route: 'goals/goal/g-1', ref: { kind: 'goal', id: 'g-1' }, build: () => routes.view.entityGoal('g-1') },
  { label: 'goal-target', route: 'goals/goal/g-1#t-3', ref: { kind: 'goal-target', id: 'g-1', fragment: '3' }, build: () => routes.view.entityGoalTarget('g-1', '3') },
  { label: 'goal-check', route: 'goals/goal/g-1#k-7', ref: { kind: 'goal-check', id: 'g-1', fragment: '7' }, build: () => routes.view.entityGoalCheck('g-1', '7') },
  { label: 'check-in', route: 'goals/check-in/ci-1', ref: { kind: 'check-in', id: 'ci-1' }, build: () => routes.view.entityCheckIn('ci-1') },
  { label: 'review', route: 'goals/review/rv-1', ref: { kind: 'review', id: 'rv-1' }, build: () => routes.view.entityReview('rv-1') },
  { label: 'okr-cycle', route: 'goals/okrs?cycle=cy-1', ref: { kind: 'okr-cycle', id: 'cy-1' }, build: () => routes.view.entityOkrCycle('cy-1') },
  { label: 'space', route: 'goals/space/s-1', ref: { kind: 'space', id: 's-1' }, build: () => routes.view.entitySpace('s-1') },
  { label: 'kpi bare', route: 'goals/space/s-1/kpis', ref: { kind: 'kpi', id: 's-1' }, build: () => routes.view.entityKpi('s-1') },
  { label: 'kpi nested', route: 'goals/space/s-1/kpis/x/y', ref: { kind: 'kpi', id: 's-1', fragment: 'x/y' }, build: () => routes.view.entityKpi('s-1', 'x/y') },
  { label: 'kpi-entry', route: 'goals/kpis/ke-1', ref: { kind: 'kpi-entry', id: 'ke-1' }, build: () => routes.view.entityKpiEntry('ke-1') },
  { label: 'project-template', route: 'goals/templates/pt-1', ref: { kind: 'project-template', id: 'pt-1' }, build: () => routes.view.entityProjectTemplate('pt-1') },
  { label: 'crm-company', route: 'contacts/company/co-1', ref: { kind: 'crm-company', id: 'co-1' }, build: () => routes.view.entityCompany('co-1') },
  { label: 'person', route: 'contacts/person/p-1', ref: { kind: 'person', id: 'p-1' }, build: () => routes.view.entityPerson('p-1') },
  { label: 'department', route: 'contacts/department/dep-1', ref: { kind: 'department', id: 'dep-1' }, build: () => routes.view.entityDepartment('dep-1') },
  { label: 'invitation', route: 'contacts/invitations/inv-1', ref: { kind: 'invitation', id: 'inv-1' }, build: () => routes.view.entityInvitation('inv-1') },
  { label: 'workflow', route: 'workflows/wf-1', ref: { kind: 'workflow', id: 'wf-1' }, build: () => routes.view.entityWorkflow('wf-1') },
  { label: 'workflow-run', route: 'workflows/run/wfr-1', ref: { kind: 'workflow-run', id: 'wfr-1' }, build: () => routes.view.entityWorkflowRun('wfr-1') },
  { label: 'base', route: 'base/b-1', ref: { kind: 'base', id: 'b-1' }, build: () => routes.view.entityBase('b-1') },
  { label: 'base-table', route: 'base/b-1/tbl-1', ref: { kind: 'base-table', id: 'b-1', fragment: 'tbl-1' }, build: () => routes.view.entityBaseTable('b-1', 'tbl-1') },
  { label: 'base-view', route: 'base/b-1/tbl-1/vw-1', ref: { kind: 'base-view', id: 'b-1', fragment: 'tbl-1/vw-1' }, build: () => routes.view.entityBaseView('b-1', 'tbl-1', 'vw-1') },
  { label: 'base-record', route: 'base/b-1/tbl-1/vw-1?record=rec-1', ref: { kind: 'base-record', id: 'b-1', fragment: 'tbl-1/vw-1/rec-1' }, build: () => routes.view.entityBaseRecord('b-1', 'tbl-1', 'vw-1', 'rec-1') },
  { label: 'form', route: 'forms/fm-1', ref: { kind: 'form', id: 'fm-1' }, build: () => routes.view.entityForm('fm-1') },
  { label: 'comment', route: 'comments/cm-1', ref: { kind: 'comment', id: 'cm-1' }, build: () => routes.view.entityComment('cm-1') },
  { label: 'task-list', route: 'tasks/list/tl-1', ref: { kind: 'task-list', id: 'tl-1' }, build: () => routes.view.entityTaskList('tl-1') },
  { label: 'task-section', route: 'tasks/list/tl-1?section=sec-1', ref: { kind: 'task-section', id: 'tl-1', fragment: 'sec-1' }, build: () => routes.view.entityTaskSection('tl-1', 'sec-1') },
  { label: 'task-list-group', route: 'tasks/group/tg-1', ref: { kind: 'task-list-group', id: 'tg-1' }, build: () => routes.view.entityTaskListGroup('tg-1') },
  { label: 'milestone', route: 'projects/milestone/ms-1', ref: { kind: 'milestone', id: 'ms-1' }, build: () => routes.view.entityMilestone('ms-1') },
  { label: 'license-component', route: 'settings/licences/lc-1', ref: { kind: 'license-component', id: 'lc-1' }, build: () => routes.view.entityLicenseComponent('lc-1') },
  { label: 'app', route: 'home/apps/app-1', ref: { kind: 'app', id: 'app-1' }, build: () => routes.view.entityApp('app-1') },
]

describe('entity routes: builders and parser', () => {
  beforeEach(() => setEntityRoutesEnabled(true))
  afterEach(() => resetEntityRoutesEnabled())

  test('builders emit the canonical route, including the fragment forms', () => {
    for (const { label, route, build } of cases) {
      expect(build(), label).toBe(route)
    }
  })

  for (const { label, route, ref } of cases) {
    test(`round-trips ${label}: ${route}`, () => {
      const kind: EntityKind = ref.kind
      expect(isCompoundRoute(route)).toBe(true)
      expect(isEntityCompoundRoute(route)).toBe(true)

      const parsedEntity = parseEntityRoute(route)
      expect(parsedEntity).not.toBeNull()
      expect(parsedEntity!.kind).toBe(kind)
      expect(parsedEntity!.ref).toEqual(ref)
      expect(parsedEntity!.canonicalRoute).toBe(route)

      expect(parseCompoundRoute(route)).toEqual({
        navigator: 'entity',
        details: { type: 'entity', id: formatEntityRef(ref) },
        entityRef: ref,
      })
      expect(buildCompoundRoute(parseCompoundRoute(route)!)).toBe(route)

      const parsedState = parseRouteToNavigationState(route)
      expect(parsedState).not.toBeNull()
      const state = parsedState!
      expect(state).toEqual({ navigator: 'entity', route, ref, details: null })
      expect(isEntityNavigationState(state)).toBe(true)
      expect(buildRouteFromNavigationState(state)).toBe(route)
      expect(getNavigationStateKey(state)).toBe(`entity/${route}`)
      expect(parseNavigationStateKey(`entity/${route}`)).toEqual(state)
      // Entity routes are not opaque: they round-trip through the matcher.
      expect(resolveRouteNavigationState(route)).toEqual(state)
      expect(parseRoute(route)?.type).toBe('view')
      // No pre-W1 antecedent: degradation preserves the state.
      expect(degradeSurfaceNavigationState(state)).toEqual(state)
    })
  }
})

describe('entity routes: legacy routes are not stolen', () => {
  const legacy: Array<[string, NavigatorType]> = [
    ['tasks/task/a', 'tasks'],
    ['tasks', 'tasks'],
    ['notes/note/a', 'notes'],
    ['projects/project/a', 'projects'],
    ['pages/page/a', 'pages'],
    ['allSessions/session/a', 'sessions'],
    ['skills/skill/a', 'skills'],
    ['sources/source/a', 'sources'],
    ['automations/automation/a', 'automations'],
    ['meetings/meeting/a', 'meetings'],
    ['inbox/item/a', 'inbox'],
    ['feed/item/a', 'feed'],
    ['memory', 'memory'],
    ['connections', 'connections'],
    ['decisions/item/a', 'screen'],
    ['radar/item/a', 'screen'],
    ['agents/item/a', 'screen'],
    ['settings/shortcuts', 'settings'],
    ['home', 'home'],
  ]
  for (const [route, navigator] of legacy) {
    test(`keeps legacy parser for ${route}`, () => {
      expect(isEntityCompoundRoute(route)).toBe(false)
      expect(parseEntityRoute(route)).toBeNull()
      expect(parseCompoundRoute(route)?.navigator).toBe(navigator)
    })
  }
})

describe('entity routes: malformed shapes stay unavailable', () => {
  beforeEach(() => setEntityRoutesEnabled(true))
  afterEach(() => resetEntityRoutesEnabled())

  const malformed = [
    'goals', 'goals/goal', 'goals/goal/g-1/extra', 'goals/goal/g-1#x-1', 'goals/goal/g-1#t-',
    'goals/space/s-1/kpisx', 'goals/okrs', 'goals/okrs?cycle=', 'goals/okrs?other=1',
    'docs', 'docs/file', 'docs/wiki', 'docs/unknown/x', 'docs/file/',
    'messenger', 'messenger/c-1?seq=', 'messenger/c-1?x=1',
    'calendar/event', 'contacts/company', 'workflows/run',
    'base', 'base/b-1/tbl-1/vw-1/extra', 'base/b-1?x=1', 'base/b-1/tbl-1?x=1',
    'base/b-1/tbl-1/vw-1?record=',
    'forms', 'comments', 'tasks/list', 'tasks/group', 'projects/milestone',
    'settings/licences', 'home/apps',
    'docs/file/%zz', 'goals/goal/%',
  ]
  for (const route of malformed) {
    test(`rejects ${route}`, () => {
      expect(isEntityCompoundRoute(route)).toBe(false)
      expect(parseEntityRoute(route)).toBeNull()
      expect(parseCompoundRoute(route)).toBeNull()
      expect(parseRouteToNavigationState(route)).toBeNull()
      expect(resolveRouteNavigationState(route)).toEqual({ navigator: 'unavailable', route, details: null })
    })
  }
})
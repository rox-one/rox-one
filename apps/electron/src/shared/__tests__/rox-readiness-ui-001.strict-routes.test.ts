import { describe, expect, it } from 'bun:test'
import { EXTRA_SCREEN_IDS } from '../extra-screens'
import { routes } from '../routes'
import {
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRoute,
  parseRouteToNavigationState,
  resolveRouteNavigationState,
} from '../route-parser'

const invalidViews = [
  '/allSessions', 'allSessions/', 'allSessions//session/a', 'allSessions/session/a/extra',
  'flagged/session', 'archived/session/a/extra', 'state/a/unknown', 'label/a/session/a/extra', 'view/a/session',
  'board/session', 'board/other/a', 'board/session/a/extra', 'table/session/a', 'heatmap/extra',
  'settings/workspace/extra', 'settings//workspace', 'settings/workspace/', 'search/extra',
  'sources/api/source', 'sources/api/other', 'sources/api/source/a/extra', 'sources/source/a/extra',
  'skills/skill/a/extra', 'skills/skill', 'projects/project/a/extra', 'pages/page/a/extra',
  'browser/instance/a/extra', 'browser/instance', 'memory/extra', 'home/extra', 'connections/extra',
  'tasks/task', 'tasks/other/a', 'tasks/task/a/extra', 'inbox/item/a/extra', 'feed/other/a', 'meetings/meeting/a/extra',
  'automations/event/automation', 'automations/event/other', 'automations/event/automation/a/extra', 'automations/automation/a/extra',
  'knowledge/document/a/extra', 'knowledge/view/a/extra', 'cloud-run/a/extra', 'diff/a/extra', 'terminal/a/extra', 'extension/a/v/extra',
  'notes/note/folder//file', 'notes/note/a/',
  'sources/source/%', 'skills/skill/%', 'projects/project/%', 'pages/page/%', 'browser/instance/%', 'automations/automation/%', 'state/%',
  ...EXTRA_SCREEN_IDS.flatMap(screen => [screen + '/other/a', screen + '/item', screen + '/item/a/extra', screen + '/item/%']),
]

describe('UI-001 strict view grammar preserves the exact invalid address', () => {
  for (const route of invalidViews) {
    it(route, () => {
      expect(() => parseCompoundRoute(route)).not.toThrow()
      expect(parseCompoundRoute(route)).toBeNull()
      expect(parseRouteToNavigationState(route)).toBeNull()
      expect(resolveRouteNavigationState(route)).toEqual({ navigator: 'unavailable', route, details: null })
      expect(buildRouteFromNavigationState(resolveRouteNavigationState(route))).toBe(route)
    })
  }
})

describe('UI-001 generated route compatibility and query semantics', () => {
  const simple = [
    routes.view.allSessions(), routes.view.allSessions('session-A'), routes.view.flagged(), routes.view.flagged('session-A'),
    routes.view.archived(), routes.view.archived('session-A'), routes.view.state('todo'), routes.view.state('todo', 'session-A'),
    routes.view.label('project:A/B ?%', 'session-A'), routes.view.view('view ?/%', 'session-A'),
    routes.view.sources(), routes.view.sources({ sourceSlug: 'source-A', type: 'api' }),
    routes.view.sourcesApi(), routes.view.sourcesApi('source-A'), routes.view.sourcesMcp('source-A'), routes.view.sourcesLocal('source-A'),
    routes.view.skills(), routes.view.skills('skill-A'), routes.view.memory(),
    routes.view.automations(), routes.view.automations({ automationId: 'a', type: 'event' }),
    routes.view.automationsScheduled('a'), routes.view.automationsEvent('a'), routes.view.automationsAgentic('a'),
    routes.view.settings(), routes.view.settings('workspace'), routes.view.projects(), routes.view.projects('project-A'),
    routes.view.pages(), routes.view.pages('page-A'), routes.view.board(), routes.view.board('session-A'), routes.view.table(), routes.view.heatmap(),
    routes.view.home(), routes.view.connections(), routes.view.knowledge(), 'cloud-run', 'extension', 'diff', 'terminal',
  ]
  for (const route of simple) {
    it('retains ' + route, () => {
      const state = parseRouteToNavigationState(route)
      expect(state).not.toBeNull()
      expect(buildRouteFromNavigationState(state!)).toBe(route)
      expect(parseRoute(route)?.type).toBe('view')
    })
  }

  for (const id of ['folder/leaf', 'with space', 'literal%2F', 'Текст ? #^block-A']) {
    it('encoded separators and Unicode remain one entity: ' + id, () => {
      const generated = [
        routes.view.notes(id), routes.view.tasks(id), routes.view.inbox(id), routes.view.feed(id), routes.view.meetings(id),
        routes.view.siyuan({ kind: 'document', id }), routes.view.knowledgeView(id), routes.view.cloudRun(id),
        routes.view.extension(id, id), routes.view.proposal(id), routes.view.terminal(id),
        ...EXTRA_SCREEN_IDS.map(screen => routes.view.screen(screen, id)),
      ]
      for (const route of generated) {
        const state = parseRouteToNavigationState(route)
        expect(state).not.toBeNull()
        expect(buildRouteFromNavigationState(state!)).toBe(route)
      }
    })
  }

  it('preserves the intentional nested Notes alias and canonical block address', () => {
    expect(parseRouteToNavigationState('notes/note/folder/my note.md')).toEqual({
      navigator: 'notes', details: { type: 'note', noteId: 'folder/my note.md' },
    })
    const address = 'folder/my note.md#^block-A'
    const canonical = routes.view.notes(address)
    expect(parseRouteToNavigationState(canonical)).toEqual({
      navigator: 'notes', details: { type: 'note', noteId: address },
    })
  })

  it('preserves supported legacy settings aliases', () => {
    expect(buildRouteFromNavigationState(resolveRouteNavigationState('settings/toolchain'))).toBe('settings/runtime')
    expect(buildRouteFromNavigationState(resolveRouteNavigationState('settings/preferences'))).toBe('settings/context')
  })

  it('splits query only once and keeps literal/encoded question marks in values', () => {
    expect(parseRouteToNavigationState('search?q=one?two%2F%25+три')).toEqual({ navigator: 'search', query: 'one?two/% три' })
    expect(parseRoute('action/copy?text=one?two%2F%25+три')).toEqual({
      type: 'action', name: 'copy', id: undefined, params: { text: 'one?two/% три' },
    })
    const query = '? slash/ percent% plus+ #hash'
    const route = routes.view.search(query)
    expect(parseRouteToNavigationState(route)).toEqual({ navigator: 'search', query })
    expect(buildRouteFromNavigationState(resolveRouteNavigationState(route))).toBe(route)
  })

  it('retains every generated action and its parameters without a new capability allowlist', () => {
    const generated = [
      routes.action.newSession({ input: 'hello ? /%', name: 'name ?', send: true }),
      routes.action.renameSession('session-A', 'name ? /%'), routes.action.deleteSession('session-A'),
      routes.action.flagSession('session-A'), routes.action.unflagSession('session-A'), routes.action.oauth('source-A'),
      routes.action.addSource(), routes.action.deleteSource('source-A'), routes.action.setPermissionMode('session-A', 'allow-all'),
      routes.action.copyToClipboard('hello ? /%'),
    ]
    for (const route of generated) {
      expect(parseRoute(route)?.type).toBe('action')
      expect(resolveRouteNavigationState(route)).toEqual({ navigator: 'unavailable', route, details: null })
    }
    expect(parseRoute(generated[0]!)).toEqual({
      type: 'action', name: 'new-session', id: undefined, params: { input: 'hello ? /%', name: 'name ?', send: 'true' },
    })
    expect(parseRoute('action/future-action/id?x=one?two')?.params).toEqual({ x: 'one?two' })
  })

  for (const route of ['/action/new-session', 'action//new-session', 'action/new-session/', 'action/new-session/a/extra', 'action/delete-session/%']) {
    it('does not parse a malformed action shape: ' + route, () => {
      expect(parseRoute(route)).toBeNull()
      expect(resolveRouteNavigationState(route)).toEqual({ navigator: 'unavailable', route, details: null })
    })
  }
})

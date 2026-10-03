import { describe, expect, it } from 'bun:test'
import * as parser from '../route-parser'
import { routes } from '../routes'
import { getNavigationStateKey, parseNavigationStateKey, type NavigationState } from '../types'

// These fixtures catch dropped raw addresses, permissive prefix matching,
// malformed URI exceptions, and accidentally routing action links as views.
const unavailableRoutes = [
  '', 'not-a-route', 'not-a-route?keep=a%2Fb&next=%3F',
  'knowledge/unknown/doc', 'knowledge/document', 'knowledge/view',
  'settings/unknown', 'settings/shortcuts/extra',
  'sources/api/wrong', 'sources/source', 'sources/api/source',
  'skills/skill', 'projects/project', 'pages/page', 'browser/instance',
  'allSessions/session', 'allSessions/wrong/id', 'state/todo/session',
  'label/work/session/a/extra', 'board/session/a/extra', 'table/extra',
  'notes/note/a/extra', 'knowledge/document/a/extra', 'cloud-run/a/extra',
  'terminal/a/extra', 'extension/plugin/view/extra', 'diff/a/extra',
  'tasks/task/a/extra', 'meetings/meeting/a/extra', 'inbox/item/a/extra',
  'feed/item/a/extra', 'radar/item/a/extra', 'home/extra', 'connections/extra',
  'sources//source/a', '/allSessions', 'allSessions/',
  'notes/note/%E0%A4%A', 'label/%', 'terminal/%GG', 'radar/item/%E0%A4%A',
  'search?q=%E0%A4%A', 'sources/source/a?stray=%',
  'action/new-session', 'action/delete-session/selected', 'action/unknown',
  'javascript:alert(1)', 'https://example.com/allSessions',
  'terminal/selected#fragment', 'cloud-run/selected\nother', 'unknown/\ud800',
]

function resolve(route: string, sidebar?: string): NavigationState {
  const boundary = (parser as typeof parser & {
    parseRouteToNavigationStateOrUnavailable?: (route: string, sidebar?: string) => NavigationState
  }).parseRouteToNavigationStateOrUnavailable
  expect(boundary).toBeFunction()
  return boundary!(route, sidebar)
}

describe('UI-001 raw view route preservation', () => {
  for (const route of unavailableRoutes) {
    it(`preserves unavailable raw route ${JSON.stringify(route)}`, () => {
      const state = resolve(route)
      expect(state).toEqual({ navigator: 'unavailable', route, details: null })
      expect(parser.buildRouteFromNavigationState(state)).toBe(route)
      expect(resolve(parser.buildRouteFromNavigationState(state))).toEqual(state)
    })
  }

  it('keeps unavailable addresses distinct when navigation keys are stored and restored', () => {
    const first = resolve('sources/source/a/extra')
    const second = resolve('sources/source/a/other')
    expect(getNavigationStateKey(first)).not.toBe(getNavigationStateKey(second))
    expect(parseNavigationStateKey(getNavigationStateKey(first))).toEqual(first)
    expect(parseNavigationStateKey(getNavigationStateKey(second))).toEqual(second)
  })

  it('retains a requested sidebar without replacing the unavailable raw route', () => {
    expect(resolve('not-a-route?keep=%2F', 'files/src/main.ts')).toEqual({
      navigator: 'unavailable', route: 'not-a-route?keep=%2F', details: null,
      rightSidebar: { type: 'files', path: 'src/main.ts' },
    })
  })

  it('restores raw malformed addresses safely and rejects corrupt saved keys', () => {
    for (const route of ['notes/note/%E0%A4%A', 'unknown/\ud800']) {
      const state = resolve(route)
      expect(parseNavigationStateKey(getNavigationStateKey(state))).toEqual(state)
    }
    for (const key of ['notes/note/%E0%A4%A', 'unavailable:123', 'unavailable:"unterminated']) {
      expect(() => parseNavigationStateKey(key)).not.toThrow()
      expect(parseNavigationStateKey(key)).toBeNull()
    }
  })

  const validRoutes: Array<[string, string, Record<string, unknown>]> = [
    ['allSessions/session/selected', 'allSessions/session/selected', { navigator: 'sessions', details: { type: 'session', sessionId: 'selected' } }],
    ['flagged/session/selected', 'flagged/session/selected', { navigator: 'sessions', filter: { kind: 'flagged' } }],
    ['state/todo/session/selected', 'state/todo/session/selected', { navigator: 'sessions', filter: { kind: 'state', stateId: 'todo' } }],
    ['label/work/session/selected', 'label/work/session/selected', { navigator: 'sessions', filter: { kind: 'label', labelId: 'work' } }],
    ['view/custom/session/selected', 'view/custom/session/selected', { navigator: 'sessions', filter: { kind: 'view', viewId: 'custom' } }],
    ['board/session/selected', 'board/session/selected', { navigator: 'sessions', viewMode: 'board', details: { type: 'session', sessionId: 'selected' } }],
    ['sources/api/source/selected', 'sources/api/source/selected', { navigator: 'sources', filter: { kind: 'type', sourceType: 'api' }, details: { type: 'source', sourceSlug: 'selected' } }],
    ['skills/skill/selected', 'skills/skill/selected', { navigator: 'skills', details: { type: 'skill', skillSlug: 'selected' } }],
    ['projects/project/selected', 'projects/project/selected', { navigator: 'projects', details: { type: 'project', projectSlug: 'selected' } }],
    ['pages/page/selected', 'pages/page/selected', { navigator: 'pages', details: { type: 'page', pageSlug: 'selected' } }],
    ['notes/note/folder%2Fmy%20note.md', 'notes/note/folder%2Fmy%20note.md', { navigator: 'notes', details: { type: 'note', noteId: 'folder/my note.md' } }],
    ['knowledge/document/doc%2Fwith%20space', 'knowledge/document/doc%2Fwith%20space', { navigator: 'knowledge', details: { type: 'knowledge', kind: 'document', id: 'doc/with space' } }],
    ['knowledge/view/custom', 'knowledge/view/custom', { navigator: 'knowledge', details: { type: 'knowledge-view', viewId: 'custom' } }],
    ['cloud-run/run%2F1', 'cloud-run/run%2F1', { navigator: 'cloud-run', details: { type: 'cloud-run', runId: 'run/1' } }],
    ['terminal/term%2F1', 'terminal/term%2F1', { navigator: 'terminal', details: { type: 'terminal', id: 'term/1' } }],
    ['extension/plugin%2F1/view%20one', 'extension/plugin%2F1/view%20one', { navigator: 'extension', details: { type: 'extension', extensionId: 'plugin/1', viewId: 'view one' } }],
    ['extension/plugin', 'extension/plugin', { navigator: 'extension', details: { type: 'extension', extensionId: 'plugin' } }],
    ['diff/proposal%2F1', 'diff/proposal%2F1', { navigator: 'diff', details: { type: 'diff', proposalId: 'proposal/1' } }],
    ['browser/instance/selected', 'browser/instance/selected', { navigator: 'browser', details: { type: 'browser', id: 'selected' } }],
    ['automations/scheduled/automation/selected', 'automations/scheduled/automation/selected', { navigator: 'automations', filter: { kind: 'type', automationType: 'scheduled' }, details: { type: 'automation', automationId: 'selected' } }],
    ['tasks/task/a%2Fb', 'tasks/task/a%2Fb', { navigator: 'tasks', details: { type: 'task', taskId: 'a/b' } }],
    ['meetings/meeting/a%2Fb', 'meetings/meeting/a%2Fb', { navigator: 'meetings', details: { type: 'meeting', meetingId: 'a/b' } }],
    ['inbox/item/a%2Fb', 'inbox/item/a%2Fb', { navigator: 'inbox', details: { type: 'item', itemId: 'a/b' } }],
    ['feed/item/a%2Fb', 'feed/item/a%2Fb', { navigator: 'feed', details: { type: 'item', itemId: 'a/b' } }],
    ['radar/item/a%2Fb', 'radar/item/a%2Fb', { navigator: 'screen', screen: 'radar', details: { type: 'item', itemId: 'a/b' } }],
    ['search?q=notes%20%26%20sessions', 'search?q=notes+%26+sessions', { navigator: 'search', query: 'notes & sessions' }],
    ['settings/toolchain', 'settings/runtime', { navigator: 'settings', subpage: 'runtime' }],
    ['settings/preferences', 'settings/context', { navigator: 'settings', subpage: 'context' }],
  ]
  for (const [route, canonical, expected] of validRoutes) {
    it(`keeps valid route behavior for ${route}`, () => {
      const state = resolve(route)
      expect(state).toMatchObject(expected)
      const legacyState = parser.parseRouteToNavigationState(route)
      expect(legacyState).not.toBeNull()
      expect(state).toEqual(legacyState!)
      expect(parser.buildRouteFromNavigationState(state)).toBe(canonical)
    })
  }

  for (const root of ['allSessions', 'flagged', 'archived', 'board', 'table', 'heatmap', 'sources', 'skills', 'notes', 'automations', 'projects', 'pages', 'settings', 'memory', 'tasks', 'meetings', 'inbox', 'feed', 'home', 'connections', 'knowledge', 'cloud-run', 'terminal', 'extension', 'diff', 'dossier', 'radar', 'decisions', 'agents', 'focus']) {
    it(`keeps the supported bare root ${root}`, () => {
      const state = resolve(root)
      expect(state.navigator).not.toBe('unavailable')
      expect(parser.buildRouteFromNavigationState(state)).toBe(root)
    })
  }

  it('retains the public null contract for unsupported and action routes', () => {
    expect(parser.parseRouteToNavigationState('not-a-route')).toBeNull()
    expect(parser.parseRouteToNavigationState('action/new-session')).toBeNull()
    expect(parser.parseRoute('action/copy?text=100%25+done')).toEqual({
      type: 'action', name: 'copy', id: undefined, params: { text: '100% done' },
    })
  })

  it('round-trips encoded browser instance IDs through the public builder and view boundary', () => {
    const route = routes.view.browser('browser,b:c/with space')
    expect(route).toBe('browser/instance/browser%2Cb%3Ac%2Fwith%20space')
    const state = resolve(route)
    expect(state).toEqual({ navigator: 'browser', details: { type: 'browser', id: 'browser,b:c/with space' } })
    expect(parser.buildRouteFromNavigationState(state)).toBe(route)
  })

  it('malformed percent encoding never throws from public route parsers', () => {
    for (const route of ['notes/note/%E0%A4%A', 'label/%', 'terminal/%GG']) {
      expect(() => parser.parseCompoundRoute(route)).not.toThrow()
      expect(parser.parseCompoundRoute(route)).toBeNull()
      expect(() => parser.parseRouteToNavigationState(route)).not.toThrow()
      expect(parser.parseRouteToNavigationState(route)).toBeNull()
      expect(parser.parseRoute(route)).toBeNull()
    }
    expect(parser.parseRoute('action/delete-session/%E0%A4%A')).toBeNull()
  })
})

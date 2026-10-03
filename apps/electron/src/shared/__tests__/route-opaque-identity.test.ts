import { describe, expect, it } from 'bun:test'
import { buildRouteFromNavigationState, resolveViewRoute } from '../route-parser'
import { decodePanelEntries, encodePanelEntries } from '../../renderer/lib/panel-url'
import { routes } from '../routes'

describe('opaque route identity through published rest-of-path aliases', () => {
  const cases = [
    ['knowledge/document/a//b', routes.view.siyuan({ kind: 'document', id: 'a//b' })],
    ['knowledge/view/a//b/', routes.view.knowledgeView('a//b/')],
    ['cloud-run/a//b', routes.view.cloudRun('a//b')],
    ['terminal/a//b/', routes.view.terminal('a//b/')],
    ['diff/a//b', routes.view.proposal('a//b')],
    ['extension/plugin/a//b', routes.view.extension('plugin', 'a//b')],
    ['knowledge//document/a//b', routes.view.siyuan({ kind: 'document', id: 'a//b' })],
    ['terminal/a%252F//b', routes.view.terminal('a%2F//b')],
  ] as const
  for (const [raw, canonical] of cases) it(raw, () => {
    const state = resolveViewRoute(raw)
    expect(state.navigator).not.toBe('unavailable')
    expect(buildRouteFromNavigationState(state)).toBe(canonical)
    expect(resolveViewRoute(canonical)).toEqual(state)
    const restored = decodePanelEntries(encodePanelEntries([{ route: raw + '?keep=100%25', proportion: 1 }]))
    expect(restored).toEqual([{ route: raw + '?keep=100%25', proportion: 1 }])
    expect(resolveViewRoute(restored[0]!.route)).toEqual(state)
  })
  it('retains the filesystem Notes alias and view-only action denial', () => {
    expect(buildRouteFromNavigationState(resolveViewRoute('notes/note/folder//file'))).toBe(routes.view.notes('folder/file'))
    expect(resolveViewRoute('action/delete-session/selected')).toEqual({ navigator: 'unavailable', route: 'action/delete-session/selected', details: null })
  })
})

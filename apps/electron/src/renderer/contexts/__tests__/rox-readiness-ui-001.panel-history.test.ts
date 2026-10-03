import { expect, test } from 'bun:test'
import { buildSemanticHistoryKey, parsePanelHistory, serializePanelHistory } from '../navigation-history'

test('panel history preserves address delimiters, escapes and geometry through URLSearchParams', () => {
  const panels = ['knowledge/unknown,id/x', 'retired/surface:0.5', 'retired/a|b::c', 'sources/source/%', 'retired/"quoted"/文本']
    .map(route => ({ route, proportion: 0.2 }))
  const query = new URLSearchParams({ panels: serializePanelHistory(panels) })
  expect(parsePanelHistory(new URLSearchParams(query.toString()).get('panels')!)).toEqual(panels)
})

test('existing ratio addresses still restore without changing selected entity identities', () => {
  expect(parsePanelHistory('allSessions/session/local:1.0000,retired/surface:0.0000')).toEqual([
    { route: 'allSessions/session/local', proportion: 1 }, { route: 'retired/surface', proportion: 0 },
  ])
  expect(parsePanelHistory('retired/surface:,home:1')).toEqual([
    { route: 'retired/surface:', proportion: 0 }, { route: 'home', proportion: 1 },
  ])
})

test('corrupt structured layouts do not invent panel addresses; invalid geometry remains recoverable', () => {
  for (const value of ['json:{', 'json:null', 'json:{}', 'json:[{"route":null}]']) expect(parsePanelHistory(value)).toEqual([])
  expect(parsePanelHistory('json:[{"route":"home","proportion":1e309},{"route":"retired/surface","proportion":-1}]')).toEqual([
    { route: 'home', proportion: 0 }, { route: 'retired/surface', proportion: 0 },
  ])
})

test('semantic history keys cannot collide across route or workspace delimiters', () => {
  const input = { workspaceSlug: 'workspace', focusedPanelIndex: 0, sidebarParam: '' }
  expect(buildSemanticHistoryKey({ ...input, panelRoutes: ['retired/a|b', 'home'] }))
    .not.toBe(buildSemanticHistoryKey({ ...input, panelRoutes: ['retired/a', 'b|home'] }))
  expect(buildSemanticHistoryKey({ ...input, workspaceSlug: 'workspace::x', panelRoutes: ['home'] }))
    .not.toBe(buildSemanticHistoryKey({ ...input, panelRoutes: ['x::home'] }))
})

import { expect, test } from 'bun:test'
import { buildSemanticHistoryKey } from '../navigation-history'

test('distinct literal-pipe route stacks retain distinct semantic history entries', () => {
  const common = { workspaceSlug: 'ws', focusedPanelIndex: 1, sidebarParam: '' }
  const first = { ...common, panelRoutes: ['notes/note/a|notes/note/b', 'notes/note/c'] }
  const second = { ...common, panelRoutes: ['notes/note/a', 'notes/note/b|notes/note/c'] }
  expect(first.panelRoutes.join('|')).toBe(second.panelRoutes.join('|'))
  expect(buildSemanticHistoryKey(first)).not.toBe(buildSemanticHistoryKey(second))
  expect(buildSemanticHistoryKey({ ...first, workspaceSlug: 'ws|else' }))
    .not.toBe(buildSemanticHistoryKey({ ...first, sidebarParam: 'else' }))
  expect(buildSemanticHistoryKey(first)).toBe(buildSemanticHistoryKey({ ...first, panelRoutes: [...first.panelRoutes] }))
})

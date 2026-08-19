import { describe, expect, it } from 'bun:test'
import { parseWorkbenchLayout } from '@craft-agent/core/platform'
import { routes, type ViewRoute } from '../../../shared/routes'
import type { PanelStackEntry } from '../../atoms/panel-stack'
import { groupTabsByLayout, panelEntryToLegacy, panelStackToWorkbenchLayout, persistableWorkbenchLayout } from '../tab-groups'

function entry(id: string, route: ViewRoute, proportion = 0.5): PanelStackEntry {
  return { id, route, proportion, panelType: 'session', laneId: 'main' }
}

describe('panelStackToWorkbenchLayout', () => {
  it('maps each stack column to a one-tab group and keeps focus', () => {
    const a = routes.view.allSessions('sess-a')
    const b = routes.view.allSessions('sess-b')
    const layout = panelStackToWorkbenchLayout({
      workspaceId: 'ws-1',
      focusedPanelId: 'panel-b',
      now: 10,
      entries: [entry('panel-a', a, 0.4), entry('panel-b', b, 0.6)],
    })

    expect(layout.version).toBe(2)
    expect(layout.migratedFromVersion).toBe(1)
    expect(layout.activeGroupId).toBe('panel-b')
    expect(layout.groups).toHaveLength(2)
    expect(layout.groups[0]?.tabs).toHaveLength(1)
    expect(layout.groups[0]?.tabs[0]?.id).toBe('panel-a')
    expect(layout.groups[1]?.tabs[0]?.route).toBe(b)
  })

  it('keeps settings as a legacy-route tab', () => {
    const route = routes.view.settings()
    const legacy = panelEntryToLegacy(entry('settings', route, 1))
    expect(legacy.tab).toEqual({ kind: 'legacy-route' })
  })

  it('round-trips a derived layout through JSON + parseWorkbenchLayout', () => {
    const layout = panelStackToWorkbenchLayout({
      workspaceId: 'ws-1',
      focusedPanelId: 'panel-a',
      now: 10,
      entries: [entry('panel-a', routes.view.allSessions('sess-a'), 1)],
    })
    const persistable = persistableWorkbenchLayout(layout)
    expect(persistable).not.toBeNull()
    expect(parseWorkbenchLayout(JSON.parse(JSON.stringify(persistable)))).toEqual(persistable)
    expect(parseWorkbenchLayout({ ...layout, version: 1 })).toBeNull()
  })
})

describe('groupTabsByLayout', () => {
  it('returns a single group when there is no layout snapshot', () => {
    const tabs = [{ panelId: 'a' }, { panelId: 'b' }]
    expect(groupTabsByLayout(tabs, null)).toEqual([{ groupId: 'default', tabs }])
    expect(groupTabsByLayout([], null)).toEqual([])
  })

  it('orders tabs by layout groups and appends leftovers', () => {
    const a = routes.view.allSessions('sess-a')
    const b = routes.view.allSessions('sess-b')
    const layout = panelStackToWorkbenchLayout({
      workspaceId: 'ws-1',
      focusedPanelId: 'panel-a',
      entries: [entry('panel-a', a), entry('panel-b', b)],
    })
    const tabs = [{ panelId: 'panel-b' }, { panelId: 'panel-a' }, { panelId: 'extra' }]
    expect(groupTabsByLayout(tabs, layout)).toEqual([
      { groupId: 'panel-a', tabs: [{ panelId: 'panel-a' }] },
      { groupId: 'panel-b', tabs: [{ panelId: 'panel-b' }] },
      { groupId: 'ungrouped', tabs: [{ panelId: 'extra' }] },
    ])
  })
})

import { describe, expect, it } from 'bun:test'
import {
  activateTab,
  closeSurface,
  migrateLegacyLayout,
  moveSurface,
  openSurface,
  pinSurface,
  splitGroup,
  workbenchLayoutToPanelEntries,
  workbenchTabKey,
  type SurfaceInstance,
  type WorkbenchLayout,
} from '../workbench/index.ts'

const NOW = 1_700_000_000_000

function instance(id: string, route: string, extra?: Partial<SurfaceInstance>): SurfaceInstance {
  return {
    id,
    tab: { kind: 'session', sessionId: id },
    route,
    pinned: true,
    preview: false,
    dirty: false,
    openedAt: NOW,
    lastFocusedAt: NOW,
    ...extra,
  }
}

describe('migrateLegacyLayout', () => {
  it('maps each panel-stack entry to a one-tab group and preserves focus', () => {
    const layout = migrateLegacyLayout({
      workspaceId: 'ws-1',
      focusedId: 'panel-b',
      now: NOW,
      entries: [
        { id: 'panel-a', route: 'allSessions/session/a', tab: { kind: 'session', sessionId: 'a' }, proportion: 0.4 },
        { id: 'panel-b', route: 'browser/instance/b', tab: { kind: 'browser', tabId: 'b' }, proportion: 0.6 },
      ],
    })

    expect(layout.version).toBe(2)
    expect(layout.migratedFromVersion).toBe(1)
    expect(layout.activeGroupId).toBe('panel-b')
    expect(layout.groups).toHaveLength(2)
    expect(layout.groups[0]?.tabs).toHaveLength(1)
    expect(layout.groups[0]?.activeTabId).toBe('panel-a')
    expect(layout.groups[1]?.tabs[0]?.tab).toEqual({ kind: 'browser', tabId: 'b' })
    expect((layout.groups[0]?.proportion ?? 0) + (layout.groups[1]?.proportion ?? 0)).toBeCloseTo(1)
  })

  it('keeps legacy navigator routes as legacy-route tabs', () => {
    const layout = migrateLegacyLayout({
      workspaceId: 'ws-1',
      entries: [{ id: 'settings', route: 'settings/shortcuts', tab: { kind: 'legacy-route' } }],
    })
    expect(layout.groups[0]?.tabs[0]?.tab).toEqual({ kind: 'legacy-route' })
    expect(workbenchTabKey({ kind: 'legacy-route' }, 'settings/shortcuts')).toBe('legacy:settings/shortcuts')
  })

  it('round-trips active routes back to panel-stack entries', () => {
    const layout = migrateLegacyLayout({
      workspaceId: 'ws-1',
      entries: [
        { id: 'a', route: 'allSessions/session/a', tab: { kind: 'session', sessionId: 'a' }, proportion: 0.5 },
        { id: 'b', route: 'allSessions/session/b', tab: { kind: 'session', sessionId: 'b' }, proportion: 0.5 },
      ],
    })
    expect(workbenchLayoutToPanelEntries(layout)).toEqual([
      { id: 'a', route: 'allSessions/session/a', proportion: 0.5 },
      { id: 'b', route: 'allSessions/session/b', proportion: 0.5 },
    ])
  })
})

describe('openSurface / preview / split / move / close', () => {
  function twoColumn(): WorkbenchLayout {
    return migrateLegacyLayout({
      workspaceId: 'ws-1',
      now: NOW,
      entries: [
        { id: 'g1', route: 'allSessions/session/a', tab: { kind: 'session', sessionId: 'a' }, proportion: 0.5 },
        { id: 'g2', route: 'allSessions/session/b', tab: { kind: 'session', sessionId: 'b' }, proportion: 0.5 },
      ],
    })
  }

  it('adds a pinned tab to the active group and activates it', () => {
    const layout = openSurface(twoColumn(), instance('c', 'allSessions/session/c'), {
      target: 'active-group',
      mode: 'pinned',
      focus: true,
    })
    const active = layout.groups.find((group) => group.id === layout.activeGroupId)
    expect(active?.tabs.map((tab) => tab.id)).toEqual(['g1', 'c'])
    expect(active?.activeTabId).toBe('c')
  })

  it('replaces a non-dirty preview tab instead of stacking another preview', () => {
    const withPreview = openSurface(twoColumn(), instance('preview-1', 'allSessions/session/p1'), {
      mode: 'preview',
      focus: true,
    })
    const replaced = openSurface(withPreview, instance('preview-2', 'allSessions/session/p2'), {
      mode: 'preview',
      focus: true,
    })
    const active = replaced.groups.find((group) => group.id === replaced.activeGroupId)
    expect(active?.tabs.filter((tab) => tab.preview).map((tab) => tab.id)).toEqual(['preview-2'])
  })

  it('does not replace a dirty preview', () => {
    const withPreview = openSurface(twoColumn(), instance('preview-1', 'allSessions/session/p1', { dirty: true }), {
      mode: 'preview',
    })
    const next = openSurface(withPreview, instance('preview-2', 'allSessions/session/p2'), { mode: 'preview' })
    const active = next.groups.find((group) => group.id === next.activeGroupId)
    expect(active?.tabs.map((tab) => tab.id)).toEqual(['g1', 'preview-1', 'preview-2'])
  })

  it('dedups by durable ref inside a group', () => {
    const layout = openSurface(
      twoColumn(),
      instance('other', 'allSessions/session/a', { tab: { kind: 'session', sessionId: 'a' } }),
      { mode: 'pinned' },
    )
    const active = layout.groups.find((group) => group.id === layout.activeGroupId)
    expect(active?.tabs).toHaveLength(1)
    expect(active?.tabs[0]?.id).toBe('g1')
  })

  it('open to the side creates a new group', () => {
    const layout = openSurface(
      twoColumn(),
      instance('c', 'allSessions/session/c'),
      { target: 'new-group-right', mode: 'pinned', focus: true },
      'g3',
    )
    expect(layout.groups).toHaveLength(3)
    expect(layout.activeGroupId).toBe('g3')
    expect(layout.groups.map((group) => group.proportion).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
  })

  it('split clones the active tab into a new group', () => {
    const layout = splitGroup(twoColumn(), 'g1', 'g-split', 'clone-a', NOW)
    expect(layout.groups).toHaveLength(3)
    expect(layout.activeGroupId).toBe('g-split')
    expect(layout.groups[1]?.tabs[0]?.tab).toEqual({ kind: 'session', sessionId: 'a' })
    expect(layout.groups[1]?.tabs[0]?.id).toBe('clone-a')
  })

  it('move transfers a tab and drops an emptied group', () => {
    const split = splitGroup(twoColumn(), 'g1', 'g-split', 'clone-a', NOW)
    const moved = moveSurface(split, 'clone-a', 'g2')
    expect(moved.groups.map((group) => group.id)).toEqual(['g1', 'g2'])
    expect(moved.groups[1]?.tabs.map((tab) => tab.id)).toContain('clone-a')
    expect(moved.activeGroupId).toBe('g2')
  })

  it('closing the last tab in a group removes the group', () => {
    const layout = closeSurface(twoColumn(), 'g1')
    expect(layout.groups.map((group) => group.id)).toEqual(['g2'])
    expect(layout.activeGroupId).toBe('g2')
  })

  it('activateTab updates focus timestamps', () => {
    const opened = openSurface(twoColumn(), instance('c', 'allSessions/session/c'), { mode: 'pinned' })
    const activated = activateTab(opened, 'g1', 'g1', NOW + 5)
    expect(activated.activeGroupId).toBe('g1')
    expect(activated.groups[0]?.tabs[0]?.lastFocusedAt).toBe(NOW + 5)
  })

  it('pinSurface clears preview', () => {
    const opened = openSurface(twoColumn(), instance('p', 'allSessions/session/p'), { mode: 'preview' })
    const pinned = pinSurface(opened, 'p')
    const tab = pinned.groups[0]?.tabs.find((item) => item.id === 'p')
    expect(tab?.pinned).toBe(true)
    expect(tab?.preview).toBe(false)
  })
})

import { describe, it, expect } from 'bun:test'
import type { SurfaceTab } from '../surfaces/index.ts'
import {
  activateTab,
  closeSurface,
  createEmptyWorkbenchLayout,
  getActiveSurface,
  isPinnedSurface,
  markSurfaceDirty,
  moveSurface,
  moveSurfaceToNewGroup,
  openSurface,
  pinSurface,
  WORKBENCH_LAYOUT_VERSION,
} from '../workbench/index.ts'
import type { IdGenerator, WorkbenchLayout } from '../workbench/index.ts'

function ids(): IdGenerator {
  let next = 0
  return { next: () => `id-${++next}` }
}

const sessionA: SurfaceTab = { kind: 'session', sessionId: 'session-a' }
const sessionB: SurfaceTab = { kind: 'session', sessionId: 'session-b' }
const sessionC: SurfaceTab = { kind: 'session', sessionId: 'session-c' }
const browserX: SurfaceTab = { kind: 'browser', tabId: 'browser-x' }

const NOW = 1_754_500_000_000

/**
 * Deterministic-id opener: each call starts a FRESH counter, so only use it
 * when every tab carries a distinct durable ref (dedup keys differ, so the
 * colliding instance id of a replaced preview tab can never clash).
 */
function openInActiveGroup(layout: WorkbenchLayout, tab: SurfaceTab, mode: 'preview' | 'pinned' = 'pinned') {
  return openSurface(layout, tab, { target: 'active-group', mode, focus: true }, ids(), NOW)
}

describe('openSurface', () => {
  it('creates the first group when opening into an empty layout', () => {
    const { layout, instanceId } = openSurface(
      createEmptyWorkbenchLayout('ws-1'),
      sessionA,
      { target: 'active-group', mode: 'pinned', focus: true },
      ids(),
      NOW,
    )

    expect(layout.version).toBe(WORKBENCH_LAYOUT_VERSION)
    expect(layout.groups).toHaveLength(1)
    expect(layout.groups[0]?.tabs.map((t) => t.tab)).toEqual([sessionA])
    expect(layout.groups[0]?.activeTabId).toBe(instanceId)
    expect(layout.activeGroupId).toBe(layout.groups[0]?.id ?? null)
    expect(getActiveSurface(layout)?.tab).toEqual(sessionA)
  })

  it('a preview tab is replaced by the next preview in the same group', () => {
    let layout = openInActiveGroup(createEmptyWorkbenchLayout('ws-1'), sessionA, 'preview').layout
    layout = openInActiveGroup(layout, sessionB, 'preview').layout

    const group = layout.groups[0]
    expect(group?.tabs.map((t) => t.tab)).toEqual([sessionB])
    expect(group?.tabs[0]?.preview).toBe(true)
    expect(isPinnedSurface(group!.tabs[0]!)).toBe(false)
  })

  it('a dirty preview is pinned instead of being replaced by the next preview', () => {
    const opened = openInActiveGroup(createEmptyWorkbenchLayout('ws-1'), sessionA, 'preview')
    const previewId = opened.layout.groups[0]?.tabs[0]?.id
    if (!previewId) throw new Error('expected a preview tab')
    // Dirty while still a preview (not via markSurfaceDirty, which also pins).
    const dirtyPreviewLayout = {
      ...opened.layout,
      groups: opened.layout.groups.map((g) => ({
        ...g,
        tabs: g.tabs.map((t) => (t.id === previewId ? { ...t, dirty: true } : t)),
      })),
    }

    const layout = openInActiveGroup(dirtyPreviewLayout, sessionB, 'preview').layout

    const tabs = layout.groups[0]?.tabs ?? []
    expect(tabs.map((t) => t.tab)).toEqual([sessionA, sessionB])
    expect(tabs[0]).toMatchObject({ id: previewId, dirty: true, preview: false })
    expect(tabs[1]).toMatchObject({ dirty: false, preview: true })
  })

  it('pinned tabs survive; only the preview slot gets replaced', () => {
    let layout = openInActiveGroup(createEmptyWorkbenchLayout('ws-1'), sessionA, 'pinned').layout
    layout = openInActiveGroup(layout, sessionB, 'preview').layout
    layout = openInActiveGroup(layout, sessionC, 'preview').layout

    const tabs = layout.groups[0]?.tabs ?? []
    expect(tabs.map((t) => t.tab)).toEqual([sessionA, sessionC])
    expect(tabs[0]?.preview).toBe(false)
    expect(isPinnedSurface(tabs[0]!)).toBe(true)
    expect(tabs[1]?.preview).toBe(true)
  })

  it('re-opening an already-open surface activates it instead of duplicating (durable-ref dedup)', () => {
    const gen = ids()
    let layout = openSurface(createEmptyWorkbenchLayout('ws-1'), sessionA, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW).layout
    layout = openSurface(layout, sessionB, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW).layout

    const result = openSurface(layout, sessionA, { target: 'active-group', mode: 'preview', focus: true }, gen, NOW)

    expect(result.layout.groups[0]?.tabs).toHaveLength(2)
    expect(result.layout.groups[0]?.activeTabId).toBe(result.instanceId)
    expect(getActiveSurface(result.layout)?.tab).toEqual(sessionA)
  })

  it('explicitly re-opening a preview tab with mode pinned promotes it', () => {
    let layout = openInActiveGroup(createEmptyWorkbenchLayout('ws-1'), sessionA, 'preview').layout
    const result = openInActiveGroup(layout, sessionA, 'pinned')
    layout = result.layout

    const tab = layout.groups[0]?.tabs[0]
    expect(layout.groups[0]?.tabs).toHaveLength(1)
    expect(tab?.preview).toBe(false)
    expect(isPinnedSurface(tab!)).toBe(true)
  })

  it('focus:false opens in the background without changing the active tab', () => {
    const gen = ids()
    const first = openSurface(createEmptyWorkbenchLayout('ws-1'), sessionA, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW)
    const second = openSurface(first.layout, sessionB, { target: 'active-group', mode: 'pinned', focus: false }, gen, NOW)

    expect(second.layout.groups[0]?.tabs).toHaveLength(2)
    expect(second.layout.groups[0]?.activeTabId).toBe(first.instanceId)
    expect(second.layout.activeGroupId).toBe(first.layout.activeGroupId)
  })

  it("target 'new-group-right' creates a split with a fair proportion share", () => {
    const gen = ids()
    let layout = openSurface(createEmptyWorkbenchLayout('ws-1'), sessionA, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW).layout
    const result = openSurface(layout, browserX, { target: 'new-group-right', mode: 'pinned', focus: true }, gen, NOW)
    layout = result.layout

    expect(layout.groups).toHaveLength(2)
    expect(layout.groups[1]?.tabs[0]?.tab).toEqual(browserX)
    expect(layout.activeGroupId).toBe(layout.groups[1]?.id ?? null)
    expect(layout.groups[0]?.proportion).toBeCloseTo(0.5)
    expect(layout.groups[1]?.proportion).toBeCloseTo(0.5)
  })

  it("target 'new-window' is a host concern: the layout is unchanged", () => {
    const layout = openInActiveGroup(createEmptyWorkbenchLayout('ws-1'), sessionA).layout

    const result = openSurface(layout, sessionB, { target: 'new-window', mode: 'pinned', focus: true }, ids(), NOW)

    expect(result.layout).toBe(layout)
    expect(result.instanceId).toBeNull()
  })
})

describe('closeSurface', () => {
  it('closing a tab moves the active tab to its neighbor', () => {
    const gen = ids()
    let layout = openSurface(createEmptyWorkbenchLayout('ws-1'), sessionA, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW).layout
    layout = openSurface(layout, sessionB, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW).layout
    layout = openSurface(layout, sessionC, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW).layout
    const group = layout.groups[0]
    const bId = group?.tabs[1]?.id
    if (!group || !bId) throw new Error('expected three tabs')

    layout = activateTab(layout, group.id, bId, NOW)
    const closed = closeSurface(layout, bId)
    expect(closed.ok).toBe(true)
    layout = closed.layout

    const after = layout.groups[0]
    expect(after?.tabs.map((t) => t.tab)).toEqual([sessionA, sessionC])
    expect(after?.activeTabId).toBe(after?.tabs[1]?.id) // next neighbor (sessionC)
  })

  it('closing the last tab closes the group and activates the surviving one', () => {
    const gen = ids()
    let layout = openSurface(createEmptyWorkbenchLayout('ws-1'), sessionA, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW).layout
    layout = openSurface(layout, browserX, { target: 'new-group-right', mode: 'pinned', focus: true }, gen, NOW).layout
    const secondGroupId = layout.groups[1]?.id
    const browserInstanceId = layout.groups[1]?.tabs[0]?.id
    if (!secondGroupId || !browserInstanceId) throw new Error('expected two groups')

    const closed = closeSurface(layout, browserInstanceId)
    expect(closed.ok).toBe(true)
    layout = closed.layout

    expect(layout.groups).toHaveLength(1)
    expect(layout.groups[0]?.tabs[0]?.tab).toEqual(sessionA)
    expect(layout.activeGroupId).toBe(layout.groups[0]?.id ?? null)
    expect(layout.groups[0]?.proportion).toBeCloseTo(1)
  })

  it('closing an unknown instance is a no-op', () => {
    const layout = openInActiveGroup(createEmptyWorkbenchLayout('ws-1'), sessionA).layout

    const result = closeSurface(layout, 'missing')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected NOT_FOUND')
    expect(result.code).toBe('NOT_FOUND')
    expect(result.layout).toBe(layout)
  })

  it('refuses to close a dirty tab unless force is set', () => {
    let layout = openInActiveGroup(createEmptyWorkbenchLayout('ws-1'), sessionA, 'pinned').layout
    const instanceId = layout.groups[0]?.tabs[0]?.id
    if (!instanceId) throw new Error('expected a tab')
    layout = markSurfaceDirty(layout, instanceId, true)

    const denied = closeSurface(layout, instanceId)
    expect(denied.ok).toBe(false)
    if (denied.ok) throw new Error('expected DIRTY_SURFACE')
    expect(denied.code).toBe('DIRTY_SURFACE')
    expect(denied.layout).toBe(layout)
    expect(denied.layout.groups[0]?.tabs).toHaveLength(1)

    const forced = closeSurface(layout, instanceId, { force: true })
    expect(forced.ok).toBe(true)
    expect(forced.layout.groups).toHaveLength(0)
  })
})

describe('pin / dirty', () => {
  it('pinSurface promotes a preview tab', () => {
    let layout = openInActiveGroup(createEmptyWorkbenchLayout('ws-1'), sessionA, 'preview').layout
    const instanceId = layout.groups[0]?.tabs[0]?.id
    if (!instanceId) throw new Error('expected a tab')

    layout = pinSurface(layout, instanceId)

    expect(layout.groups[0]?.tabs[0]?.preview).toBe(false)
    expect(isPinnedSurface(layout.groups[0]!.tabs[0]!)).toBe(true)
  })

  it('editing (dirty) a preview tab pins it; clearing dirty keeps it pinned', () => {
    let layout = openInActiveGroup(createEmptyWorkbenchLayout('ws-1'), sessionA, 'preview').layout
    const instanceId = layout.groups[0]?.tabs[0]?.id
    if (!instanceId) throw new Error('expected a tab')

    layout = markSurfaceDirty(layout, instanceId, true)
    expect(layout.groups[0]?.tabs[0]).toMatchObject({ dirty: true, preview: false })

    layout = markSurfaceDirty(layout, instanceId, false)
    expect(layout.groups[0]?.tabs[0]).toMatchObject({ dirty: false, preview: false })
  })
})

describe('moveSurface', () => {
  function twoGroupLayout() {
    const gen = ids()
    let layout = openSurface(createEmptyWorkbenchLayout('ws-1'), sessionA, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW).layout
    layout = openSurface(layout, sessionB, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW).layout
    layout = openSurface(layout, browserX, { target: 'new-group-right', mode: 'pinned', focus: true }, gen, NOW).layout
    return layout
  }

  it('moves a tab into another group, activates it and promotes to pinned', () => {
    let layout = twoGroupLayout()
    const sourceGroupId = layout.groups[0]?.id
    const targetGroupId = layout.groups[1]?.id
    const sessionAId = layout.groups[0]?.tabs[0]?.id
    if (!sourceGroupId || !targetGroupId || !sessionAId) throw new Error('expected two groups')

    layout = moveSurface(layout, sessionAId, targetGroupId, undefined, NOW)

    expect(layout.groups[0]?.tabs.map((t) => t.tab)).toEqual([sessionB])
    expect(layout.groups[1]?.tabs.map((t) => t.tab)).toEqual([browserX, sessionA])
    expect(layout.groups[1]?.activeTabId).toBe(sessionAId)
    expect(layout.activeGroupId).toBe(targetGroupId)
  })

  it('emptying the source group closes it', () => {
    let layout = twoGroupLayout()
    const [source, target] = layout.groups
    const browserId = target?.tabs[0]?.id
    if (!source || !target || !browserId) throw new Error('expected two groups')

    layout = moveSurface(layout, browserId, source.id, undefined, NOW)

    expect(layout.groups).toHaveLength(1)
    expect(layout.groups[0]?.tabs.map((t) => t.tab)).toEqual([sessionA, sessionB, browserX])
    expect(layout.activeGroupId).toBe(source.id)
  })

  it('reorders within the same group', () => {
    let layout = twoGroupLayout()
    const group = layout.groups[0]
    const sessionAId = group?.tabs[0]?.id
    if (!group || !sessionAId) throw new Error('expected tabs')

    layout = moveSurface(layout, sessionAId, group.id, 1, NOW)

    expect(layout.groups[0]?.tabs.map((t) => t.tab)).toEqual([sessionB, sessionA])
  })
})

describe('moveSurfaceToNewGroup (drag-to-edge split)', () => {
  it('moves a tab out of a multi-tab group into a new adjacent group', () => {
    const gen = ids()
    let layout = openSurface(createEmptyWorkbenchLayout('ws-1'), sessionA, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW).layout
    layout = openSurface(layout, sessionB, { target: 'active-group', mode: 'pinned', focus: true }, gen, NOW).layout
    const sessionBId = layout.groups[0]?.tabs[1]?.id
    if (!sessionBId) throw new Error('expected two tabs')

    const result = moveSurfaceToNewGroup(layout, sessionBId, ids(), NOW)
    layout = result.layout

    expect(result.groupId).not.toBeNull()
    expect(layout.groups).toHaveLength(2)
    expect(layout.groups[0]?.tabs.map((t) => t.tab)).toEqual([sessionA])
    expect(layout.groups[1]?.tabs.map((t) => t.tab)).toEqual([sessionB])
    expect(layout.activeGroupId).toBe(result.groupId)
    const total = layout.groups.reduce((sum, g) => sum + g.proportion, 0)
    expect(total).toBeCloseTo(1)
  })

  it('moving the only tab out of its group still yields exactly one group with that tab', () => {
    const layout = openInActiveGroup(createEmptyWorkbenchLayout('ws-1'), sessionA).layout
    const onlyId = layout.groups[0]?.tabs[0]?.id
    if (!onlyId) throw new Error('expected a tab')

    const result = moveSurfaceToNewGroup(layout, onlyId, ids(), NOW)

    expect(result.layout.groups).toHaveLength(1)
    expect(result.layout.groups[0]?.tabs[0]?.id).toBe(onlyId)
    expect(result.layout.activeGroupId).toBe(result.groupId)
  })
})

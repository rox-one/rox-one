import { describe, expect, it } from 'bun:test'
import {
  createInMemoryWorkbenchLayoutHost,
  parseWorkbenchLayout,
  type SurfaceInstance,
} from '../workbench/index.ts'

const NOW = 1_700_000_000_000

function instance(id: string, sessionId: string): SurfaceInstance {
  return {
    id,
    tab: { kind: 'session', sessionId },
    route: `allSessions/session/${sessionId}`,
    preview: false,
    dirty: false,
    openedAt: NOW,
    lastFocusedAt: NOW,
  }
}

describe('createInMemoryWorkbenchLayoutHost', () => {
  it('restore/serialize round-trips a WorkbenchLayout', () => {
    const host = createInMemoryWorkbenchLayoutHost({ workspaceId: 'ws-1', now: () => NOW })
    host.open(instance('a', 'session-a'), { target: 'active-group', mode: 'pinned', focus: true })
    host.open(instance('b', 'session-b'), { target: 'new-group-right', mode: 'pinned', focus: true }, 'g-b')

    const serialized = host.serializeLayout()
    expect(serialized.version).toBe(2)
    expect(serialized.groups).toHaveLength(2)

    const other = createInMemoryWorkbenchLayoutHost({ workspaceId: 'ws-1', now: () => NOW })
    expect(other.restore(serialized)).toBe(true)
    expect(other.serializeLayout()).toEqual(serialized)
    expect(parseWorkbenchLayout(JSON.parse(JSON.stringify(other.serializeLayout())))).toEqual(serialized)
  })

  it('close of a dirty tab without force is DIRTY_SURFACE', () => {
    const host = createInMemoryWorkbenchLayoutHost({ workspaceId: 'ws-1', now: () => NOW })
    host.open(instance('a', 'session-a'), { mode: 'pinned', focus: true })
    const layout = host.layout()
    const dirty = {
      ...layout,
      groups: layout.groups.map((group) => ({
        ...group,
        tabs: group.tabs.map((tab) => (tab.id === 'a' ? { ...tab, dirty: true } : tab)),
      })),
    }
    expect(host.restore(dirty)).toBe(true)

    const denied = host.close('a')
    expect(denied.ok).toBe(false)
    if (denied.ok) throw new Error('expected DIRTY_SURFACE')
    expect(denied.code).toBe('DIRTY_SURFACE')
    expect(host.layout().groups[0]?.tabs).toHaveLength(1)

    const forced = host.close('a', { force: true })
    expect(forced.ok).toBe(true)
    expect(host.layout().groups).toHaveLength(0)
  })

  it('restore and serialize copy the layout so callers cannot mutate host state', () => {
    const host = createInMemoryWorkbenchLayoutHost({ workspaceId: 'ws-1', now: () => NOW })
    host.open(instance('a', 'session-a'), { target: 'active-group', mode: 'pinned', focus: true })

    const serialized = host.serializeLayout()
    serialized.groups = []
    expect(host.layout().groups).toHaveLength(1)

    const input = structuredClone(host.serializeLayout())
    expect(host.restore(input)).toBe(true)
    input.groups = []
    expect(host.layout().groups).toHaveLength(1)
    host.layout().groups = []
    expect(host.serializeLayout().groups).toHaveLength(1)
  })

  it('restore of invalid JSON leaves the current layout', () => {
    const host = createInMemoryWorkbenchLayoutHost({ workspaceId: 'ws-1', now: () => NOW })
    host.open(instance('a', 'session-a'), { mode: 'pinned', focus: true })
    expect(host.restore({ version: 1, workspaceId: 'ws-1' })).toBe(false)
    expect(host.layout().groups).toHaveLength(1)
  })
})

import { describe, it, expect } from 'bun:test'
import type { SurfaceTab } from '../surfaces/index.ts'
import {
  createEmptyWorkbenchLayout,
  createInMemoryWorkspaceSurfaceHost,
  parseWorkbenchLayout,
  WORKBENCH_LAYOUT_VERSION,
} from '../workbench/index.ts'
import type { IdGenerator } from '../workbench/index.ts'

function ids(): IdGenerator {
  let next = 0
  return { next: () => `id-${++next}` }
}

const sessionA: SurfaceTab = { kind: 'session', sessionId: 'session-a' }
const sessionB: SurfaceTab = { kind: 'session', sessionId: 'session-b' }
const browserX: SurfaceTab = { kind: 'browser', tabId: 'browser-x' }
const NOW = 1_754_500_000_000

describe('createInMemoryWorkspaceSurfaceHost', () => {
  it('restore/serialize round-trips a WorkbenchLayout', async () => {
    const host = createInMemoryWorkspaceSurfaceHost({ workspaceId: 'ws-1', ids: ids(), now: () => NOW })
    host.open(sessionA, { target: 'active-group', mode: 'pinned', focus: true })
    host.open(browserX, { target: 'new-group-right', mode: 'pinned', focus: true })

    const serialized = host.serializeLayout()
    expect(serialized.version).toBe(WORKBENCH_LAYOUT_VERSION)
    expect(serialized.groups).toHaveLength(2)

    const other = createInMemoryWorkspaceSurfaceHost({ workspaceId: 'ws-1', ids: ids(), now: () => NOW })
    await other.restore(serialized)

    expect(other.serializeLayout()).toEqual(serialized)
    expect(parseWorkbenchLayout(JSON.parse(JSON.stringify(other.serializeLayout())))).toEqual(serialized)
  })

  it('split right and down both insert a 1D group to the right', () => {
    const host = createInMemoryWorkspaceSurfaceHost({ workspaceId: 'ws-1', ids: ids(), now: () => NOW })
    const aId = host.open(sessionA, { target: 'active-group', mode: 'pinned', focus: true })
    const bId = host.open(sessionB, { target: 'active-group', mode: 'pinned', focus: true })
    const cId = host.open(browserX, { target: 'active-group', mode: 'pinned', focus: true })
    if (!aId || !bId || !cId) throw new Error('expected three tabs')

    const rightGroupId = host.split(bId, 'right')
    expect(rightGroupId).toBeTruthy()
    expect(host.layout().groups).toHaveLength(2)
    expect(host.layout().groups[1]?.id).toBe(rightGroupId as string)

    const downGroupId = host.split(cId, 'down')
    expect(host.layout().groups).toHaveLength(3)
    expect(downGroupId).not.toBe(rightGroupId)
    const total = host.layout().groups.reduce((sum, g) => sum + g.proportion, 0)
    expect(total).toBeCloseTo(1)
  })

  it('close of a dirty tab without force is DIRTY_SURFACE', async () => {
    const host = createInMemoryWorkspaceSurfaceHost({ workspaceId: 'ws-1', ids: ids(), now: () => NOW })
    const id = host.open(sessionA, { mode: 'pinned', focus: true })
    if (!id) throw new Error('expected an instance')
    const layout = host.layout()
    const dirty = {
      ...layout,
      groups: layout.groups.map((g) => ({
        ...g,
        tabs: g.tabs.map((t) => (t.id === id ? { ...t, dirty: true } : t)),
      })),
    }
    await host.restore(dirty)

    const denied = host.close(id)
    expect(denied.ok).toBe(false)
    if (denied.ok) throw new Error('expected DIRTY_SURFACE')
    expect(denied.code).toBe('DIRTY_SURFACE')
    expect(host.layout().groups[0]?.tabs).toHaveLength(1)

    const forced = host.close(id, { force: true })
    expect(forced.ok).toBe(true)
    expect(host.layout().groups).toHaveLength(0)
  })

  it('starts from an empty layout for the given workspace', () => {
    const host = createInMemoryWorkspaceSurfaceHost({ workspaceId: 'ws-9' })
    expect(host.layout()).toEqual(createEmptyWorkbenchLayout('ws-9'))
  })
})

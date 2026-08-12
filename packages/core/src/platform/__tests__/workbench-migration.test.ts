import { describe, it, expect } from 'bun:test'
import type { SurfaceLayoutSnapshot, SurfaceTab } from '../surfaces/index.ts'
import {
  migrateSurfaceLayoutSnapshotToWorkbench,
  parseWorkbenchLayout,
  WORKBENCH_LAYOUT_VERSION,
} from '../workbench/index.ts'

const SAVED_AT = 1_754_500_000_000

const sessionA: SurfaceTab = { kind: 'session', sessionId: 'session-a' }
const browserX: SurfaceTab = { kind: 'browser', tabId: 'browser-x' }
const cloudRun: SurfaceTab = { kind: 'cloud-run', runId: 'run-1' }

function snapshot(tabs: SurfaceLayoutSnapshot['tabs'], focusedIndex = 0): SurfaceLayoutSnapshot {
  return {
    version: 1,
    workspaceId: 'ws-1',
    lanes: [{ laneId: 'main', locked: false }],
    tabs,
    focusedIndex,
    savedAt: SAVED_AT,
  }
}

function entry(panelId: string, tab: SurfaceTab, proportion: number): SurfaceLayoutSnapshot['tabs'][number] {
  return { panelId, laneId: 'main', tab, proportion }
}

describe('migrateSurfaceLayoutSnapshotToWorkbench (ADR-0001 §Rollout)', () => {
  it('an empty snapshot migrates to an empty layout', () => {
    const layout = migrateSurfaceLayoutSnapshotToWorkbench(snapshot([]))

    expect(layout).toEqual({
      version: WORKBENCH_LAYOUT_VERSION,
      workspaceId: 'ws-1',
      groups: [],
      activeGroupId: null,
    })
  })

  it('every legacy panel becomes a single-tab group keyed by its panelId', () => {
    const layout = migrateSurfaceLayoutSnapshotToWorkbench(
      snapshot([
        entry('panel-0', sessionA, 0.5),
        entry('panel-1', browserX, 0.25),
        entry('panel-2', cloudRun, 0.25),
      ]),
    )

    expect(layout.groups.map((g) => g.id)).toEqual(['panel-0', 'panel-1', 'panel-2'])
    expect(layout.groups.map((g) => g.tabs.map((t) => t.tab))).toEqual([
      [sessionA],
      [browserX],
      [cloudRun],
    ])
    // Deterministic instance ids keep restart restore stable.
    expect(layout.groups[1]?.tabs[0]?.id).toBe('panel-1/tab-0')
    expect(layout.groups[1]?.activeTabId).toBe('panel-1/tab-0')
    // Migrated tabs are real tabs, never previews.
    expect(layout.groups[0]?.tabs[0]).toMatchObject({
      pinned: true,
      preview: false,
      dirty: false,
      openedAt: SAVED_AT,
      lastFocusedAt: SAVED_AT,
    })
  })

  it('focusedIndex selects the active group and is clamped into range', () => {
    const tabs = [entry('panel-0', sessionA, 0.5), entry('panel-1', browserX, 0.5)]

    expect(migrateSurfaceLayoutSnapshotToWorkbench(snapshot(tabs, 1)).activeGroupId).toBe('panel-1')
    expect(migrateSurfaceLayoutSnapshotToWorkbench(snapshot(tabs, 99)).activeGroupId).toBe('panel-1')
    expect(migrateSurfaceLayoutSnapshotToWorkbench(snapshot(tabs, -5)).activeGroupId).toBe('panel-0')
  })

  it('proportions are normalized to sum 1 even for degenerate input', () => {
    const layout = migrateSurfaceLayoutSnapshotToWorkbench(
      snapshot([entry('panel-0', sessionA, 0), entry('panel-1', browserX, 0)]),
    )

    expect(layout.groups[0]?.proportion).toBeCloseTo(0.5)
    expect(layout.groups[1]?.proportion).toBeCloseTo(0.5)
  })

  it('the migration result round-trips through JSON and parseWorkbenchLayout', () => {
    const layout = migrateSurfaceLayoutSnapshotToWorkbench(
      snapshot([entry('panel-0', sessionA, 1)], 0),
    )

    const restored = parseWorkbenchLayout(JSON.parse(JSON.stringify(layout)))

    expect(restored).toEqual(layout)
  })

  it('the source snapshot is not mutated', () => {
    const source = snapshot([entry('panel-0', sessionA, 1)])
    const before = JSON.stringify(source)

    migrateSurfaceLayoutSnapshotToWorkbench(source)

    expect(JSON.stringify(source)).toBe(before)
  })
})

describe('parseWorkbenchLayout', () => {
  it('rejects v1 snapshots — migration must be explicit', () => {
    const v1 = snapshot([entry('panel-0', sessionA, 1)])

    expect(parseWorkbenchLayout(JSON.parse(JSON.stringify(v1)))).toBeNull()
  })

  it('rejects garbage without throwing', () => {
    expect(parseWorkbenchLayout(null)).toBeNull()
    expect(parseWorkbenchLayout(undefined)).toBeNull()
    expect(parseWorkbenchLayout('layout')).toBeNull()
    expect(parseWorkbenchLayout(42)).toBeNull()
    expect(parseWorkbenchLayout({ version: 3, workspaceId: 'ws-1', groups: [], activeGroupId: null })).toBeNull()
    expect(parseWorkbenchLayout({ version: 2, workspaceId: 'ws-1', groups: 'nope', activeGroupId: null })).toBeNull()
    expect(
      parseWorkbenchLayout({ version: 2, workspaceId: 'ws-1', groups: [{ id: 1, tabs: [], proportion: 1 }], activeGroupId: null }),
    ).toBeNull()
  })
})

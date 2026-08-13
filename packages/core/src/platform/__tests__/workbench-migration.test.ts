import { describe, it, expect } from 'bun:test'
import type { SurfaceLayoutSnapshot, SurfaceTab } from '../surfaces/index.ts'
import {
  migrateSurfaceLayoutSnapshotToWorkbench,
  migrateWorkbenchToSurfaceLayoutSnapshot,
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

describe('migrateWorkbenchToSurfaceLayoutSnapshot (v2 → v1 rollback)', () => {
  it('flattens every tab into its own v1 panel so no surface is lost', () => {
    const v2 = migrateSurfaceLayoutSnapshotToWorkbench(
      snapshot([
        entry('panel-0', sessionA, 0.5),
        entry('panel-1', browserX, 0.5),
      ], 1),
    )
    const back = migrateWorkbenchToSurfaceLayoutSnapshot(v2, { savedAt: SAVED_AT })

    expect(back.version).toBe(1)
    expect(back.workspaceId).toBe('ws-1')
    expect(back.tabs.map((t) => t.tab)).toEqual([sessionA, browserX])
    expect(back.focusedIndex).toBe(1)
    expect(back.tabs[0]?.proportion).toBeCloseTo(0.5)
    expect(back.tabs[1]?.proportion).toBeCloseTo(0.5)
  })

  it('splits a multi-tab group share equally across its tabs', () => {
    const layout = {
      version: WORKBENCH_LAYOUT_VERSION,
      workspaceId: 'ws-1',
      groups: [
        {
          id: 'g1',
          proportion: 1,
          activeTabId: 't2',
          tabs: [
            {
              id: 't1',
              tab: sessionA,
              preview: false,
              dirty: false,
              openedAt: SAVED_AT,
              lastFocusedAt: SAVED_AT,
            },
            {
              id: 't2',
              tab: browserX,
              preview: false,
              dirty: false,
              openedAt: SAVED_AT,
              lastFocusedAt: SAVED_AT,
            },
          ],
        },
      ],
      activeGroupId: 'g1',
    }
    const back = migrateWorkbenchToSurfaceLayoutSnapshot(layout, { savedAt: SAVED_AT })

    expect(back.tabs).toHaveLength(2)
    expect(back.tabs.map((t) => t.tab)).toEqual([sessionA, browserX])
    expect(back.tabs[0]?.proportion).toBeCloseTo(0.5)
    expect(back.tabs[1]?.proportion).toBeCloseTo(0.5)
    expect(back.focusedIndex).toBe(1)
  })
})

describe('parseWorkbenchLayout', () => {
  it('rejects v1 snapshots — migration must be explicit', () => {
    const v1 = snapshot([entry('panel-0', sessionA, 1)])

    expect(parseWorkbenchLayout(JSON.parse(JSON.stringify(v1)))).toBeNull()
  })

  it('rejects a layout whose activeTabId is not in the group', () => {
    expect(
      parseWorkbenchLayout({
        version: 2,
        workspaceId: 'ws-1',
        groups: [
          {
            id: 'g1',
            tabs: [
              {
                id: 't1',
                tab: sessionA,
                preview: false,
                dirty: false,
                openedAt: SAVED_AT,
                lastFocusedAt: SAVED_AT,
              },
            ],
            activeTabId: 'missing',
            proportion: 1,
          },
        ],
        activeGroupId: 'g1',
      }),
    ).toBeNull()
  })

  it('rejects unknown SurfaceTab kinds', () => {
    expect(
      parseWorkbenchLayout({
        version: 2,
        workspaceId: 'ws-1',
        groups: [
          {
            id: 'g1',
            tabs: [
              {
                id: 't1',
                tab: { kind: 'work-record', id: 'nope' },
                preview: false,
                dirty: false,
                openedAt: SAVED_AT,
                lastFocusedAt: SAVED_AT,
              },
            ],
            activeTabId: 't1',
            proportion: 1,
          },
        ],
        activeGroupId: 'g1',
      }),
    ).toBeNull()
  })

  it('coerces first-increment layouts that still carry pinned', () => {
    const restored = parseWorkbenchLayout({
      version: 2,
      workspaceId: 'ws-1',
      groups: [
        {
          id: 'g1',
          tabs: [
            {
              id: 't1',
              tab: sessionA,
              pinned: true,
              preview: true,
              dirty: false,
              openedAt: SAVED_AT,
              lastFocusedAt: SAVED_AT,
            },
          ],
          activeTabId: 't1',
          proportion: 1,
        },
      ],
      activeGroupId: 'g1',
    })

    expect(restored?.groups[0]?.tabs[0]).toMatchObject({
      preview: true,
      dirty: false,
    })
    expect(restored?.groups[0]?.tabs[0] && 'pinned' in restored.groups[0].tabs[0]).toBe(false)
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

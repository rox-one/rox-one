import { describe, expect, it } from 'bun:test'
import type { SurfaceTab } from '../surfaces/index.ts'
import {
  flattenWorkbenchLayoutToLegacyEntries,
  migrateLegacyLayout,
  parseWorkbenchLayout,
  parseWorkbenchTab,
} from '../workbench/index.ts'

const NOW = 1_700_000_000_000
const sessionA: SurfaceTab = { kind: 'session', sessionId: 'session-a' }

function validLayout(overrides?: Record<string, unknown>) {
  return {
    version: 2,
    workspaceId: 'ws-1',
    groups: [
      {
        id: 'g1',
        tabs: [
          {
            id: 't1',
            tab: sessionA,
            route: 'allSessions/session/session-a',
            preview: false,
            dirty: false,
            openedAt: NOW,
            lastFocusedAt: NOW,
          },
        ],
        activeTabId: 't1',
        proportion: 1,
      },
    ],
    activeGroupId: 'g1',
    ...overrides,
  }
}

describe('parseWorkbenchTab', () => {
  it('accepts SurfaceTab kinds and the legacy-route wrapper', () => {
    expect(parseWorkbenchTab(sessionA)).toEqual(sessionA)
    expect(parseWorkbenchTab({ kind: 'legacy-route' })).toEqual({ kind: 'legacy-route' })
    expect(parseWorkbenchTab({ kind: 'browser', tabId: 'b1' })).toEqual({ kind: 'browser', tabId: 'b1' })
    expect(
      parseWorkbenchTab({
        kind: 'knowledge',
        ref: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
      }),
    ).toEqual({ kind: 'knowledge', ref: { scheme: 'siyuan', kind: 'document', id: 'doc-1' } })
  })

  it('rejects unknown kinds and empty ids', () => {
    expect(parseWorkbenchTab({ kind: 'work-record', id: 'nope' })).toBeNull()
    expect(parseWorkbenchTab({ kind: 'session', sessionId: '' })).toBeNull()
    expect(parseWorkbenchTab(null)).toBeNull()
  })
})

describe('parseWorkbenchLayout', () => {
  it('round-trips a migrated layout through JSON', () => {
    const layout = migrateLegacyLayout({
      workspaceId: 'ws-1',
      now: NOW,
      entries: [{ id: 'panel-a', route: 'allSessions/session/a', tab: { kind: 'session', sessionId: 'a' } }],
    })
    expect(parseWorkbenchLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
  })

  it('rejects v1 snapshots — migration must be explicit', () => {
    expect(parseWorkbenchLayout({ version: 1, workspaceId: 'ws-1', groups: [], activeGroupId: null })).toBeNull()
  })

  it('rejects a layout whose activeTabId is not in the group', () => {
    expect(parseWorkbenchLayout(validLayout({
      groups: [
        {
          id: 'g1',
          tabs: [
            {
              id: 't1',
              tab: sessionA,
              route: 'allSessions/session/session-a',
              preview: false,
              dirty: false,
              openedAt: NOW,
              lastFocusedAt: NOW,
            },
          ],
          activeTabId: 'missing',
          proportion: 1,
        },
      ],
    }))).toBeNull()
  })

  it('rejects missing route', () => {
    const raw = validLayout()
    const group = (raw.groups as Array<Record<string, unknown>>)[0]
    const tab = (group?.tabs as Array<Record<string, unknown>>)[0]
    if (tab) delete tab.route
    expect(parseWorkbenchLayout(raw)).toBeNull()
  })

  it('coerces first-increment layouts that still carry pinned; preview wins', () => {
    const restored = parseWorkbenchLayout(validLayout({
      groups: [
        {
          id: 'g1',
          tabs: [
            {
              id: 't1',
              tab: sessionA,
              route: 'allSessions/session/session-a',
              pinned: true,
              preview: true,
              dirty: false,
              openedAt: NOW,
              lastFocusedAt: NOW,
            },
          ],
          activeTabId: 't1',
          proportion: 1,
        },
      ],
    }))
    expect(restored?.groups[0]?.tabs[0]).toMatchObject({ preview: true, dirty: false })
    expect(restored?.groups[0]?.tabs[0] && 'pinned' in restored.groups[0].tabs[0]).toBe(false)
  })

  it('treats pinned:true without preview as a pinned tab', () => {
    const restored = parseWorkbenchLayout(validLayout({
      groups: [
        {
          id: 'g1',
          tabs: [
            {
              id: 't1',
              tab: sessionA,
              route: 'allSessions/session/session-a',
              pinned: true,
              dirty: false,
              openedAt: NOW,
              lastFocusedAt: NOW,
            },
          ],
          activeTabId: 't1',
          proportion: 1,
        },
      ],
    }))
    expect(restored?.groups[0]?.tabs[0]?.preview).toBe(false)
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

describe('flattenWorkbenchLayoutToLegacyEntries', () => {
  it('splits a multi-tab group share equally across its tabs', () => {
    const layout = parseWorkbenchLayout(validLayout({
      groups: [
        {
          id: 'g1',
          proportion: 1,
          activeTabId: 't2',
          tabs: [
            {
              id: 't1',
              tab: sessionA,
              route: 'allSessions/session/session-a',
              preview: false,
              dirty: false,
              openedAt: NOW,
              lastFocusedAt: NOW,
            },
            {
              id: 't2',
              tab: { kind: 'browser', tabId: 'b' },
              route: 'browser/instance/b',
              preview: false,
              dirty: false,
              openedAt: NOW,
              lastFocusedAt: NOW,
            },
          ],
        },
      ],
    }))
    if (!layout) throw new Error('expected parse')
    const entries = flattenWorkbenchLayoutToLegacyEntries(layout)
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.id)).toEqual(['t1', 't2'])
    expect(entries[0]?.proportion).toBeCloseTo(0.5)
    expect(entries[1]?.proportion).toBeCloseTo(0.5)
  })
})

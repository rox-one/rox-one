import { describe, expect, it } from 'bun:test'
import {
  defaultPanelWorkspaceLayout,
  compactPanelShowsContent,
  normalizePanelTracks,
  panelGridShape,
  parsePanelWorkspaceLayout,
  resizePanelTracks,
  resolvePanelGridTracks,
} from '../panel-workspace-layout'
import { isDetailNavState } from '../nav-helpers'
import { parseRouteToNavigationState } from '../../../shared/route-parser'

describe('workspace arrangements', () => {
  it('shows a single panel, 2×2 and 3×2 grids without dropping extra panels', () => {
    expect(panelGridShape(0, 'auto')).toEqual({ columns: 1, rows: 1 })
    expect(panelGridShape(1, 'auto')).toEqual({ columns: 1, rows: 1 })
    expect(panelGridShape(4, 'auto')).toEqual({ columns: 2, rows: 2 })
    expect(panelGridShape(5, 'auto')).toEqual({ columns: 3, rows: 2 })
    expect(panelGridShape(6, 'auto')).toEqual({ columns: 3, rows: 2 })
    expect(panelGridShape(7, 'auto')).toEqual({ columns: 3, rows: 3 })
    expect(panelGridShape(6, 'columns')).toEqual({ columns: 6, rows: 1 })
    expect(panelGridShape(6, 'grid-2')).toEqual({ columns: 2, rows: 3 })
    expect(panelGridShape(6, 'focus')).toEqual({ columns: 1, rows: 1 })
  })

  it('preserves legacy column proportions and balances the incomplete grid row', () => {
    const preferences = defaultPanelWorkspaceLayout('workspace-a')
    expect(resolvePanelGridTracks(preferences, { columns: 2, rows: 1 }, [0.7, 0.3]).columns).toEqual([0.7, 0.3])
    expect(resolvePanelGridTracks(preferences, { columns: 3, rows: 2 }, [0.2, 0.2, 0.2, 0.2, 0.2]).columns)
      .toEqual([1 / 3, 1 / 3, 1 / 3])
    // Old pushPanel entries can have a zero proportion; they must remain usable.
    expect(resolvePanelGridTracks(preferences, { columns: 2, rows: 2 }, [1, 0, 0, 0]).columns).toEqual([0.5, 0.5])
  })

  it('resizes adjacent tracks while preserving the untouched track and total', () => {
    const next = resizePanelTracks([0.25, 0.5, 0.25], 0, 400, 350)
    expect(next).toEqual([0.4, 0.35, 0.25])
    expect(next.reduce((sum, value) => sum + value, 0)).toBe(1)
    expect(resizePanelTracks(next, 1, 360, 240)).toEqual([0.4, 0.36, 0.24])
    expect(resizePanelTracks(next, 2, 400, 200)).toEqual(next)
    expect(resizePanelTracks(next, 0, Number.NaN, 200)).toEqual(next)
  })

  it('keeps dedicated services visible in compact mode when they have no navigator', () => {
    for (const route of ['notes', 'tasks', 'meetings', 'connections']) {
      const navigation = parseRouteToNavigationState(route)
      expect(navigation).not.toBeNull()
      expect(compactPanelShowsContent(1, false, isDetailNavState(navigation))).toBe(true)
    }
    expect(compactPanelShowsContent(1, true, isDetailNavState(parseRouteToNavigationState('memory')))).toBe(false)
    expect(compactPanelShowsContent(0, false, false)).toBe(false)
    expect(compactPanelShowsContent(1, true, true)).toBe(true)
  })
})

describe('persisted panel geometry validation', () => {
  it('rejects foreign workspaces and unknown schemas', () => {
    expect(parsePanelWorkspaceLayout({ schemaVersion: 1, workspaceId: 'b' }, 'a')).toBeNull()
    expect(parsePanelWorkspaceLayout({ schemaVersion: 2, workspaceId: 'a' }, 'a')).toBeNull()
    expect(parsePanelWorkspaceLayout(null, 'a')).toBeNull()
  })

  it('recovers invalid modes and track data without NaN or invisible panels', () => {
    const restored = parsePanelWorkspaceLayout({
      schemaVersion: 1,
      workspaceId: 'a',
      mode: 'obsolete',
      grids: { '2x2': { columns: [-1, Number.NaN], rows: [3, 1] }, arbitrary: { columns: [1], rows: [1] } },
    }, 'a')!
    expect(restored.mode).toBe('auto')
    expect(restored.grids).toEqual({ '2x2': { columns: [0.5, 0.5], rows: [0.75, 0.25] } })
    expect(normalizePanelTracks([1e308, 1e308], 2)).toEqual([0.5, 0.5])
    expect(normalizePanelTracks([1], 2)).toEqual([0.5, 0.5])
  })

  it('keeps independently resized arrangements across mode changes', () => {
    const preferences = {
      ...defaultPanelWorkspaceLayout('a'),
      grids: {
        '2x2': { columns: [0.6, 0.4], rows: [0.7, 0.3] },
        '3x2': { columns: [0.25, 0.5, 0.25], rows: [0.4, 0.6] },
      },
    }
    const restored = parsePanelWorkspaceLayout(JSON.parse(JSON.stringify(preferences)), 'a')!
    expect(resolvePanelGridTracks(restored, { columns: 2, rows: 2 }, [1, 1, 1, 1])).toEqual(preferences.grids['2x2'])
    expect(resolvePanelGridTracks(restored, { columns: 3, rows: 2 }, [1, 1, 1, 1, 1, 1])).toEqual(preferences.grids['3x2'])
  })
})

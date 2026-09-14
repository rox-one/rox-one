import { describe, expect, it } from 'bun:test'
import {
  capturePanelResizeTracks,
  defaultPanelWorkspaceLayout,
  compactPanelShowsContent,
  normalizePanelTracks,
  panelGridShape,
  panelGridFocusTarget,
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

  it('starts a resize from CSS-clamped pixels without moving an untouched column', () => {
    const saved = { columns: [0.1, 0.4, 0.5], rows: [1] }
    // At 1,400px total, column one hits its 320px floor. The other two
    // fractions divide the remaining 1,080px, yielding 480px and 600px.
    const measured = [320, 480, 600]
    const base = capturePanelResizeTracks(saved, 'x', measured)
    const zeroDelta = resizePanelTracks(base.columns, 0, 320, 480)
    zeroDelta.forEach((weight, index) => expect(weight * 1_400).toBeCloseTo(measured[index], 8))
    const moved = resizePanelTracks(base.columns, 0, 360, 440)
    expect(moved[0] * 1_400).toBeCloseTo(360, 8)
    expect(moved[1] * 1_400).toBeCloseTo(440, 8)
    expect(moved[2] * 1_400).toBeCloseTo(600, 8)
    // The cancel snapshot and the perpendicular axis remain untouched.
    expect(saved.columns).toEqual([0.1, 0.4, 0.5])
    expect(base.rows).toBe(saved.rows)
  })

  it('captures clamped rows and ignores incomplete or invalid layout measurements', () => {
    const saved = { columns: [0.5, 0.5], rows: [0.05, 0.25, 0.7] }
    const base = capturePanelResizeTracks(saved, 'y', [240, 360, 600])
    expect(base.rows).toEqual([0.2, 0.3, 0.5])
    expect(resizePanelTracks(base.rows, 1, 400, 560)[0]).toBe(0.2)
    expect(base.columns).toBe(saved.columns)
    expect(capturePanelResizeTracks(saved, 'x', [400])).toBe(saved)
    expect(capturePanelResizeTracks(saved, 'x', [400, Number.NaN])).toBe(saved)
    expect(capturePanelResizeTracks(saved, 'x', [400, 0])).toBe(saved)
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

describe('directional workspace focus', () => {
  it('moves through 2×2 cells without changing panel order or wrapping edges', () => {
    const ids = ['notes', 'chat', 'browser', 'memory']
    const shape = panelGridShape(ids.length, 'grid-2')
    expect(panelGridFocusTarget(ids, 'notes', shape, 'right')).toBe('chat')
    expect(panelGridFocusTarget(ids, 'notes', shape, 'down')).toBe('browser')
    expect(panelGridFocusTarget(ids, 'memory', shape, 'up')).toBe('chat')
    expect(panelGridFocusTarget(ids, 'memory', shape, 'left')).toBe('browser')
    expect(panelGridFocusTarget(ids, 'chat', shape, 'right')).toBeNull()
    expect(panelGridFocusTarget(ids, 'browser', shape, 'left')).toBeNull()
    expect(panelGridFocusTarget(ids, 'notes', shape, 'up')).toBeNull()
    expect(panelGridFocusTarget(ids, 'memory', shape, 'down')).toBeNull()
    expect(ids).toEqual(['notes', 'chat', 'browser', 'memory'])
  })

  it('keeps the column in a 3×2 grid and chooses a real cell in a ragged last row', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const shape = panelGridShape(ids.length, 'grid-3')
    expect(panelGridFocusTarget(ids, 'c', shape, 'down')).toBe('f')
    expect(panelGridFocusTarget(ids, 'e', shape, 'up')).toBe('b')
    const ragged = ids.slice(0, -1)
    expect(panelGridFocusTarget(ragged, 'c', shape, 'down')).toBe('e')
    expect(panelGridFocusTarget(ragged, 'e', shape, 'right')).toBeNull()
    expect(panelGridFocusTarget(['a', 'b', 'c', 'd'], 'c', shape, 'down')).toBe('d')
  })

  it('cannot enter absent rows, missing focus or hidden focus-mode siblings', () => {
    const ids = ['a', 'b', 'c']
    const columns = panelGridShape(ids.length, 'columns')
    expect(panelGridFocusTarget(ids, 'b', columns, 'down')).toBeNull()
    expect(panelGridFocusTarget(ids, 'b', columns, 'up')).toBeNull()
    expect(panelGridFocusTarget(ids, 'closed', columns, 'right')).toBeNull()
    expect(panelGridFocusTarget([], null, columns, 'right')).toBeNull()
    const focus = panelGridShape(ids.length, 'focus')
    expect(panelGridFocusTarget(ids, 'a', focus, 'right')).toBeNull()
    expect(panelGridFocusTarget(ids, 'a', focus, 'down')).toBeNull()
    expect(panelGridFocusTarget(ids, 'a', { columns: 0, rows: 2 }, 'right')).toBeNull()
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

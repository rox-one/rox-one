import { describe, expect, it } from 'bun:test'
import { snapshotFromUrlSearch, snapshotToUrlSearch, type SurfaceLayoutSnapshot } from '../../platform/layout-snapshot'

const module = await import('../panel-url').catch(() => null)
function codec() {
  expect(module?.encodePanelEntries).toBeFunction()
  expect(module?.decodePanelEntries).toBeFunction()
  return module!
}

describe('UI-001 panel URL transport', () => {
  it('preserves raw route delimiters, malformed escapes and existing encoded IDs through browser query transport', () => {
    const { encodePanelEntries, decodePanelEntries } = codec()
    const entries = [
      { route: 'unknown/entity?keep=a,b:c|d%GG&next=%2F', proportion: 0.25 },
      { route: 'notes/note/folder%2Fnote.md', proportion: 0.75 },
    ]
    const params = new URLSearchParams({ panels: encodePanelEntries(entries) })
    const restored = new URLSearchParams(params.toString()).get('panels')!
    expect(restored.startsWith('v2:')).toBe(true)
    expect(decodePanelEntries(restored)).toEqual(entries)
  })

  it('preserves legacy encoded slash IDs without an extra URI decode', () => {
    expect(codec().decodePanelEntries('notes/note/a%2Fb:0.6000,knowledge/document/c%2Fd:0.4000')).toEqual([
      { route: 'notes/note/a%2Fb', proportion: 0.6 }, { route: 'knowledge/document/c%2Fd', proportion: 0.4 },
    ])
  })

  it('keeps bracket-prefixed legacy addresses and their siblings separate from tuple JSON', () => {
    for (const route of ['[future]', '[[future]]', '["future"]', '[1]', '[["future"]]']) {
      expect(codec().decodePanelEntries(route)).toEqual([{route,proportion:0}])
      expect(codec().decodePanelEntries(`${route}:0.6000,tasks:0.4000`)).toEqual([
        { route, proportion: 0.6 }, { route: 'tasks', proportion: 0.4 },
      ])
      expect(codec().decodePanelEntries(`${route},tasks`)).toEqual([
        { route, proportion: 0 }, { route: 'tasks', proportion: 0 },
      ])
    }
  })

  it('retains legacy missing proportion and last-colon parsing behavior', () => {
    expect(codec().decodePanelEntries('home,unknown?retain=a:b:0.7500')).toEqual([
      { route: 'home', proportion: 0 }, { route: 'unknown?retain=a:b', proportion: 0.75 },
    ])
  })

  it('reads json object URLs and requests equal layout for omitted or unusable weights', () => {
    expect(codec().decodePanelEntries('json:[{"route":"tasks"},{"route":"notes/note/a,b","proportion":0.4}]')).toEqual([
      {route:'tasks',proportion:0},{route:'notes/note/a,b',proportion:0.4},
    ])
    expect(codec().decodePanelEntries('json:[{"route":" ","proportion":0.4}]')).toEqual([])
  })

  it('supports a valid single-entry v2 payload', () => {
    const entries = [{ route: 'unknown/one', proportion: 1 }]
    expect(codec().decodePanelEntries(codec().encodePanelEntries(entries))).toEqual(entries)
  })

  for (const value of ['v2:[', 'v2:null', 'v2:{}', 'v2:[{"route":"home","proportion":null}]', 'v2:[{"route":"","proportion":0.5}]', 'v2:[{"route":12,"proportion":0.5}]', 'v2:[{"route":"home","proportion":-1}]', 'v2:[{"route":"home","proportion":2}]', 'v2:[{"route":"home","proportion":1e999}]']) {
    it(`rejects corrupt versioned transport ${value}`, () => {
      expect(() => codec().decodePanelEntries(value)).not.toThrow()
      expect(codec().decodePanelEntries(value)).toEqual([])
    })
  }

  it('layout snapshots use the same transport and preserve comma-containing durable refs', () => {
    const snapshot: SurfaceLayoutSnapshot = {
      version: 1, workspaceId: 'workspace-a', lanes: [{ laneId: 'main', locked: false }], focusedIndex: 1, savedAt: 123,
      tabs: [
        { panelId: 'panel-0', laneId: 'main', tab: { kind: 'session', sessionId: 'session,a' }, proportion: 0.6 },
        { panelId: 'panel-1', laneId: 'main', tab: { kind: 'browser', tabId: 'browser,b:c' }, proportion: 0.4 },
      ],
    }
    const search = snapshotToUrlSearch(snapshot)
    expect(new URLSearchParams(search).get('panels')!.startsWith('v2:')).toBe(true)
    expect(snapshotFromUrlSearch(search, 'workspace-a', 123)).toEqual(snapshot)
  })
  it('reads published tuple URLs and keeps literal commas, colons and existing URI escapes intact', () => {
    expect(codec().decodePanelEntries('[["notes/note/a,b?keep=x:y",0.6],["future/a%2Fb",0.4]]')).toEqual([
      { route: 'notes/note/a,b?keep=x:y', proportion: 0.6 }, { route: 'future/a%2Fb', proportion: 0.4 },
    ])
  })
  it('snapshots restore the explicit focused session when panel serialization is empty or damaged', () => {
    for (const panels of ['[]', '[', 'v2:[]', 'v2:[']) {
      const search = '?' + new URLSearchParams({ route: 'allSessions/session/requested', panels }).toString()
      const snapshot = snapshotFromUrlSearch(search, 'workspace-a', 123)
      expect(snapshot?.tabs.map(entry => entry.tab)).toEqual([{ kind: 'session', sessionId: 'requested' }])
      expect(snapshot?.focusedIndex).toBe(0)
    }
  })

  const sessionRoute = 'allSessions/session/a'
  const browserRoute = 'browser/instance/b'
  const mixedWeights = [
    ['tuple zero', JSON.stringify([[sessionRoute, 0], [browserRoute, 1]])],
    ['tuple null', JSON.stringify([[sessionRoute, null], [browserRoute, 1]])],
    ['tuple negative', JSON.stringify([[sessionRoute, -1], [browserRoute, 1]])],
    ['json missing', 'json:' + JSON.stringify([{ route: sessionRoute }, { route: browserRoute, proportion: 1 }])],
    ['json zero', 'json:' + JSON.stringify([{ route: sessionRoute, proportion: 0 }, { route: browserRoute, proportion: 1 }])],
    ['legacy zero', `${sessionRoute}:0,${browserRoute}:1`],
    ['legacy missing', `${sessionRoute},${browserRoute}:1`],
  ] as const
  for (const [name, panels] of mixedWeights) {
    it(`snapshot repairs ${name} before persistence and retains the usable split after reload`, () => {
      const search = '?' + new URLSearchParams({ panels, fi: '1' })
      const snapshot = snapshotFromUrlSearch(search, 'workspace-a', 123)
      expect(snapshot?.tabs.map(tab => tab.proportion)).toEqual([0.5, 0.5])
      expect(snapshot?.tabs.map(tab => tab.tab)).toEqual([
        { kind: 'session', sessionId: 'a' }, { kind: 'browser', tabId: 'b' },
      ])
      expect(snapshot?.focusedIndex).toBe(1)
      expect(snapshot?.workspaceId).toBe('workspace-a')
      expect(snapshotFromUrlSearch(snapshotToUrlSearch(snapshot!), 'workspace-a', 123)).toEqual(snapshot)
    })
  }
  it('snapshot retains and rescales valid unequal tuple weights', () => {
    const panels = JSON.stringify([[sessionRoute, 0.2], [browserRoute, 0.6]])
    const snapshot = snapshotFromUrlSearch('?' + new URLSearchParams({ panels }), 'workspace-a', 123)
    expect(snapshot?.tabs[0]?.proportion).toBeCloseTo(0.25)
    expect(snapshot?.tabs[1]?.proportion).toBeCloseTo(0.75)
  })

})

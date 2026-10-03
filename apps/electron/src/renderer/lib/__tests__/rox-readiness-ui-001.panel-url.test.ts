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

  it('retains legacy missing proportion and last-colon parsing behavior', () => {
    expect(codec().decodePanelEntries('home,unknown?retain=a:b:0.7500')).toEqual([
      { route: 'home', proportion: 0 }, { route: 'unknown?retain=a:b', proportion: 0.75 },
    ])
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
})

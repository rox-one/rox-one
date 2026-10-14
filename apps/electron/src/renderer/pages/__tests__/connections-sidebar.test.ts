import { describe, expect, it, mock } from 'bun:test'
import { buildConnectionsSidebarGroups, deniedConnections, type ConnectionsSidebarInput } from '../connections-sidebar'
import type { ConnectionAuditRow, ConnectionListRow } from '../connections-list'

const row = (id: string, integrationId: string): ConnectionListRow => ({ id, workspaceId: 'w', integrationId, credentialRefId: 'c', storageMode: 'keychain', scopes: [] })
const ev = (connectionId: string, outcome: string, occurredAt: number): ConnectionAuditRow => ({ connectionId, eventType: 'use', occurredAt, actorId: null, outcome, payloadDigest: 'd' })
const labels = {
  connected: 'C', sources: 'S', denied: 'E', catalog: 'K', catalogAll: 'All', catalogApi: 'API', catalogMcp: 'MCP', catalogLocal: 'Local',
  emptyConnected: 'none', connect: 'Connect', error: 'Err', unavailable: 'NA', deniedAt: (r: ConnectionAuditRow) => String(r.occurredAt),
  integration: (id: string) => `I:${id}`, storage: (m: string) => `M:${m}`, source: (s: string) => `S:${s}`,
}
function input(o: Partial<ConnectionsSidebarInput<'aws' | 'docker'>>): ConnectionsSidebarInput<'aws' | 'docker'> {
  return { rows: [], surface: 'ready', audit: [], sources: ['aws', 'docker'], activeSource: null, selectedId: null, labels,
    onSelectConnection: mock(), onSelectSource: mock(), onOpenAudit: mock(), onOpenCatalog: mock(), onConnect: mock(), onRetry: mock(), ...o }
}

describe('deniedConnections', () => {
  it('keeps only connections whose latest event was a policy denial, newest first', () => {
    const out = deniedConnections([ev('a', 'denied', 1), ev('a', 'committed', 2), ev('b', 'denied', 3), ev('c', 'denied', 5)])
    expect(out.map((r) => r.connectionId)).toEqual(['c', 'b'])
  })
})

describe('buildConnectionsSidebarGroups', () => {
  it('wires connected, sources, errors and catalog rows', () => {
    const onSelectConnection = mock(); const onSelectSource = mock(); const onOpenAudit = mock(); const onOpenCatalog = mock()
    const rows = [row('1', 'github'), row('2', 'aws')]
    const g = buildConnectionsSidebarGroups(input({ rows, audit: [ev('2', 'denied', 9)], selectedId: '1', onSelectConnection, onSelectSource, onOpenAudit, onOpenCatalog }))
    expect(g.map((x) => x.id)).toEqual(['connected', 'sources', 'denied', 'catalog'])
    expect(g[0]!.items[0]!.active).toBe(true)
    g[0]!.items[1]!.onSelect(); expect(onSelectConnection).toHaveBeenCalledWith(rows[1])
    g[1]!.items[0]!.onSelect(); expect(onSelectSource).toHaveBeenCalledWith('aws')
    expect(g[2]!.items[0]!.label).toBe('I:aws')
    expect(g[0]!.items[0]!.secondary).toBe('M:keychain')
    expect(g[1]!.items[0]!.label).toBe('S:aws')
    g[2]!.items[0]!.onSelect(); expect(onOpenAudit).toHaveBeenCalledWith('2')
    g[3]!.items[2]!.onSelect(); expect(onOpenCatalog).toHaveBeenCalledWith('mcp')
  })
  it('loading, unavailable, error and empty states; errors group hidden when none', () => {
    expect(buildConnectionsSidebarGroups(input({ rows: null }))[0]!.state).toEqual({ kind: 'loading' })
    expect(buildConnectionsSidebarGroups(input({ surface: 'unavailable' }))[0]!.state).toEqual({ kind: 'empty', label: 'NA' })
    const onRetry = mock()
    const st = buildConnectionsSidebarGroups(input({ surface: 'error', onRetry }))[0]!.state
    if (st?.kind === 'error') st.onRetry()
    expect(onRetry).toHaveBeenCalled()
    const onConnect = mock()
    const g = buildConnectionsSidebarGroups(input({ onConnect }))
    const empty = g[0]!.state
    if (empty?.kind === 'empty') empty.action?.onSelect()
    expect(onConnect).toHaveBeenCalled()
    expect(g.some((x) => x.id === 'denied')).toBe(false)
  })
})

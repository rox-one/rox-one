import { describe, expect, test } from 'bun:test'
import type { ServiceConnection, TransportConnectionState } from '../../../../../shared/types'
import type { CredentialHealthStatus, LoadedSource, NoteIndexHealth } from '../../../../../shared/types'
import type { NativeSidecarHealthView } from '../../../settings/native-sidecar-health'
import {
  attentionRows,
  buildSections,
  connectionRows,
  credentialsRow,
  indexRows,
  mcpRows,
  sidecarRow,
  sourceDriftRows,
  sourceStatus,
  summarizeHealth,
  summarizeSections,
  syncRows,
  transportRow,
  vaultRow,
  worstOf,
  type HealthRow,
} from '../health-model'

const source = (over: Partial<LoadedSource['config']> = {}): LoadedSource => ({
  config: {
    id: 's1',
    name: 'Linear',
    slug: 'linear',
    enabled: true,
    provider: 'linear',
    type: 'api',
    connectionStatus: 'connected',
    ...over,
  },
  guide: null,
  folderPath: '/x',
  workspaceRootPath: '/w',
  workspaceId: 'ws',
})

const connection = (over: Partial<ServiceConnection> = {}): ServiceConnection => ({
  id: 'c1',
  workspaceId: 'ws',
  provider: 'slack',
  status: 'connected',
  ...over,
})

const transport = (over: Partial<TransportConnectionState> = {}): TransportConnectionState => ({
  mode: 'local',
  status: 'connected',
  url: 'ws://127.0.0.1:9100',
  attempt: 0,
  updatedAt: 0,
  ...over,
})

const indexHealth = (over: Partial<NoteIndexHealth> = {}): NoteIndexHealth => ({
  ok: true,
  available: true,
  dbPath: '/db',
  schemaVersion: 3,
  documentCount: 42,
  recovered: false,
  indexed: 42,
  unchanged: 0,
  skipped: 0,
  truncated: false,
  watching: true,
  lastExternalChangeAt: null,
  ...over,
})

describe('health aggregation', () => {
  test('empty list is the calm ok state', () => {
    expect(worstOf([])).toBe('ok')
    expect(summarizeHealth([])).toEqual({ status: 'ok', total: 0, ok: 0, unknown: 0, warn: 0, error: 0 })
  })

  test('worst-of priority: error > warn > unknown > ok', () => {
    expect(worstOf(['ok', 'unknown', 'warn'])).toBe('warn')
    expect(worstOf(['warn', 'error', 'ok'])).toBe('error')
    expect(worstOf(['ok', 'unknown'])).toBe('unknown')
    expect(worstOf(['ok', 'ok'])).toBe('ok')
  })

  test('summarize counts every state and reports overall status', () => {
    const rows = [
      { status: 'ok' },
      { status: 'ok' },
      { status: 'unknown' },
      { status: 'warn' },
      { status: 'error' },
    ] as HealthRow[]
    expect(summarizeHealth(rows)).toEqual({ status: 'error', total: 5, ok: 2, unknown: 1, warn: 1, error: 1 })
  })

  test('attention rows: only warn/error, errors first, order preserved within a rank', () => {
    const rows = [
      { id: 'a', status: 'ok' },
      { id: 'b', status: 'warn' },
      { id: 'c', status: 'error' },
      { id: 'd', status: 'warn' },
      { id: 'e', status: 'unknown' },
    ] as HealthRow[]
    expect(attentionRows(rows).map((row) => row.id)).toEqual(['c', 'b', 'd'])
  })

  test('nothing broken: ok and unknown rows are never attention', () => {
    const rows = [{ id: 'a', status: 'ok' }, { id: 'b', status: 'unknown' }] as HealthRow[]
    expect(attentionRows(rows)).toEqual([])
    expect(summarizeHealth(rows).error).toBe(0)
    expect(summarizeHealth(rows).warn).toBe(0)
  })

  test('summarizeSections flattens rows across sections', () => {
    const summary = summarizeSections([
      { id: 'services', rows: [{ status: 'ok' } as HealthRow] },
      { id: 'mcp', rows: [{ status: 'error' } as HealthRow, { status: 'warn' } as HealthRow] },
    ])
    expect(summary).toEqual({ status: 'error', total: 3, ok: 1, unknown: 0, warn: 1, error: 1 })
  })
})

describe('services and providers', () => {
  test('transport state maps to health and a fix target', () => {
    expect(transportRow(transport()).status).toBe('ok')
    const failed = transportRow(transport({ status: 'failed', lastError: { kind: 'auth', message: 'bad token' } }))
    expect(failed.status).toBe('error')
    expect(failed.detailParams).toEqual({ reason: 'bad token' })
    expect(failed.fix).toBe('server')
    expect(transportRow(transport({ status: 'reconnecting', attempt: 3 })).status).toBe('warn')
    expect(transportRow(transport({ status: 'disconnected' })).status).toBe('unknown')
    expect(transportRow(null).status).toBe('unknown')
  })

  test('credential store health surfaces issues with their messages', () => {
    expect(credentialsRow(null).status).toBe('unknown')
    expect(credentialsRow({ healthy: true, issues: [] }).status).toBe('ok')
    const broken: CredentialHealthStatus = {
      healthy: false,
      issues: [
        { type: 'decryption_failed', message: 'cannot decrypt' },
        { type: 'file_corrupted', message: 'bad json' },
      ],
    }
    const row = credentialsRow(broken)
    expect(row.status).toBe('error')
    expect(row.detailParams).toEqual({ count: 2 })
    expect(row.rawDetail).toBe('cannot decrypt; bad json')
    expect(row.fix).toBe('ai')
  })

  test('secret vault probe: connected is ok, the rest is quiet unknown', () => {
    expect(vaultRow(true).status).toBe('ok')
    expect(vaultRow(false).status).toBe('unknown')
    expect(vaultRow(null).status).toBe('unknown')
    expect(vaultRow(true).fix).toBe('secrets')
  })

  test('native sidecar tone maps to health', () => {
    const tones: Array<[NativeSidecarHealthView['tone'], HealthRow['status']]> = [
      ['ok', 'ok'],
      ['fail', 'error'],
      ['off', 'unknown'],
    ]
    for (const [tone, status] of tones) {
      expect(sidecarRow({ tone, detail: 'x' }).status).toBe(status)
    }
  })
})

describe('sources', () => {
  test('connection status → health, disabled sources are unknown', () => {
    expect(sourceStatus('connected', true)).toBe('ok')
    expect(sourceStatus('failed', true)).toBe('error')
    expect(sourceStatus('needs_auth', true)).toBe('warn')
    expect(sourceStatus('local_disabled', true)).toBe('warn')
    expect(sourceStatus('untested', true)).toBe('unknown')
    expect(sourceStatus('connected', false)).toBe('unknown')
  })

  test('mcp section lists only MCP sources', () => {
    const rows = mcpRows([
      source({ slug: 'linear', name: 'Linear', type: 'api' }),
      source({ slug: 'github', name: 'GitHub', type: 'mcp', connectionStatus: 'needs_auth' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('mcp:github')
    expect(rows[0]!.status).toBe('warn')
    expect(rows[0]!.labelParams).toEqual({ name: 'GitHub' })
  })

  test('drift section keeps enabled non-MCP sources that are not connected', () => {
    const rows = sourceDriftRows([
      source({ slug: 'ok', connectionStatus: 'connected' }),
      source({ slug: 'off', enabled: false, connectionStatus: 'failed' }),
      source({ slug: 'mcp', type: 'mcp', connectionStatus: 'failed' }),
      source({ slug: 'drift', name: 'Notion', connectionStatus: 'untested' }),
      source({ slug: 'auth', connectionStatus: 'needs_auth' }),
    ])
    expect(rows.map((row) => row.id)).toEqual(['source:drift', 'source:auth'])
    expect(rows[0]!.status).toBe('unknown')
    expect(rows[1]!.status).toBe('warn')
    expect(rows.every((row) => row.fix === 'sources')).toBe(true)
  })
})

describe('connections and syncs', () => {
  const label = (c: ServiceConnection) => c.provider

  test('connection rows carry provider label, status and fix target', () => {
    const rows = connectionRows(
      [
        connection({ id: 'a', status: 'connected' }),
        connection({ id: 'b', status: 'expired' }),
        connection({ id: 'c', status: 'error', readOnly: true }),
        connection({ id: 'd', status: 'disconnected' }),
      ],
      label,
    )
    expect(rows.map((row) => row.status)).toEqual(['ok', 'warn', 'error', 'unknown'])
    expect(rows[1]!.labelParams).toEqual({ name: 'slack' })
    expect(rows[2]!.fix).toBe('ai')
    expect(rows[0]!.fix).toBe('accounts')
  })

  test('sync section is the in-flight/broken subset only', () => {
    const rows = syncRows(
      [
        connection({ id: 'a', status: 'connected' }),
        connection({ id: 'b', status: 'syncing' }),
        connection({ id: 'c', status: 'expired' }),
        connection({ id: 'd', status: 'disconnected' }),
      ],
      label,
    )
    expect(rows.map((row) => row.id)).toEqual(['sync:b', 'sync:c'])
    expect(rows[0]!.status).toBe('ok')
    expect(rows[1]!.status).toBe('warn')
  })
})

describe('local indexes', () => {
  test('notes index health maps to a row', () => {
    expect(indexRows(null)[0]!.status).toBe('unknown')
    expect(indexRows(indexHealth())[0]!.status).toBe('ok')
    expect(indexRows(indexHealth())[0]!.detailParams).toEqual({ count: 42 })
    expect(indexRows(indexHealth({ truncated: true }))[0]!.status).toBe('warn')
    expect(indexRows(indexHealth({ ok: false }))[0]!.status).toBe('error')
  })
})

describe('buildSections', () => {
  test('assembles every section in order with the given inputs', () => {
    const sections = buildSections({
      transport: transport(),
      credentials: { healthy: true, issues: [] },
      vault: true,
      sidecar: { tone: 'ok', detail: 'running' },
      connections: [connection({ id: 'a' }), connection({ id: 'b', status: 'syncing' })],
      sources: [source({ slug: 'mcp', type: 'mcp' }), source({ slug: 'api', connectionStatus: 'untested' })],
      index: indexHealth(),
      connectionLabel: (c) => c.provider,
    })
    expect(sections.map((section) => section.id)).toEqual(['services', 'mcp', 'connections', 'sync', 'sources', 'indexes'])
    expect(sections[0]!.rows).toHaveLength(4)
    expect(sections[1]!.rows).toHaveLength(1)
    expect(sections[2]!.rows).toHaveLength(2)
    expect(sections[3]!.rows).toHaveLength(1)
    expect(sections[4]!.rows).toHaveLength(1)
    expect(sections[5]!.rows).toHaveLength(1)
    expect(summarizeSections(sections).status).toBe('unknown')
  })
})
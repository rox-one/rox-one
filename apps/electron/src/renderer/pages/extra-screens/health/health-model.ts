/**
 * «Состояние» — pure model. Turns the app's already-resolved runtime facts
 * (transport, credential store, service connections, sources, notes index,
 * native sidecar) into quiet, ordered health rows. No I/O and no translation:
 * every builder returns i18n keys + params, so the aggregation rules
 * (worst-of, priority, calm empty list) are unit-testable.
 */
import type {
  CredentialHealthStatus,
  LoadedSource,
  NoteIndexHealth,
  ServiceConnection,
  TransportConnectionState,
} from '../../../../shared/types'
import type { NativeSidecarHealthView } from '../../settings/native-sidecar-health'

/**
 * Four states keep the screen quiet: `ok` is the default, `unknown` is honest
 * (nothing measured) and never alarming, `warn`/`error` carry the attention.
 */
export type HealthStatus = 'ok' | 'unknown' | 'warn' | 'error'

/** Where a row can be fixed, mapped to a route by the page. */
export type HealthFix =
  | 'ai'
  | 'accounts'
  | 'server'
  | 'knowledge'
  | 'sources'
  | 'sourcesMcp'
  | 'notes'
  | 'secrets'

export type HealthSectionId = 'services' | 'mcp' | 'connections' | 'sync' | 'sources' | 'indexes'

export interface HealthRow {
  id: string
  /** i18n key for the row name. */
  labelKey: string
  labelParams?: Record<string, string | number>
  status: HealthStatus
  /** i18n key for the state line. */
  detailKey: string
  detailParams?: Record<string, string | number>
  /** Verbatim runtime text (sidecar message, credential issue…), shown as-is. */
  rawDetail?: string
  fix?: HealthFix
}

export interface HealthSection {
  id: HealthSectionId
  rows: HealthRow[]
}

export interface HealthSummary {
  status: HealthStatus
  total: number
  ok: number
  unknown: number
  warn: number
  error: number
}

/** Higher rank = worse. Used only for ordering/aggregation, not display. */
export const HEALTH_RANK: Record<HealthStatus, number> = { ok: 0, unknown: 1, warn: 2, error: 3 }

/**
 * Worst status in a list. An empty list is `ok`: a screen with nothing to
 * report is the calm «всё работает» state, never an error.
 */
export function worstOf(statuses: readonly HealthStatus[]): HealthStatus {
  let worst: HealthStatus = 'ok'
  for (const status of statuses) {
    if (HEALTH_RANK[status] > HEALTH_RANK[worst]) worst = status
  }
  return worst
}

export function summarizeHealth(rows: readonly HealthRow[]): HealthSummary {
  const summary: HealthSummary = { status: 'ok', total: rows.length, ok: 0, unknown: 0, warn: 0, error: 0 }
  for (const row of rows) {
    summary[row.status] += 1
  }
  summary.status = worstOf(rows.map((row) => row.status))
  return summary
}

export function summarizeSections(sections: readonly HealthSection[]): HealthSummary {
  return summarizeHealth(sections.flatMap((section) => section.rows))
}

/** Rows that need attention, worst first, stable within a rank. */
export function attentionRows(rows: readonly HealthRow[]): HealthRow[] {
  return rows
    .filter((row) => row.status === 'error' || row.status === 'warn')
    .sort((a, b) => HEALTH_RANK[b.status] - HEALTH_RANK[a.status])
}

/* ------------------------------------------------------------------ */
/* Builders (pure: resolved data in, rows out)                        */
/* ------------------------------------------------------------------ */

function transportDetail(transport: TransportConnectionState): Pick<HealthRow, 'status' | 'detailKey' | 'detailParams'> {
  switch (transport.status) {
    case 'connected':
      return transport.mode === 'local'
        ? { status: 'ok', detailKey: 'extraScreens.health.detail.transportLocal' }
        : { status: 'ok', detailKey: 'extraScreens.health.detail.transportRemote', detailParams: { url: transport.url } }
    case 'connecting':
      return { status: 'unknown', detailKey: 'extraScreens.health.detail.transportConnecting' }
    case 'reconnecting':
      return { status: 'warn', detailKey: 'extraScreens.health.detail.transportReconnecting', detailParams: { attempt: transport.attempt } }
    case 'failed':
      return {
        status: 'error',
        detailKey: 'extraScreens.health.detail.transportFailed',
        detailParams: { reason: transport.lastError?.message || transport.lastError?.kind || 'unknown' },
      }
    case 'disconnected':
      return { status: 'unknown', detailKey: 'extraScreens.health.detail.transportDisconnected' }
    case 'idle':
    default:
      return { status: 'unknown', detailKey: 'extraScreens.health.detail.transportIdle' }
  }
}

export function transportRow(transport: TransportConnectionState | null): HealthRow {
  if (!transport) {
    return {
      id: 'services:transport',
      labelKey: 'extraScreens.health.row.transport',
      status: 'unknown',
      detailKey: 'extraScreens.health.detail.transportUnknown',
      fix: 'server',
    }
  }
  return {
    id: 'services:transport',
    labelKey: 'extraScreens.health.row.transport',
    fix: 'server',
    ...transportDetail(transport),
  }
}

export function credentialsRow(health: CredentialHealthStatus | null): HealthRow {
  if (!health) {
    return {
      id: 'services:credentials',
      labelKey: 'extraScreens.health.row.credentials',
      status: 'unknown',
      detailKey: 'extraScreens.health.detail.credentialsUnknown',
      fix: 'ai',
    }
  }
  if (health.healthy) {
    return {
      id: 'services:credentials',
      labelKey: 'extraScreens.health.row.credentials',
      status: 'ok',
      detailKey: 'extraScreens.health.detail.credentialsOk',
      fix: 'ai',
    }
  }
  const rawDetail = health.issues.map((issue) => issue.message).filter(Boolean).join('; ') || undefined
  return {
    id: 'services:credentials',
    labelKey: 'extraScreens.health.row.credentials',
    status: 'error',
    detailKey: 'extraScreens.health.detail.credentialsIssues',
    detailParams: { count: health.issues.length },
    rawDetail,
    fix: 'ai',
  }
}

/** Secret vault availability (SecretsPage's `fabricInfisicalHealth` probe). */
export function vaultRow(available: boolean | null): HealthRow {
  return {
    id: 'services:vault',
    labelKey: 'extraScreens.health.row.vault',
    status: available === true ? 'ok' : 'unknown',
    detailKey: available === true
      ? 'extraScreens.health.detail.vaultConnected'
      : available === false
        ? 'extraScreens.health.detail.vaultDisconnected'
        : 'extraScreens.health.detail.vaultUnknown',
    fix: 'secrets',
  }
}

export function sidecarRow(view: NativeSidecarHealthView): HealthRow {
  const status: HealthStatus = view.tone === 'ok' ? 'ok' : view.tone === 'fail' ? 'error' : 'unknown'
  return {
    id: 'services:sidecar',
    labelKey: 'extraScreens.health.row.sidecar',
    status,
    detailKey:
      status === 'ok'
        ? 'extraScreens.health.detail.sidecarOk'
        : status === 'error'
          ? 'extraScreens.health.detail.sidecarDown'
          : 'extraScreens.health.detail.sidecarOff',
    rawDetail: view.detail || undefined,
    fix: 'server',
  }
}

/** Source connection status → health, shared by MCP and drift rows. */
export function sourceStatus(status: LoadedSource['config']['connectionStatus'], enabled: boolean): HealthStatus {
  if (!enabled) return 'unknown'
  switch (status) {
    case 'connected':
      return 'ok'
    case 'failed':
      return 'error'
    case 'needs_auth':
    case 'local_disabled':
      return 'warn'
    case 'untested':
    default:
      return 'unknown'
  }
}

function sourceDetailKey(status: LoadedSource['config']['connectionStatus']): string {
  switch (status) {
    case 'connected':
      return 'extraScreens.health.detail.sourceConnected'
    case 'failed':
      return 'extraScreens.health.detail.sourceFailed'
    case 'needs_auth':
      return 'extraScreens.health.detail.sourceNeedsAuth'
    case 'local_disabled':
      return 'extraScreens.health.detail.sourceDisabled'
    case 'untested':
    default:
      return 'extraScreens.health.detail.sourceUntested'
  }
}

export function mcpRows(sources: readonly LoadedSource[]): HealthRow[] {
  return sources
    .filter((source) => source.config.type === 'mcp')
    .map((source) => ({
      id: `mcp:${source.config.slug}`,
      labelKey: 'extraScreens.health.row.mcp',
      labelParams: { name: source.config.name || source.config.slug },
      status: sourceStatus(source.config.connectionStatus, source.config.enabled),
      detailKey: sourceDetailKey(source.config.connectionStatus),
      rawDetail: source.config.connectionError || undefined,
      fix: 'sourcesMcp' as const,
    }))
}

/** Дрейф: enabled non-MCP sources that are not connected. Healthy ones stay silent. */
export function sourceDriftRows(sources: readonly LoadedSource[]): HealthRow[] {
  return sources
    .filter((source) => source.config.type !== 'mcp')
    .filter((source) => source.config.enabled && source.config.connectionStatus !== 'connected')
    .map((source) => ({
      id: `source:${source.config.slug}`,
      labelKey: 'extraScreens.health.row.source',
      labelParams: { name: source.config.name || source.config.slug },
      status: sourceStatus(source.config.connectionStatus, source.config.enabled),
      detailKey: sourceDetailKey(source.config.connectionStatus),
      rawDetail: source.config.connectionError || undefined,
      fix: 'sources' as const,
    }))
}

const CONNECTION_STATUS: Record<ServiceConnection['status'], HealthStatus> = {
  connected: 'ok',
  syncing: 'ok',
  expired: 'warn',
  error: 'error',
  disconnected: 'unknown',
}

const CONNECTION_DETAIL: Record<ServiceConnection['status'], string> = {
  connected: 'extraScreens.health.detail.connectionConnected',
  syncing: 'extraScreens.health.detail.connectionSyncing',
  expired: 'extraScreens.health.detail.connectionExpired',
  error: 'extraScreens.health.detail.connectionError',
  disconnected: 'extraScreens.health.detail.connectionDisconnected',
}

function connectionRow(connection: ServiceConnection, label: string, prefix: string): HealthRow {
  return {
    id: `${prefix}:${connection.id}`,
    labelKey: 'extraScreens.health.row.connection',
    labelParams: { name: label },
    status: CONNECTION_STATUS[connection.status],
    detailKey: CONNECTION_DETAIL[connection.status],
    // Credentials for LLM reflections are owned by AI settings, not Accounts.
    fix: connection.readOnly ? 'ai' : 'accounts',
  }
}

export function connectionRows(
  connections: readonly ServiceConnection[],
  labelOf: (connection: ServiceConnection) => string,
): HealthRow[] {
  return connections.map((connection) => connectionRow(connection, labelOf(connection), 'connection'))
}

/** Очереди: only in-flight or broken syncs, a narrower lens than all connections. */
export function syncRows(
  connections: readonly ServiceConnection[],
  labelOf: (connection: ServiceConnection) => string,
): HealthRow[] {
  return connections
    .filter((connection) => connection.status === 'syncing' || connection.status === 'expired' || connection.status === 'error')
    .map((connection) => ({
      ...connectionRow(connection, labelOf(connection), 'sync'),
      labelKey: 'extraScreens.health.row.sync',
    }))
}

export function indexRows(health: NoteIndexHealth | null): HealthRow[] {
  if (!health) {
    return [
      {
        id: 'index:notes',
        labelKey: 'extraScreens.health.row.notesIndex',
        status: 'unknown',
        detailKey: 'extraScreens.health.detail.indexUnknown',
        fix: 'notes',
      },
    ]
  }
  const status: HealthStatus = health.ok ? (health.truncated ? 'warn' : 'ok') : 'error'
  return [
    {
      id: 'index:notes',
      labelKey: 'extraScreens.health.row.notesIndex',
      status,
      detailKey: status === 'error'
        ? 'extraScreens.health.detail.indexUnavailable'
        : status === 'warn'
          ? 'extraScreens.health.detail.indexTruncated'
          : 'extraScreens.health.detail.indexOk',
      detailParams: { count: health.documentCount },
      fix: 'notes',
    },
  ]
}

/** Assemble all sections in rail order; empty sections are dropped by the page. */
export function buildSections(input: {
  transport: TransportConnectionState | null
  credentials: CredentialHealthStatus | null
  vault: boolean | null
  sidecar: NativeSidecarHealthView
  connections: readonly ServiceConnection[]
  sources: readonly LoadedSource[]
  index: NoteIndexHealth | null
  connectionLabel: (connection: ServiceConnection) => string
}): HealthSection[] {
  return [
    {
      id: 'services',
      rows: [transportRow(input.transport), credentialsRow(input.credentials), vaultRow(input.vault), sidecarRow(input.sidecar)],
    },
    { id: 'mcp', rows: mcpRows(input.sources) },
    { id: 'connections', rows: connectionRows(input.connections, input.connectionLabel) },
    { id: 'sync', rows: syncRows(input.connections, input.connectionLabel) },
    { id: 'sources', rows: sourceDriftRows(input.sources) },
    { id: 'indexes', rows: indexRows(input.index) },
  ]
}
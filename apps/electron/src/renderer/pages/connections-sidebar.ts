/**
 * Second-sidebar groups for Подключения (merged Источники + Соединения):
 * Подключено / Источники / Ошибки / Каталог, from live workgraph data.
 */
import { AlertTriangle, Blocks, Globe, KeyRound, Plug, Server, Terminal } from 'lucide-react'
import type { SidebarGroup } from '@/components/shell/screen-sidebar'
import type { ConnectionAuditRow, ConnectionListRow } from './connections-list'

/** Audit outcomes that mean the connection needs attention. */
const FAILED_OUTCOMES = new Set(['error', 'failed', 'denied'])

export type CatalogFilter = 'all' | 'api' | 'mcp' | 'local'

export interface ConnectionsSidebarLabels {
  connected: string; sources: string; errors: string; catalog: string
  catalogAll: string; catalogApi: string; catalogMcp: string; catalogLocal: string
  emptyConnected: string; connect: string; error: string; unavailable: string
  failedAt(row: ConnectionAuditRow): string
}

export interface ConnectionsSidebarInput<S extends string> {
  rows: readonly ConnectionListRow[] | null
  surface: 'ready' | 'unavailable' | 'error'
  audit: readonly ConnectionAuditRow[]
  sources: readonly S[]
  activeSource: S | null
  selectedId: string | null
  labels: ConnectionsSidebarLabels
  onSelectConnection(row: ConnectionListRow): void
  onSelectSource(source: S): void
  onOpenAudit(connectionId: string): void
  onOpenCatalog(filter: CatalogFilter): void
  onConnect(): void
  onRetry(): void
}

/** Latest failing audit event per connection (newest first). */
export function failingConnections(audit: readonly ConnectionAuditRow[]): ConnectionAuditRow[] {
  const latest = new Map<string, ConnectionAuditRow>()
  for (const row of audit) {
    const prev = latest.get(row.connectionId)
    if (!prev || row.occurredAt > prev.occurredAt) latest.set(row.connectionId, row)
  }
  return [...latest.values()]
    .filter((row) => FAILED_OUTCOMES.has(row.outcome))
    .sort((a, b) => b.occurredAt - a.occurredAt)
}

export function buildConnectionsSidebarGroups<S extends string>(input: ConnectionsSidebarInput<S>): SidebarGroup[] {
  const { labels: l } = input
  const connect = { id: 'connect', label: l.connect, onSelect: input.onConnect }
  let connected: SidebarGroup
  if (input.rows === null) {
    connected = { id: 'connected', title: l.connected, items: [], state: { kind: 'loading' } }
  } else if (input.surface !== 'ready') {
    connected = {
      id: 'connected', title: l.connected, items: [],
      state: input.surface === 'unavailable'
        ? { kind: 'empty', label: l.unavailable }
        : { kind: 'error', label: l.error, onRetry: input.onRetry },
    }
  } else {
    connected = {
      id: 'connected', title: l.connected, initialVisible: 8,
      items: input.rows.map((row) => ({
        id: `conn-${row.id}`,
        label: row.integrationId,
        secondary: row.storageMode,
        icon: KeyRound,
        active: row.id === input.selectedId,
        onSelect: () => input.onSelectConnection(row),
      })),
      ...(input.rows.length === 0 ? { state: { kind: 'empty' as const, label: l.emptyConnected, action: connect } } : {}),
    }
  }
  const sources: SidebarGroup = {
    id: 'sources', title: l.sources, initialVisible: 6,
    items: input.sources.map((source) => ({
      id: `source-${source}`,
      label: source,
      icon: Plug,
      active: input.activeSource === source,
      onSelect: () => input.onSelectSource(source),
    })),
  }
  const failing = failingConnections(input.audit)
  const errors: SidebarGroup = {
    id: 'errors', title: l.errors, initialVisible: 5,
    items: failing.map((row) => {
      const conn = input.rows?.find((r) => r.id === row.connectionId)
      return {
        id: `err-${row.connectionId}`,
        label: conn?.integrationId ?? row.connectionId,
        secondary: l.failedAt(row),
        icon: AlertTriangle,
        onSelect: () => input.onOpenAudit(row.connectionId),
      }
    }),
  }
  const catalog: SidebarGroup = {
    id: 'catalog', title: l.catalog, initialVisible: 4,
    items: ([
      ['all', l.catalogAll, Blocks],
      ['api', l.catalogApi, Globe],
      ['mcp', l.catalogMcp, Server],
      ['local', l.catalogLocal, Terminal],
    ] as const).map(([filter, label, icon]) => ({ id: `catalog-${filter}`, label, icon, onSelect: () => input.onOpenCatalog(filter) })),
  }
  return [connected, sources, errors, catalog].filter((g) => g.items.length > 0 || g.state !== undefined)
}

/**
 * Second-sidebar groups for Подключения (merged Источники + Соединения):
 * Подключено / Источники / Отклонённые / Каталог, from live workgraph data.
 */
import { AlertTriangle, Blocks, Globe, KeyRound, Plug, Server, Terminal } from 'lucide-react'
import type { SidebarGroup } from '@/components/shell/screen-sidebar'
import type { ConnectionAuditRow, ConnectionListRow } from './connections-list'

/**
 * The workgraph audit writer only emits 'committed' or 'denied' (policy
 * decision allow/deny), so this group is policy denials — not broken or
 * expired connections, which would need repair/revalidation state.
 */
const DENIED_OUTCOME = 'denied'

export type CatalogFilter = 'all' | 'api' | 'mcp' | 'local'

export interface ConnectionsSidebarLabels {
  connected: string; sources: string; denied: string; catalog: string
  catalogAll: string; catalogApi: string; catalogMcp: string; catalogLocal: string
  emptyConnected: string; connect: string; error: string; unavailable: string
  deniedAt(row: ConnectionAuditRow): string
  /** Human names for raw ids shown in rows. */
  integration(integrationId: string): string
  storage(storageMode: string): string
  source(source: string): string
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

/** Connections whose latest audit event was a policy denial (newest first). */
export function deniedConnections(audit: readonly ConnectionAuditRow[]): ConnectionAuditRow[] {
  const latest = new Map<string, ConnectionAuditRow>()
  for (const row of audit) {
    const prev = latest.get(row.connectionId)
    if (!prev || row.occurredAt > prev.occurredAt) latest.set(row.connectionId, row)
  }
  return [...latest.values()]
    .filter((row) => row.outcome === DENIED_OUTCOME)
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
        label: l.integration(row.integrationId),
        secondary: l.storage(row.storageMode),
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
      label: l.source(source),
      icon: Plug,
      active: input.activeSource === source,
      onSelect: () => input.onSelectSource(source),
    })),
  }
  const deniedRows = deniedConnections(input.audit)
  const denied: SidebarGroup = {
    id: 'denied', title: l.denied, initialVisible: 5,
    items: deniedRows.map((row) => {
      const conn = input.rows?.find((r) => r.id === row.connectionId)
      return {
        id: `denied-${row.connectionId}`,
        label: conn ? l.integration(conn.integrationId) : row.connectionId,
        secondary: l.deniedAt(row),
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
  return [connected, sources, denied, catalog].filter((g) => g.items.length > 0 || g.state !== undefined)
}

/** 'github-oauth' → 'Github Oauth' — fallback for integration ids without a translation. */
export function humanizeId(id: string): string {
  return id.split(/[-_.\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || id
}

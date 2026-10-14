import * as React from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useScreenSidebar, type ScreenSidebarConfig } from '@/components/shell/screen-sidebar'
import { navigate, routes } from '@/lib/navigate'
import { sanitizeConnectionAuditRows, type ConnectionAuditRow, type ConnectionListRow } from './connections-list'
import { buildConnectionsSidebarGroups, humanizeId } from './connections-sidebar'

export interface ConnectionsSidebarBindings<S extends string> {
  workspaceId: string | null
  rows: readonly ConnectionListRow[] | null
  surface: 'ready' | 'unavailable' | 'error'
  sources: readonly S[]
  activeSource: S | null
  selectedId: string | null
  /** Bumped by the page's refresh; refetches the audit-derived Отклонённые group. */
  reloadKey: number
  onSelectConnection(row: ConnectionListRow): void
  onSelectSource(source: S): void
  onOpenAudit(connectionId: string): void
  onConnect(): void
  onRefresh(): void
}

/** Audit rows for the Отклонённые group, independent of the page's audit tab. */
function useConnectionAudit(workspaceId: string | null, reloadKey: number): ConnectionAuditRow[] {
  const [audit, setAudit] = React.useState<ConnectionAuditRow[]>([])
  React.useEffect(() => {
    const list = window.electronAPI?.workgraph?.listConnectionAudit
    if (!workspaceId || typeof list !== 'function') { setAudit([]); return undefined }
    let stale = false
    list({ workspaceId }).then(
      (raw) => { if (!stale) setAudit(sanitizeConnectionAuditRows(raw)) },
      () => { if (!stale) setAudit([]) },
    )
    return () => { stale = true }
  }, [workspaceId, reloadKey])
  return audit
}

export function useConnectionsSidebar<S extends string>(b: ConnectionsSidebarBindings<S>): void {
  const { t, i18n } = useTranslation()
  const audit = useConnectionAudit(b.workspaceId, b.reloadKey)
  const latest = React.useRef(b)
  latest.current = b
  const { rows, surface, sources, activeSource, selectedId } = b
  const groups = React.useMemo(() => {
    const dateFmt = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'short', timeStyle: 'short' })
    return buildConnectionsSidebarGroups<S>({
      rows, surface, audit, sources, activeSource, selectedId,
      labels: {
        connected: t('screenSidebar.connections.connected'),
        sources: t('screenSidebar.connections.sources'),
        denied: t('screenSidebar.connections.denied'),
        catalog: t('screenSidebar.connections.catalog'),
        catalogAll: t('screenSidebar.connections.catalogAll'),
        catalogApi: t('screenSidebar.connections.catalogApi'),
        catalogMcp: t('screenSidebar.connections.catalogMcp'),
        catalogLocal: t('screenSidebar.connections.catalogLocal'),
        emptyConnected: t('connections.empty'),
        connect: t('connections.connect'),
        error: t('screenSidebar.connections.error'),
        unavailable: t('screenSidebar.connections.unavailable'),
        deniedAt: (row) => dateFmt.format(row.occurredAt),
        integration: (id) => {
          const key = `screenSidebar.connections.source.${id}`
          return i18n.exists(key) ? t(key) : humanizeId(id)
        },
        storage: (mode) => {
          const key = `screenSidebar.connections.storage.${mode}`
          return i18n.exists(key) ? t(key) : mode
        },
        source: (source) => {
          const key = `screenSidebar.connections.source.${source}`
          return i18n.exists(key) ? t(key) : humanizeId(source)
        },
      },
      onSelectConnection: (row) => latest.current.onSelectConnection(row),
      onSelectSource: (source) => latest.current.onSelectSource(source),
      onOpenAudit: (id) => latest.current.onOpenAudit(id),
      onOpenCatalog: (filter) => navigate(routes.view.sources(filter === 'all' ? undefined : { type: filter })),
      onConnect: () => latest.current.onConnect(),
      onRetry: () => latest.current.onRefresh(),
    })
  }, [rows, surface, audit, sources, activeSource, selectedId, t, i18n.resolvedLanguage, i18n.language])
  const config = React.useMemo<ScreenSidebarConfig>(() => ({
    screenId: 'connections',
    title: t('sidebar.connections'),
    headerActions: [{ id: 'refresh', label: t('common.refresh'), icon: RefreshCw, onSelect: () => latest.current.onRefresh() }],
    primaryAction: { id: 'connect', label: t('connections.connect'), icon: Plus, onSelect: () => latest.current.onConnect() },
    groups,
  }), [groups, t])
  useScreenSidebar(config)
}

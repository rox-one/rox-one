/**
 * «Состояние» — a quiet health screen: services and providers (LLM/OMP), MCP
 * servers, connections/accounts, syncs and queues, source drift and local
 * indexes. Each row is a name + a token dot; the detail (what broke and what
 * to do) opens on click. When nothing needs attention the screen stays calm —
 * «всё работает». Diagnostics, sidecar health and the notes index panel are
 * reused, not re-implemented.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { connectionProviderLabel } from '@/lib/connection-labels'
import { navigate, routes } from '@/lib/navigate'
import { DeviceStatusChip } from '@/components/app-shell/DeviceStatusChip'
import { VaultIndexHealthPanel } from '@/pages/notes/VaultIndexHealthPanel'
import { ScreenButton, ScreenColumn, ScreenDetail, ScreenHeader, ScreenRoot } from '../ui'
import { HealthRowDetail, HealthSectionList, HealthStatusDot } from './HealthSections'
import {
  attentionRows,
  buildSections,
  summarizeSections,
  type HealthFix,
  type HealthRow,
} from './health-model'
import { useHealthData } from './use-health-data'

const loadDiagnostics = () => import('@/components/app-shell/diagnostics/LazyDiagnostics')
const LazyDiagnostics = React.lazy(loadDiagnostics)

function fixRoute(fix: HealthFix) {
  switch (fix) {
    case 'ai':
      return routes.view.settings('ai')
    case 'accounts':
      return routes.view.settings('accounts')
    case 'server':
      return routes.view.settings('server')
    case 'knowledge':
      return routes.view.settings('knowledge')
    case 'sources':
      return routes.view.sources()
    case 'sourcesMcp':
      return routes.view.sourcesMcp()
    case 'notes':
      return routes.view.notes()
    case 'secrets':
      return routes.view.screen('secrets')
  }
}

export default function HealthPage(_props: { itemId: string | null }) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const transport = useTransportConnectionState()
  const [refreshToken, setRefreshToken] = React.useState(0)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [rebuilding, setRebuilding] = React.useState(false)
  const data = useHealthData(workspaceId, refreshToken)

  const sections = React.useMemo(
    () =>
      buildSections({
        transport,
        credentials: data.credentials,
        vault: data.vault,
        sidecar: data.sidecar,
        connections: data.identity?.connections ?? [],
        sources: data.sources,
        index: data.index,
        connectionLabel: (connection) => connectionProviderLabel(connection.provider, t),
      }).filter((section) => section.rows.length > 0),
    [transport, data.credentials, data.vault, data.sidecar, data.identity, data.sources, data.index, t],
  )

  const summary = React.useMemo(() => summarizeSections(sections), [sections])
  const allRows = React.useMemo(() => sections.flatMap((section) => section.rows), [sections])
  const attention = React.useMemo(() => attentionRows(allRows), [allRows])
  const selectedRow = selectedId ? allRows.find((row) => row.id === selectedId) ?? null : null

  const refresh = React.useCallback(() => setRefreshToken((value) => value + 1), [])

  const rebuildIndex = React.useCallback(async () => {
    if (!workspaceId || typeof window.electronAPI?.rebuildNoteIndex !== 'function') return
    setRebuilding(true)
    try {
      await window.electronAPI.rebuildNoteIndex(workspaceId)
    } finally {
      setRebuilding(false)
      setRefreshToken((value) => value + 1)
    }
  }, [workspaceId])

  const onFix = React.useCallback((row: HealthRow) => {
    if (row.fix) navigate(fixRoute(row.fix))
  }, [])

  const renderDetailExtra = (row: HealthRow): React.ReactNode => {
    if (row.id === 'index:notes' && data.index) {
      return (
        <VaultIndexHealthPanel
          health={data.index}
          rebuilding={rebuilding}
          onRebuild={() => { void rebuildIndex() }}
        />
      )
    }
    if (row.id === 'services:transport' || row.id === 'services:sidecar') {
      return (
        <React.Suspense fallback={<div className="text-muted-foreground">{t('common.loading')}</div>}>
          <LazyDiagnostics transport={transport} />
        </React.Suspense>
      )
    }
    return null
  }

  const detailExtra = selectedRow ? renderDetailExtra(selectedRow) : null
  // «Всё работает» means nothing is broken; `unknown` rows are honest, not alarming.
  const allClear = attention.length === 0

  return (
    <ScreenRoot>
      <ScreenColumn width="clamp(260px, 34%, 380px)">
        <ScreenHeader
          title={t('extraScreens.health.title')}
          subtitle={summary.total > 0 ? t('extraScreens.health.checked', { count: summary.total }) : undefined}
          actions={
            <>
              <DeviceStatusChip />
              <ScreenButton variant="ghost" onClick={refresh}>
                {t('common.refresh')}
              </ScreenButton>
            </>
          }
        />
        <div className="shrink-0 px-4 pb-2">
          {allClear ? (
            <div className="rounded-[var(--radius-card)] bg-surface-hover px-3 py-2.5" data-testid="health-all-ok">
              <div className="font-bold text-success">{t('extraScreens.health.allOkTitle')}</div>
              <div className="mt-0.5 text-small text-muted-foreground">{t('extraScreens.health.allOkBody')}</div>
            </div>
          ) : (
            <div
              className={summary.error > 0 ? 'rounded-[var(--radius-card)] bg-destructive/10 px-3 py-2.5' : 'rounded-[var(--radius-card)] bg-status-warning/10 px-3 py-2.5'}
              data-testid="health-attention"
            >
              <div className="flex items-center gap-2">
                <HealthStatusDot status={summary.status} />
                <span className="font-bold">
                  {t('extraScreens.health.attentionTitle', { count: attention.length })}
                </span>
              </div>
              <div className="mt-1 space-y-0.5">
                {attention.slice(0, 4).map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-1 py-0.5 text-left text-small text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  >
                    <HealthStatusDot status={row.status} />
                    <span className="min-w-0 flex-1 truncate">{t(row.labelKey, row.labelParams)}</span>
                  </button>
                ))}
                {attention.length > 4 && (
                  <div className="px-1 pt-0.5 text-small text-muted-foreground">
                    {t('extraScreens.health.andMore', { count: attention.length - 4 })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {data.loaded && allRows.length === 0 ? (
            <div className="px-4 py-6 text-muted-foreground">{t('extraScreens.health.empty')}</div>
          ) : (
            <HealthSectionList sections={sections} selectedId={selectedId} onSelect={(row) => setSelectedId(row.id)} />
          )}
        </div>
      </ScreenColumn>

      <ScreenDetail className="overflow-x-hidden">
        {selectedRow ? (
          <HealthRowDetail row={selectedRow} onFix={onFix} extra={detailExtra} />
        ) : (
          <div className="min-w-0 max-w-[720px]">
            <h2 className="text-title font-bold leading-tight">{t('extraScreens.health.title')}</h2>
            <p className="mt-1 text-muted-foreground">{t('extraScreens.health.subtitle')}</p>
            {allClear ? (
              <p className="mt-4 text-text-secondary">{t('extraScreens.health.allOkBody')}</p>
            ) : (
              <div className="mt-4 space-y-1">
                {attention.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-surface-hover"
                  >
                    <HealthStatusDot status={row.status} />
                    <span className="min-w-0 flex-1 truncate">{t(row.labelKey, row.labelParams)}</span>
                    <span className="shrink-0 truncate text-small text-muted-foreground">{t(row.detailKey, row.detailParams)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </ScreenDetail>
    </ScreenRoot>
  )
}
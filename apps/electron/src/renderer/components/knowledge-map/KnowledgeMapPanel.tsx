/**
 * KnowledgeMapPanel — the knowledge-map surface used by Settings → Контекст
 * (full: Граф / Дерево / Документ) and Settings → Аккаунт (compact preview).
 *
 * Data comes from `useKnowledgeMap()`; the layout is the pure `radialLayout`.
 * All copy resolves through plan §4 `knowledgeMap.*` keys.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2, RefreshCw, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner, Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { SettingsSegmentedControl } from '@/components/settings'
import { radialLayout } from './radial-layout'
import {
  AREA_COLORS,
  AREA_LABEL_KEYS,
  AREA_ORDER,
  buildCountItems,
  buildStatItems,
  filterGraph,
  formatStatItems,
  truncatedSummary,
} from './knowledge-map-model'
import { IDENTITY_VIEW, KnowledgeMapGraph, ZOOM_MAX, ZOOM_MIN, type GraphView } from './KnowledgeMapGraph'
import { KnowledgeMapTree } from './KnowledgeMapTree'
import { KnowledgeMapDocView } from './KnowledgeMapDocView'
import { useKnowledgeMap } from './use-knowledge-map'

type KnowledgeMapMode = 'graph' | 'tree' | 'doc'

/** Id of the legend element the graph points its `aria-describedby` at. */
const LEGEND_ID = 'knowledge-map-legend'

interface KnowledgeMapPanelProps {
  workspaceId: string | null
  compact?: boolean
  /** Compact mode: invoked by the "open full map" button and the preview. */
  onOpenFull?: () => void
}

export function KnowledgeMapPanel({ workspaceId, compact = false, onOpenFull }: KnowledgeMapPanelProps) {
  const { t, i18n } = useTranslation()
  const { dto, loading, error, unavailable, refresh } = useKnowledgeMap()
  const [mode, setMode] = React.useState<KnowledgeMapMode>('graph')
  const [query, setQuery] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [view, setView] = React.useState<GraphView>(IDENTITY_VIEW)

  const filtered = React.useMemo(
    () => (dto ? filterGraph(dto.nodes, dto.edges, query) : { nodes: [], edges: [] }),
    [dto, query],
  )
  const layout = React.useMemo(() => radialLayout(filtered), [filtered])
  const selectedNode = React.useMemo(
    () => (dto && selectedId ? dto.nodes.find((node) => node.id === selectedId) ?? null : null),
    [dto, selectedId],
  )

  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'ru'

  const openNode = React.useCallback((id: string) => {
    setSelectedId(id)
    setMode('doc')
  }, [])

  const zoomBy = (factor: number) => {
    setView((current) => {
      const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current.scale * factor))
      return { ...current, scale }
    })
  }

  if (unavailable) {
    return <p className="px-1 py-6 text-sm text-muted-foreground">{t('knowledgeMap.unavailable')}</p>
  }
  if (error) {
    return <p className="px-1 py-6 text-sm text-muted-foreground" role="alert">{t('knowledgeMap.error')}</p>
  }
  if (!dto) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="w-4 h-4" />
      </div>
    )
  }

  const truncated = truncatedSummary(dto.stats)
  const truncatedNotice = truncated ? (
    <span className="rounded border border-border px-1.5 py-0.5 text-status-warning">
      {t(truncated.key, { shown: truncated.shown, total: truncated.total })}
    </span>
  ) : null

  const statsLine = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="tabular-nums">{formatStatItems(buildStatItems(dto.stats), t)}</span>
      <span>{t('knowledgeMap.generatedAt', { time: new Date(dto.generatedAt).toLocaleString(locale) })}</span>
      {truncatedNotice}
    </div>
  )

  const legend = (
    <div
      id={LEGEND_ID}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
    >
      {AREA_ORDER.map((area) => (
        <span key={area} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: AREA_COLORS[area] }} aria-hidden />
          {t(AREA_LABEL_KEYS[area])}
        </span>
      ))}
      <span className="text-muted-foreground/70">{t('knowledgeMap.legend.hint')}</span>
    </div>
  )

  if (compact) {
    const summary = formatStatItems(buildCountItems(dto.stats), t)
    return (
      <div className="space-y-3">
        {dto.stats.files === 0 ? (
          <p className="text-sm text-muted-foreground">{t('knowledgeMap.empty.title')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{summary}</span>
              {truncatedNotice}
            </div>
            <div
              className="h-[180px] rounded-lg border border-border bg-surface-elevated/40 pointer-events-none"
              aria-hidden
            >
              <KnowledgeMapGraph
                dto={dto}
                layout={radialLayout({ nodes: dto.nodes, edges: dto.edges })}
                selectedId={null}
                onSelectNode={() => {}}
                onOpenNode={() => onOpenFull?.()}
                view={IDENTITY_VIEW}
                onViewChange={() => {}}
                compact
              />
            </div>
          </>
        )}
        <Button size="sm" variant="outline" onClick={() => onOpenFull?.()}>
          {t('knowledgeMap.profile.openFull')}
        </Button>
      </div>
    )
  }

  if (dto.stats.files === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">{t('knowledgeMap.empty.title')}</p>
        <p className="text-sm text-muted-foreground">{t('knowledgeMap.empty.body')}</p>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={`icon-caption mr-1.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          {t('knowledgeMap.refresh')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SettingsSegmentedControl<KnowledgeMapMode>
          size="sm"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'graph', label: t('knowledgeMap.view.graph') },
            { value: 'tree', label: t('knowledgeMap.view.tree') },
            { value: 'doc', label: t('knowledgeMap.view.doc') },
          ]}
          aria-label={t('knowledgeMap.title')}
        />
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" onClick={refresh} disabled={loading} aria-label={t('knowledgeMap.refresh')}>
                <RefreshCw className={`icon-caption ${loading ? 'animate-spin' : ''}`} aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('knowledgeMap.refresh')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" onClick={() => setView(IDENTITY_VIEW)} aria-label={t('knowledgeMap.fit')}>
                <Maximize2 className="icon-caption" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('knowledgeMap.fit')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" onClick={() => zoomBy(1 / 1.2)} aria-label={t('knowledgeMap.zoomOut')}>
                <ZoomOut className="icon-caption" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('knowledgeMap.zoomOut')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" onClick={() => zoomBy(1.2)} aria-label={t('knowledgeMap.zoomIn')}>
                <ZoomIn className="icon-caption" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('knowledgeMap.zoomIn')}</TooltipContent>
          </Tooltip>
        </div>
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 icon-caption -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('knowledgeMap.search.placeholder')}
            className="pl-7"
            aria-label={t('knowledgeMap.search.placeholder')}
          />
        </div>
      </div>

      {statsLine}
      {legend}

      <div className="rounded-lg border border-border overflow-hidden bg-surface-elevated/30">
        {mode === 'graph' && (
          <div className="h-[440px]">
            <KnowledgeMapGraph
              dto={dto}
              layout={layout}
              selectedId={selectedId}
              onSelectNode={setSelectedId}
              onOpenNode={openNode}
              view={view}
              onViewChange={setView}
              describedById={LEGEND_ID}
            />
          </div>
        )}
        {mode === 'tree' && (
          <div className="max-h-[440px] overflow-auto p-3">
            <KnowledgeMapTree
              nodes={filtered.nodes}
              edges={filtered.edges}
              query={query}
              selectedId={selectedId}
              onSelectNode={setSelectedId}
              onOpenNode={openNode}
            />
          </div>
        )}
        {mode === 'doc' && (
          <div className="max-h-[440px] overflow-auto p-4">
            <KnowledgeMapDocView node={selectedNode} workspaceId={workspaceId} />
          </div>
        )}
      </div>
    </div>
  )
}

export default KnowledgeMapPanel
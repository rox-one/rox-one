/**
 * Entity multi-view tabs: Standard | Map | Outline | Graph | Rox Notes map | …
 * Generalizes the (now removed) SessionViewTabs for session / note / knowledge surfaces.
 * Spec: docs/superpowers/specs/2026-08-08-entity-mindmap-views-design.md
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  GitBranch,
  LayoutGrid,
  ListTree,
  MessageSquare,
  Network,
  Share2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import * as storage from '@/lib/local-storage'

export type EntityViewId =
  | 'standard'
  | 'map'
  | 'outline'
  | 'graph'
  | 'mindmap'
  | 'teamchat'
  | 'table'
  | 'canvas'

export interface EntityViewCapability {
  id: EntityViewId
  available: boolean
  labelKey: string
  icon: LucideIcon
}

const DEFAULT_ICONS: Record<EntityViewId, LucideIcon> = {
  standard: MessageSquare,
  map: Network,
  outline: ListTree,
  graph: Share2,
  mindmap: Network,
  teamchat: GitBranch,
  table: LayoutGrid,
  canvas: Network,
}

/**
 * The i18n key for every view id — the single source the capability tables below
 * expose as `labelKey`. Kept explicit so no caller fabricates a key from the id
 * (`entityView.teamchat`, `entityView.mindmap`) that does not exist in the
 * locale files; the shipped keys are `entityView.teamChat` and
 * `entityView.mindmapKnowledge`.
 */
export const ENTITY_VIEW_LABEL_KEYS: Record<EntityViewId, string> = {
  standard: 'entityView.standard',
  map: 'entityView.map',
  outline: 'entityView.outline',
  graph: 'entityView.graph',
  mindmap: 'entityView.mindmapKnowledge',
  teamchat: 'entityView.teamChat',
  table: 'entityView.table',
  canvas: 'entityView.canvas',
}

export function defaultSessionEntityCapabilities(opts?: {
  siyuanConnected?: boolean
}): EntityViewCapability[] {
  const siyuan = opts?.siyuanConnected ?? false
  return [
    { id: 'standard', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.standard, icon: DEFAULT_ICONS.standard },
    { id: 'map', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.map, icon: DEFAULT_ICONS.map },
    { id: 'outline', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.outline, icon: DEFAULT_ICONS.outline },
    { id: 'graph', available: siyuan, labelKey: ENTITY_VIEW_LABEL_KEYS.graph, icon: DEFAULT_ICONS.graph },
    {
      id: 'mindmap',
      available: siyuan,
      labelKey: ENTITY_VIEW_LABEL_KEYS.mindmap,
      icon: DEFAULT_ICONS.mindmap,
    },
    { id: 'teamchat', available: false, labelKey: ENTITY_VIEW_LABEL_KEYS.teamchat, icon: DEFAULT_ICONS.teamchat },
  ]
}

export function defaultNoteEntityCapabilities(): EntityViewCapability[] {
  return [
    { id: 'standard', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.standard, icon: DEFAULT_ICONS.standard },
    { id: 'table', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.table, icon: DEFAULT_ICONS.table },
    { id: 'canvas', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.canvas, icon: DEFAULT_ICONS.canvas },
    { id: 'outline', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.outline, icon: DEFAULT_ICONS.outline },
    { id: 'graph', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.graph, icon: DEFAULT_ICONS.graph },
    { id: 'map', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.map, icon: DEFAULT_ICONS.map },
  ]
}

export function defaultKnowledgeEntityCapabilities(opts?: {
  siyuanConnected?: boolean
}): EntityViewCapability[] {
  const siyuan = opts?.siyuanConnected ?? false
  return [
    { id: 'standard', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.standard, icon: DEFAULT_ICONS.standard },
    { id: 'map', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.map, icon: DEFAULT_ICONS.map },
    { id: 'outline', available: true, labelKey: ENTITY_VIEW_LABEL_KEYS.outline, icon: DEFAULT_ICONS.outline },
    { id: 'graph', available: siyuan, labelKey: ENTITY_VIEW_LABEL_KEYS.graph, icon: DEFAULT_ICONS.graph },
  ]
}

function readStoredView(
  scopeKey: string,
  capabilities: EntityViewCapability[],
  fallback: EntityViewId,
): EntityViewId {
  const fromNew = storage.get<string | null>(storage.KEYS.entityViewMode, null, scopeKey)
  const legacySessionId = scopeKey.startsWith('session:') ? scopeKey.slice('session:'.length) : null
  const fromLegacy =
    legacySessionId != null
      ? storage.get<string | null>(storage.KEYS.sessionViewMode, null, legacySessionId)
      : null
  const raw = fromNew ?? fromLegacy ?? fallback
  const available = capabilities.some((c) => c.id === raw && c.available)
  return available ? (raw as EntityViewId) : fallback
}

export function useEntityView(
  scopeKey: string,
  capabilities: EntityViewCapability[],
  defaultId: EntityViewId = 'standard',
): [EntityViewId, (id: EntityViewId) => void] {
  const capsKey = capabilities.map((c) => `${c.id}:${c.available ? 1 : 0}`).join(',')

  const [view, setViewState] = React.useState<EntityViewId>(() =>
    readStoredView(scopeKey, capabilities, defaultId),
  )

  React.useEffect(() => {
    setViewState(readStoredView(scopeKey, capabilities, defaultId))
    // capabilities identity via capsKey
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capsKey tracks availability
  }, [scopeKey, capsKey, defaultId])

  const setView = React.useCallback(
    (id: EntityViewId) => {
      setViewState(id)
      storage.set(storage.KEYS.entityViewMode, id, scopeKey)
      // Keep legacy session key in sync for session scopes
      if (scopeKey.startsWith('session:')) {
        storage.set(storage.KEYS.sessionViewMode, id, scopeKey.slice('session:'.length))
      }
    },
    [scopeKey],
  )

  return [view, setView]
}

export interface EntityViewTabsProps {
  value: EntityViewId
  onChange: (id: EntityViewId) => void
  capabilities: EntityViewCapability[]
  className?: string
  /**
   * `row` (default): full-width strip under a header (notes / knowledge).
   * `segmented`: compact control that lives inside a panel header row next to
   * the title. Labels collapse to icons in narrow panels (container query on
   * `@container/panel`), so it never clips; every item keeps a tooltip and an
   * aria-label.
   */
  variant?: 'row' | 'segmented'
}

export function EntityViewTabs({ value, onChange, capabilities, className, variant = 'row' }: EntityViewTabsProps) {
  const { t } = useTranslation()
  const visible = capabilities.filter((c) => c.available || c.id === value)
  const items: TabItem[] = visible.map(({ id, labelKey, icon: Icon, available }) => {
    const label = t(labelKey)
    return {
      id,
      label,
      title: label,
      disabled: !available && id !== value,
      icon: <Icon className="icon-caption shrink-0" aria-hidden />,
    }
  })

  if (variant === 'segmented') {
    return (
      <Tabs
        items={items}
        activeId={value}
        variant="segmented"
        density="compact"
        collapseLabels
        keyboard
        ariaLabel={t('entityView.tabsLabel')}
        className={className}
        onSelect={(id) => onChange(id as EntityViewId)}
      />
    )
  }

  return (
    <Tabs
      items={items}
      activeId={value}
      variant="surface"
      density="full"
      keyboard
      ariaLabel={t('entityView.tabsLabel')}
      className={cn('px-3 py-1.5 border-b border-border/40 bg-background/40 shrink-0', className)}
      onSelect={(id) => onChange(id as EntityViewId)}
    />
  )
}

export interface EntityViewPlaceholderProps {
  view: EntityViewId
  /**
   * Explicit label key from the view's capability (`EntityViewCapability.labelKey`
   * / `ENTITY_VIEW_LABEL_KEYS`). When omitted the placeholder resolves the same
   * single-source map instead of fabricating `entityView.${view}` (which produced
   * keys that do not exist: `entityView.teamchat`, `entityView.mindmap`).
   */
  labelKey?: string
}

export function EntityViewPlaceholder({ view, labelKey }: EntityViewPlaceholderProps) {
  const { t } = useTranslation()
  const Icon = DEFAULT_ICONS[view] ?? Network
  const key = labelKey ?? ENTITY_VIEW_LABEL_KEYS[view] ?? 'entityView.comingSoon'

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center min-h-0">
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-control)] bg-foreground/5 text-muted-foreground">
        <Icon className="icon-empty" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t(key)}</p>
        <p className="text-sm text-muted-foreground">{t('entityView.comingSoon')}</p>
      </div>
    </div>
  )
}

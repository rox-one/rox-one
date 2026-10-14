/**
 * Second-sidebar groups for Буфер обмена: Закреплённое / Сегодня / Ранее / Типы,
 * built from the live clipboard-history controller state (no fixtures) into the
 * shell's `SidebarGroup` contract.
 */
import { FileText, Image as ImageIcon } from 'lucide-react'
import type { ClipCounts, ClipEntrySummary } from '@rox/shared/clipboard-history'
import type { SidebarGroup, SidebarGroupState } from '@/components/shell/screen-sidebar'
import { collapsePreviewText, type ClipboardKindFilter } from './clipboard-history-model'

export interface ClipboardSidebarInput {
  /** Unfiltered pinned entries (independent of the panel's search/filters). */
  pinned: readonly ClipEntrySummary[]
  /** Unfiltered most-recent non-pinned entries. */
  recent: readonly ClipEntrySummary[]
  /** Whether more rows exist beyond the fetched window. */
  more: { pinned: boolean; recent: boolean }
  unavailable: boolean
  counts: ClipCounts
  /** Local midnight of the current day; Сегодня/Ранее re-bucket only when it changes. */
  dayStart: number
  /** The panel already shows a role=alert for this error. */
  panelAlerting: boolean
  selectedId: number | null
  activeKind: ClipboardKindFilter
  loading: boolean
  error: string | null
  labels: {
    pinned: string; today: string; earlier: string; types: string
    image: string; text: string; images: string; empty: string; error: string
    unavailable: string; enable: string; showAll: string; retry: string
  }
  onOpenEntry(id: number): void
  onFilterKind(kind: ClipboardKindFilter): void
  onRetry(): void
  onOpenSettings(): void
  /** Open the full (unfiltered) list in the panel: history or starred tab. */
  onShowAll(tab: 'history' | 'starred'): void
}

/** Unfiltered windows fetched for the sidebar (Закреплённое / Сегодня+Ранее). */
export const PINNED_LIMIT = 5
export const RECENT_LIMIT = 10
export const RECENT_FETCH = RECENT_LIMIT * 2

export function startOfLocalDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function buildClipboardSidebarGroups(input: ClipboardSidebarInput): SidebarGroup[] {
  const { labels } = input
  const hasEntries = input.pinned.length + input.recent.length > 0
  if (input.unavailable) {
    return [{ id: 'pinned', title: labels.pinned, items: [], state: { kind: 'empty', label: labels.unavailable, action: { id: 'enable', label: labels.enable, onSelect: input.onOpenSettings } } }]
  }
  if (input.error && !hasEntries) {
    return [{ id: 'pinned', title: labels.pinned, items: [], state: { kind: 'error', label: labels.error, onRetry: input.onRetry, announce: !input.panelAlerting } }]
  }
  if (input.loading && !hasEntries) {
    return [{ id: 'pinned', title: labels.pinned, items: [], state: { kind: 'loading' } }]
  }
  const { dayStart } = input
  const toItem = (entry: ClipEntrySummary) => ({
    id: `clip-${entry.id}`,
    icon: entry.kind === 'image' ? ImageIcon : FileText,
    label: entry.kind === 'image'
      ? (entry.sourceApp ? `${labels.image} · ${entry.sourceApp}` : labels.image)
      : collapsePreviewText(entry.preview || entry.text || '').slice(0, 80) || labels.text,
    ariaKind: 'selected' as const,
    active: entry.id === input.selectedId,
    onSelect: () => input.onOpenEntry(entry.id),
  })
  const pinned = input.pinned
  const today = input.recent.filter((e) => Date.parse(e.createdAt) >= dayStart)
  const earlier = input.recent.filter((e) => !(Date.parse(e.createdAt) >= dayStart))
  const types = ([
    { kind: 'text', label: labels.text, count: input.counts.text, icon: FileText },
    { kind: 'image', label: labels.images, count: input.counts.image, icon: ImageIcon },
  ] as const).filter((row) => row.count > 0)
  const groups: SidebarGroup[] = [
    { id: 'pinned', title: labels.pinned, initialVisible: PINNED_LIMIT, items: pinned.slice(0, PINNED_LIMIT).map(toItem),
      ...(input.more.pinned ? { actions: [{ id: 'all-pinned', label: labels.showAll, onSelect: () => input.onShowAll('starred') }] } : {}) },
    { id: 'today', title: labels.today, initialVisible: RECENT_LIMIT, items: today.slice(0, RECENT_LIMIT).map(toItem),
      ...(today.length > RECENT_LIMIT ? { actions: [{ id: 'all-today', label: labels.showAll, onSelect: () => input.onShowAll('history') }] } : {}) },
    { id: 'earlier', title: labels.earlier, initialVisible: RECENT_LIMIT, items: earlier.slice(0, RECENT_LIMIT).map(toItem),
      ...(input.more.recent || earlier.length > RECENT_LIMIT ? { actions: [{ id: 'all-recent', label: labels.showAll, onSelect: () => input.onShowAll('history') }] } : {}) },
    {
      id: 'types',
      title: labels.types,
      initialVisible: types.length,
      items: types.map((row) => ({
        id: `type-${row.kind}`,
        label: row.label,
        icon: row.icon,
        ariaKind: 'pressed' as const,
        badge: row.count,
        active: input.activeKind === row.kind,
        onSelect: () => input.onFilterKind(input.activeKind === row.kind ? 'all' : row.kind),
      })),
    },
  ]
  const visible = groups.filter((g) => g.items.length > 0)
  if (input.error) {
    // Keep the stale groups; surface the failure as a compact retry row.
    visible.unshift({ id: 'error', items: [{ id: 'retry', label: `${labels.error} · ${labels.retry}`, onSelect: input.onRetry }] })
  }
  if (visible.length > 0) return visible
  const empty: SidebarGroupState = { kind: 'empty', label: labels.empty }
  return [{ id: 'pinned', title: labels.pinned, items: [], state: empty }]
}

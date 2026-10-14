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
  entries: readonly ClipEntrySummary[]
  counts: ClipCounts
  now: number
  selectedId: number | null
  activeKind: ClipboardKindFilter
  loading: boolean
  error: string | null
  labels: {
    pinned: string; today: string; earlier: string; types: string
    image: string; text: string; images: string; empty: string; error: string
  }
  onOpenEntry(id: number): void
  onFilterKind(kind: ClipboardKindFilter): void
  onRetry(): void
}

function startOfLocalDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function buildClipboardSidebarGroups(input: ClipboardSidebarInput): SidebarGroup[] {
  const { labels } = input
  if (input.error) {
    return [{ id: 'pinned', title: labels.pinned, items: [], state: { kind: 'error', label: labels.error, onRetry: input.onRetry } }]
  }
  if (input.loading && input.entries.length === 0) {
    return [{ id: 'pinned', title: labels.pinned, items: [], state: { kind: 'loading' } }]
  }
  const dayStart = startOfLocalDay(input.now)
  const toItem = (entry: ClipEntrySummary) => ({
    id: `clip-${entry.id}`,
    icon: entry.kind === 'image' ? ImageIcon : FileText,
    label: entry.kind === 'image'
      ? (entry.sourceApp ? `${labels.image} · ${entry.sourceApp}` : labels.image)
      : collapsePreviewText(entry.preview || entry.text || '').slice(0, 80) || labels.text,
    active: entry.id === input.selectedId,
    onSelect: () => input.onOpenEntry(entry.id),
  })
  const pinned = input.entries.filter((e) => e.starred)
  const rest = input.entries.filter((e) => !e.starred)
  const today = rest.filter((e) => Date.parse(e.createdAt) >= dayStart)
  const earlier = rest.filter((e) => !(Date.parse(e.createdAt) >= dayStart))
  const types = ([
    { kind: 'text', label: labels.text, count: input.counts.text, icon: FileText },
    { kind: 'image', label: labels.images, count: input.counts.image, icon: ImageIcon },
  ] as const).filter((row) => row.count > 0)
  const groups: SidebarGroup[] = [
    { id: 'pinned', title: labels.pinned, initialVisible: 5, items: pinned.map(toItem) },
    { id: 'today', title: labels.today, initialVisible: 10, items: today.map(toItem) },
    { id: 'earlier', title: labels.earlier, initialVisible: 10, items: earlier.map(toItem) },
    {
      id: 'types',
      title: labels.types,
      initialVisible: types.length,
      items: types.map((row) => ({
        id: `type-${row.kind}`,
        label: row.label,
        icon: row.icon,
        badge: row.count,
        active: input.activeKind === row.kind,
        onSelect: () => input.onFilterKind(input.activeKind === row.kind ? 'all' : row.kind),
      })),
    },
  ]
  const visible = groups.filter((g) => g.items.length > 0)
  if (visible.length > 0) return visible
  const empty: SidebarGroupState = { kind: 'empty', label: labels.empty }
  return [{ id: 'pinned', title: labels.pinned, items: [], state: empty }]
}

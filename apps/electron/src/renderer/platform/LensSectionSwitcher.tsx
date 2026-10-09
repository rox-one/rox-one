/**
 * LensSectionSwitcher (G6 «Линзы») — the section switcher header of a lens.
 *
 * One row of section tabs above the (unchanged) inspector bodies. The ARIA tabs
 * pattern, the roving tabindex and the keyboard (Arrow/Home/End) come from the
 * shared `Tabs` primitive (segmented profile) — no hand-rolled `role="tab"`
 * here; labels reuse `inspector.tab.*` / `inspector.*` keys from the section rail.
 */
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import type { InspectorSectionId } from '@/atoms/unified-shell'

export interface LensSectionEntry {
  id: InspectorSectionId
  label: string
  icon: LucideIcon
  count?: string
}

interface LensSectionSwitcherProps {
  label: string
  sections: readonly LensSectionEntry[]
  section: InspectorSectionId
  onSection: (id: InspectorSectionId) => void
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

export function LensSectionSwitcher({
  label,
  sections,
  section,
  onSection,
  orientation = 'horizontal',
  className,
}: LensSectionSwitcherProps) {
  const items: TabItem[] = sections.map((entry) => {
    const Icon = entry.icon
    return {
      id: entry.id,
      label: entry.label,
      title: entry.label,
      icon: <Icon className="icon-caption shrink-0" aria-hidden="true" />,
      badge: entry.count ? (
        <span className="shrink-0 tabular-nums text-caption text-text-secondary">{entry.count}</span>
      ) : undefined,
    }
  })

  return (
    <div
      className={cn(
        'shrink-0',
        orientation === 'vertical' ? 'px-1 py-1.5' : 'border-b border-border-subtle px-1.5 py-1',
        className,
      )}
      data-lens-switcher={orientation}
    >
      <Tabs
        items={items}
        activeId={section}
        variant="segmented"
        density="compact"
        orientation={orientation}
        keyboard
        ariaLabel={label}
        className={cn('gap-0.5', orientation === 'vertical' && 'flex-col')}
        onSelect={(id) => onSection(id as InspectorSectionId)}
      />
    </div>
  )
}
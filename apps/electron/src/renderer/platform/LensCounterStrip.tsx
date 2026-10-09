/**
 * LensCounterStrip (G6 «Линзы») — the collapsed lens as a 32px counter strip.
 *
 * Replaces the bare 28px restore button when the lens is closed: the same
 * "what is in this session" question is answered by contextual counters, and
 * every counter is a button that reopens the lens (keyboard reachable, labelled
 * `label: value`).
 */
import type { LucideIcon } from 'lucide-react'
import { PanelRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InspectorSectionId } from '@/atoms/unified-shell'

export interface LensCounterEntry {
  id: InspectorSectionId
  label: string
  icon: LucideIcon
  value: string
}

interface LensCounterStripProps {
  expandLabel: string
  counters: readonly LensCounterEntry[]
  onExpand: () => void
  onSelect?: (id: InspectorSectionId) => void
  /** Mirror the shipped strip's `data-session-inspector` for tests. */
  sessionInspector?: boolean
  className?: string
}

export function LensCounterStrip({ expandLabel, counters, onExpand, onSelect, sessionInspector, className }: LensCounterStripProps) {
  return (
    <div
      className={cn(
        'chrome-strip rox-shell-pane rox-shell-divider-l flex h-full w-8 shrink-0 flex-col items-center gap-1.5 py-2',
        className,
      )}
      data-inspector="collapsed"
      data-lens-strip="true"
      data-session-inspector={sessionInspector === undefined ? undefined : sessionInspector ? 'true' : 'false'}
    >
      <button
        type="button"
        aria-label={expandLabel}
        onClick={onExpand}
        className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <PanelRight className="icon-caption" />
      </button>
      <span className="h-px w-5 bg-border-subtle" aria-hidden="true" />
      {counters.map((entry) => {
        const Icon = entry.icon
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => (onSelect ? onSelect(entry.id) : onExpand())}
            aria-label={`${entry.label}: ${entry.value}`}
            data-lens-strip-counter={entry.id}
            className="flex min-h-[var(--control-hit-min)] w-full flex-col items-center justify-center gap-0.5 rounded-[var(--radius-xs)] py-1 text-caption tabular-nums text-text-secondary hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Icon className="icon-caption" aria-hidden="true" />
            <span>{entry.value}</span>
          </button>
        )
      })}
    </div>
  )
}
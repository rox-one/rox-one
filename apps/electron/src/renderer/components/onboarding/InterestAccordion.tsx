/**
 * InterestAccordion — the middle column of the one-page questionnaire.
 *
 * Shows the bubble groups as a stepper: one group is open at a time, the
 * others collapse to a single line with the chips chosen so far. Groups are
 * multi-select, so the open group never closes on a chip click; «Далее»
 * advances to the next group (the last one says «Готово» and collapses).
 *
 * Collapsed bodies stay mounted but `hidden`, so selections, ranking and
 * tests that look up chips keep working. Keyboard: the headers are native
 * buttons (Enter/Space toggle) with ArrowUp/ArrowDown/Home/End roving
 * between them, following the WAI-ARIA accordion pattern.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InterestBubbles } from './InterestBubbles'
import { BUBBLE_GROUPS, type BubbleGroupId, type BubbleLocale } from './bubbles-catalog'

export interface InterestAccordionProps {
  groupIds: readonly BubbleGroupId[]
  selection: Record<BubbleGroupId, string[]>
  onChange: (groupId: BubbleGroupId, next: string[]) => void
  rankedIds?: Partial<Record<BubbleGroupId, string[]>>
  locale: BubbleLocale
  /** Initially open group; defaults to the first one. `null` = all closed. */
  defaultOpen?: BubbleGroupId | null
  className?: string
}

/** Labels of the chosen chips, in catalogue order, for the collapsed summary. */
export function summarizeSelection(
  groupId: BubbleGroupId,
  selected: readonly string[],
  locale: BubbleLocale,
): string[] {
  if (selected.length === 0) return []
  const chosen = new Set(selected)
  return BUBBLE_GROUPS[groupId].items.filter((item) => chosen.has(item.id)).map((item) => item[locale])
}

/** Group to open after `current`; null when `current` is the last one. */
export function nextGroupId(
  groupIds: readonly BubbleGroupId[],
  current: BubbleGroupId,
): BubbleGroupId | null {
  const index = groupIds.indexOf(current)
  return index >= 0 && index < groupIds.length - 1 ? groupIds[index + 1] : null
}

export function InterestAccordion({
  groupIds,
  selection,
  onChange,
  rankedIds,
  locale,
  defaultOpen,
  className,
}: InterestAccordionProps) {
  const { t } = useTranslation()
  const baseId = React.useId()
  const [open, setOpen] = React.useState<BubbleGroupId | null>(
    defaultOpen === undefined ? (groupIds[0] ?? null) : defaultOpen,
  )
  const headerRefs = React.useRef<Partial<Record<BubbleGroupId, HTMLButtonElement | null>>>({})

  const focusHeader = (index: number) => {
    const id = groupIds[(index + groupIds.length) % groupIds.length]
    if (id) headerRefs.current[id]?.focus()
  }

  const onHeaderKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusHeader(index + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        focusHeader(index - 1)
        break
      case 'Home':
        event.preventDefault()
        focusHeader(0)
        break
      case 'End':
        event.preventDefault()
        focusHeader(groupIds.length - 1)
        break
      default:
    }
  }

  const advance = (groupId: BubbleGroupId) => {
    const next = nextGroupId(groupIds, groupId)
    setOpen(next)
    const target = next ?? groupId
    // Move focus to the header that is now relevant so keyboard users continue.
    requestAnimationFrame(() => headerRefs.current[target]?.focus())
  }

  return (
    <div
      data-testid="interest-accordion"
      className={cn('flex flex-col gap-1.5', className)}
    >
      {groupIds.map((groupId, index) => {
        const isOpen = open === groupId
        const selected = selection[groupId] ?? []
        const summary = summarizeSelection(groupId, selected, locale)
        const title = t(`onboarding.bubbles.group.${groupId}`)
        const headerId = `${baseId}-${groupId}-header`
        const panelId = `${baseId}-${groupId}-panel`
        const isLast = index === groupIds.length - 1
        return (
          <section
            key={groupId}
            data-testid={`interest-accordion-${groupId}`}
            data-state={isOpen ? 'open' : 'closed'}
            className={cn(
              'rounded-[var(--radius-card)] border transition-colors motion-reduce:transition-none',
              isOpen ? 'border-border bg-background/60 shadow-minimal' : 'border-border/50 bg-background/25',
            )}
          >
            <h3 className="m-0">
              <button
                ref={(node) => {
                  headerRefs.current[groupId] = node
                }}
                id={headerId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                data-testid={`interest-accordion-header-${groupId}`}
                onClick={() => setOpen(isOpen ? null : groupId)}
                onKeyDown={(event) => onHeaderKeyDown(event, index)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-[var(--radius-card)] px-3 py-2 text-left',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums',
                    selected.length > 0
                      ? 'border-accent/40 bg-accent/15 text-foreground'
                      : 'border-border/60 text-muted-foreground',
                  )}
                >
                  {selected.length > 0 ? <Check className="size-3" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold tracking-tight text-foreground">{title}</span>
                  {!isOpen ? (
                    <span
                      data-testid={`interest-accordion-summary-${groupId}`}
                      className="block truncate text-xs text-muted-foreground"
                      title={summary.length > 0 ? summary.join(', ') : undefined}
                    >
                      {summary.length > 0 ? summary.join(' · ') : t('onboarding.bubbles.summaryEmpty')}
                    </span>
                  ) : (
                    <span className="block text-xs text-muted-foreground">{t('onboarding.bubbles.hint')}</span>
                  )}
                </span>
                {selected.length > 0 ? (
                  <span className="shrink-0 rounded-full bg-accent/15 px-1.5 text-[11px] font-medium tabular-nums text-foreground">
                    {selected.length}
                  </span>
                ) : null}
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                    isOpen && 'rotate-180',
                  )}
                />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={headerId}
              hidden={!isOpen}
              className="px-3 pb-3"
            >
              <InterestBubbles
                groupId={groupId}
                selected={selected}
                onChange={(next) => onChange(groupId, next)}
                {...(rankedIds?.[groupId] ? { rankedIds: rankedIds[groupId] } : {})}
                locale={locale}
                hideHeader
              />
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  data-testid={`interest-accordion-next-${groupId}`}
                  onClick={() => advance(groupId)}
                  className={cn(
                    'inline-flex h-7 items-center rounded-full border border-border/70 bg-background/60 px-3 text-xs font-medium',
                    'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55',
                  )}
                >
                  {isLast ? t('onboarding.bubbles.done') : t('onboarding.bubbles.next')}
                </button>
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

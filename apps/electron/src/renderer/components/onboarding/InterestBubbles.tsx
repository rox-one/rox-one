import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  BUBBLE_GROUPS,
  orderBubbleItems,
  type BubbleGroupId,
  type BubbleLocale,
} from './bubbles-catalog'

export interface InterestBubblesProps {
  groupId: BubbleGroupId
  /** Currently selected item ids. Owned by the parent. */
  selected: string[]
  /** Called with the full next selection on every toggle. */
  onChange: (next: string[]) => void
  /**
   * deepInterests only: item ids to float to the front. Ordering only — the
   * selection still comes from `selected`, and no item is ever dropped.
   */
  rankedIds?: string[]
  /** Label language; defaults to the active i18n language. */
  locale?: BubbleLocale
  className?: string
}

/**
 * Interest cloud: a wrapping set of multi-select bubble chips.
 *
 * Standalone by design — selection state lives in the parent (`selected` /
 * `onChange`), so the wizard can persist or gate on it without this component
 * knowing anything about wizard internals. Each chip is a real `button` with
 * `role="checkbox"`, so keyboard users toggle it with Enter/Space and screen
 * readers announce the checked state.
 */
export function InterestBubbles({
  groupId,
  selected,
  onChange,
  rankedIds,
  locale,
  className,
}: InterestBubblesProps) {
  const { t, i18n } = useTranslation()
  const group = BUBBLE_GROUPS[groupId]
  const lang: BubbleLocale = locale
    ?? (i18n?.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en')
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const items = useMemo(() => orderBubbleItems(group, rankedIds), [group, rankedIds])
  const title = t(`onboarding.bubbles.group.${groupId}`)

  const toggle = (id: string) => {
    onChange(
      selectedSet.has(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id],
    )
  }

  return (
    <section
      className={cn('space-y-3', className)}
      data-testid={`interest-bubbles-${groupId}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{t('onboarding.bubbles.hint')}</p>
      </div>

      {group.dependsOn ? (
        <p className="text-xs text-muted-foreground">{t('onboarding.bubbles.dependsOn')}</p>
      ) : null}

      <div role="group" aria-label={title} className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isSelected = selectedSet.has(item.id)
          return (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              data-bubble-id={item.id}
              data-bubble-anchor={item.anchor ? 'true' : undefined}
              onClick={() => toggle(item.id)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm leading-none transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-out motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                isSelected
                  ? 'border-accent/40 bg-accent/15 font-medium text-foreground shadow-minimal scale-[1.02]'
                  : 'border-border/60 bg-background/40 text-muted-foreground hover:border-border hover:bg-surface-hover hover:text-foreground active:scale-[0.98]',
              )}
            >
              {item[lang]}
            </button>
          )
        })}
      </div>
    </section>
  )
}
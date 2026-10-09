import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  PROFILE_BUBBLE_GROUPS,
  rankDeepInterests,
  type ProfileBubbleGroupId,
  type ProfileBubbleItem,
  type ProfileBubbleLocale,
} from './profile-catalog'

export interface ProfileBubblesProps {
  groupId: ProfileBubbleGroupId
  /** Currently selected item ids across all groups. Owned by the parent. */
  selected: string[]
  /** Called with the full next selection on every toggle. */
  onChange: (next: string[]) => void
  /** Selected `function` ids — drives the adaptive group's ranking. */
  functions?: string[]
  /** Selected `area` ids — drives the adaptive group's ranking. */
  areas?: string[]
  /** Label language; defaults to the active i18n language. */
  locale?: ProfileBubbleLocale
  className?: string
}

/**
 * Profile bubble cloud: a wrapping set of multi-select chip bubbles.
 *
 * Selection state lives in the parent (`selected` / `onChange`). Each chip is a
 * real `button` with `role="checkbox"` so Enter/Space toggle it and screen
 * readers announce the checked state.
 */
export function ProfileBubbles({
  groupId,
  selected,
  onChange,
  functions = [],
  areas = [],
  locale,
  className,
}: ProfileBubblesProps) {
  const { t, i18n } = useTranslation()
  const group = PROFILE_BUBBLE_GROUPS[groupId]
  const lang: ProfileBubbleLocale = locale
    ?? (i18n?.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en')
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const items = useMemo<ProfileBubbleItem[]>(
    () => (group.adaptive ? rankDeepInterests({ functions, areas }, selected) : group.items),
    [group, functions, areas, selected],
  )
  const title = t(`onboarding.bubbles.group.${groupId}`)

  const toggle = (id: string) => {
    onChange(selectedSet.has(id) ? selected.filter((item) => item !== id) : [...selected, id])
  }

  return (
    <section className={cn('space-y-2', className)} data-testid={`profile-bubbles-${groupId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{t('onboarding.bubbles.hint')}</p>
      </div>

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
/**
 * SubscribersPicker (W1-08; TECH-SPEC §3.7 subscriptions).
 *
 * Facepile summary + popover with a multi-select PeopleList and the
 * "Notify everyone with access" switch (`subscriptions.set_notify_everyone`).
 * The component is controlled: it emits the next id set / switch state and
 * never writes anything itself (commands are the host's job).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { FOCUS_RING, HOVER_TINT, MOTION_FAST, POPOVER_SURFACE } from '../primitives/tokens'
import { PeopleList, PersonAvatar, type PersonOption } from '../person-field/PeopleList'

export interface SubscribersPickerProps {
  people: readonly PersonOption[]
  subscriberIds: readonly string[]
  onChange?: (nextIds: string[]) => void
  notifyEveryone?: boolean
  onNotifyEveryoneChange?: (value: boolean) => void
  defaultOpen?: boolean
  className?: string
}

/** Toggle one id in an ordered id list (pure; exported for tests). */
export function toggleSubscriber(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

export function SubscribersPicker({ people, subscriberIds, onChange, notifyEveryone = false, onNotifyEveryoneChange, defaultOpen = false, className }: SubscribersPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(defaultOpen)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const switchId = React.useId()
  const selected = React.useMemo(() => new Set(subscriberIds), [subscriberIds])
  const subscribers = people.filter((p) => selected.has(p.id))
  const count = subscribers.length

  return (
    <div className={cn('relative inline-flex flex-col', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn('inline-flex h-8 items-center gap-2 rounded-[6px] px-2 text-[12px]', HOVER_TINT, MOTION_FAST, FOCUS_RING)}
      >
        <span className="flex -space-x-1.5" aria-hidden="true">
          {subscribers.slice(0, 3).map((p) => <PersonAvatar key={p.id} person={p} size={20} />)}
        </span>
        <span className="text-text-secondary">
          {count === 0 ? t('entities.ui.subscribers.empty') : t('entities.ui.subscribers.count', { count })}
        </span>
      </button>
      {open ? (
        <div role="dialog" aria-label={t('entities.ui.subscribers.title')} className={cn('absolute left-0 top-full z-20 mt-1 flex flex-col', POPOVER_SURFACE)}>
          <div className="px-3 pt-2 text-[12px] font-semibold">{t('entities.ui.subscribers.title')}</div>
          <PeopleList
            people={people}
            selectedIds={selected}
            multi
            autoFocus
            onEscape={() => { setOpen(false); triggerRef.current?.focus() }}
            onPick={(person) => onChange?.(toggleSubscriber(subscriberIds, person.id))}
          />
          <label htmlFor={switchId} className="flex items-center gap-2 border-t border-border px-3 py-2 text-[12px]">
            <input
              id={switchId}
              type="checkbox"
              role="switch"
              checked={notifyEveryone}
              disabled={!onNotifyEveryoneChange}
              onChange={(e) => onNotifyEveryoneChange?.(e.target.checked)}
              className={cn('size-3.5 accent-[var(--accent)]', FOCUS_RING)}
            />
            {t('entities.ui.subscribers.notifyEveryone')}
          </label>
        </div>
      ) : null}
    </div>
  )
}

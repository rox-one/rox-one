/**
 * PillsTopBarConfigurator — the onboarding «Настройте пилюли сверху» editor.
 *
 * A live miniature of the real titlebar: the chosen screens render as the
 * same `.rox-mode-pill` segments the TopBar uses (Главная is icon-only), in a
 * mock window strip. Drag a pill sideways to reorder, × removes it, and the
 * screens below add a pill. Icons come from the shared surface registry
 * (`usePillOptions` → primary-nav `entry.icon`), the same source as the rail.
 *
 * Keyboard: Space/Enter on a pill grabs it, ←/→ moves it, Space/Enter drops,
 * Esc cancels; Delete/Backspace removes. Writes go through the same store as
 * Settings → Appearance (`applyPillsSelection`).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { announce } from '@/lib/a11y/announcer'
import type { PillOption } from './PillsConfigurator'
import { MAX_PILLS, movePill } from './pills'

export interface PillsTopBarConfiguratorProps {
  options: readonly PillOption[]
  value: readonly string[]
  onChange(next: string[]): void
  className?: string
}

export function PillsTopBarConfigurator({ options, value, onChange, className }: PillsTopBarConfiguratorProps) {
  const { t } = useTranslation()
  const byId = React.useMemo(() => new Map(options.map((option) => [option.id, option])), [options])
  const selected = React.useMemo(() => value.filter((id) => byId.has(id)), [value, byId])
  const available = options.filter((option) => !selected.includes(option.id))
  const full = selected.length >= MAX_PILLS
  const [grabbed, setGrabbed] = React.useState<{ id: string; origin: number } | null>(null)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropIndex, setDropIndex] = React.useState<number | null>(null)
  const stripRef = React.useRef<HTMLDivElement>(null)
  const titleOf = (id: string) => byId.get(id)?.title ?? id

  const focusPill = (id: string) => requestAnimationFrame(() => {
    stripRef.current?.querySelector<HTMLElement>(`[data-pill-item="${CSS.escape(id)}"]`)?.focus()
  })
  const move = (id: string, to: number, silent = false) => {
    const from = selected.indexOf(id)
    if (from < 0) return
    const target = Math.max(0, Math.min(to, selected.length - 1))
    if (target === from) return
    onChange(movePill(selected, from, target))
    if (!silent) announce(t('shell.pills.movedTo', { name: titleOf(id), position: target + 1, total: selected.length }))
    focusPill(id)
  }
  const remove = (id: string) => {
    onChange(selected.filter((pill) => pill !== id))
    announce(t('shell.pills.removed', { name: titleOf(id) }))
  }
  const add = (id: string) => {
    if (full) return
    onChange([...selected, id])
    announce(t('shell.pills.added', { name: titleOf(id) }))
  }

  const onKeyDown = (event: React.KeyboardEvent, id: string) => {
    const index = selected.indexOf(id)
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (grabbed?.id === id) {
        setGrabbed(null)
        announce(t('shell.pills.dropped', { name: titleOf(id), position: index + 1, total: selected.length }))
      } else {
        setGrabbed({ id, origin: index })
        announce(t('shell.pills.grabbed', { name: titleOf(id) }))
      }
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      remove(id)
      return
    }
    if (grabbed?.id !== id) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(id, index - 1) }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(id, index + 1) }
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      move(id, grabbed.origin, true)
      setGrabbed(null)
      announce(t('shell.pills.cancelled', { name: titleOf(id) }))
    }
  }

  return (
    <div className={cn('flex flex-col gap-4', className)} data-pills-topbar="">
      {/* Mock window titlebar */}
      <div className="onb-topbar-mock" aria-labelledby="pills-topbar-title">
        <div className="onb-topbar-chrome" aria-hidden="true">
          <i /><i /><i />
        </div>
        <div className="flex min-w-0 flex-1 justify-center">
          {selected.length === 0 ? (
            <p className="onb-helper px-3 text-xs text-muted-foreground" data-pills-empty="">{t('shell.pills.none')}</p>
          ) : (
            <div
              ref={stripRef}
              role="list"
              aria-describedby="pills-topbar-help"
              className="rox-mode-pill onb-mode-pill"
              onDragOver={(event) => { if (dragId) event.preventDefault() }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragId !== null && dropIndex !== null) move(dragId, dropIndex > selected.indexOf(dragId) ? dropIndex - 1 : dropIndex)
                setDragId(null)
                setDropIndex(null)
              }}
            >
              {selected.map((id, index) => {
                const option = byId.get(id)!
                const Icon = option.icon
                const isGrabbed = grabbed?.id === id || dragId === id
                return (
                  <div
                    key={id}
                    role="listitem"
                    className={cn('onb-pill-slot', dropIndex === index && dragId !== id && 'onb-drop-before', dropIndex === index + 1 && index === selected.length - 1 && dragId !== id && 'onb-drop-after')}
                    draggable
                    onDragStart={(event) => { setDragId(id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) }}
                    onDragEnd={() => { setDragId(null); setDropIndex(null) }}
                    onDragOver={(event) => {
                      if (!dragId) return
                      event.preventDefault()
                      const rect = event.currentTarget.getBoundingClientRect()
                      setDropIndex(event.clientX < rect.left + rect.width / 2 ? index : index + 1)
                    }}
                  >
                    <button
                      type="button"
                      data-pill-item={id}
                      data-icon-only={option.iconOnly || undefined}
                      aria-pressed={grabbed?.id === id}
                      aria-label={t('shell.pills.handle', { name: option.title, position: index + 1, total: selected.length })}
                      title={option.title}
                      onKeyDown={(event) => onKeyDown(event, id)}
                      onBlur={() => { if (grabbed?.id === id) setGrabbed(null) }}
                      className={cn('rox-mode-pill-item onb-pill-item', isGrabbed && 'onb-pill-grabbed')}
                      aria-current={index === 0 ? 'page' : undefined}
                    >
                      <Icon className="rox-mode-pill-icon" aria-hidden />
                      {!option.iconOnly && <span className="rox-mode-pill-label">{option.title}</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(id)}
                      data-pill-remove={id}
                      aria-label={t('shell.pills.remove', { name: option.title })}
                      className="onb-pill-remove"
                    >
                      <X aria-hidden />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="onb-topbar-chrome-spacer" aria-hidden="true" />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p id="pills-topbar-help" className="onb-helper text-xs text-muted-foreground">{t('shell.pills.help')}</p>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => { onChange([]); announce(t('shell.pills.clearedAll')) }}
            className="onb-secondary shrink-0 rounded-full px-3 py-1 text-xs"
            data-pills-clear=""
          >
            {t('shell.pills.noPills')}
          </button>
        )}
      </div>

      <section aria-labelledby="pills-available-title" className="flex flex-col gap-2">
        <h3 id="pills-available-title" className="text-sm font-semibold">{t('shell.pills.available')}</h3>
        {full && <p className="onb-helper text-xs text-muted-foreground">{t('shell.pills.limit', { count: MAX_PILLS })}</p>}
        <ul className="flex flex-wrap gap-1.5">
          {available.map((option) => {
            const Icon = option.icon
            return (
              <li key={option.id}>
                <button
                  type="button"
                  disabled={full}
                  onClick={() => add(option.id)}
                  data-pill-add={option.id}
                  aria-label={t('shell.pills.add', { name: option.title })}
                  className="onb-glass flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Plus className="icon-status opacity-60 [stroke-width:var(--icon-stroke)]" aria-hidden />
                  <Icon className="size-3.5" aria-hidden />
                  {option.iconOnly ? <span className="sr-only">{option.title}</span> : option.title}
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

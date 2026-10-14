/**
 * PillsConfigurator (shell-layout): choose and order the top pills — zero is
 * allowed. Drag-n-drop with a full keyboard alternative: Space/Enter grabs a
 * pill, ↑/↓ (or ←/→) moves it, Space/Enter drops, Esc cancels; every row also
 * has explicit Move up / Move down / Remove buttons. Used as the last
 * onboarding step and in Settings → Appearance.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { announce } from '@/lib/a11y/announcer'
import { MAX_PILLS, movePill } from './pills'

export interface PillOption {
  id: string
  title: string
  icon: LucideIcon
  /** Rendered icon-only in the pill (Главная). */
  iconOnly?: boolean
}

export interface PillsConfiguratorProps {
  options: readonly PillOption[]
  value: readonly string[]
  onChange(next: string[]): void
  className?: string
}

export function PillsConfigurator({ options, value, onChange, className }: PillsConfiguratorProps) {
  const { t } = useTranslation()
  const byId = React.useMemo(() => new Map(options.map((option) => [option.id, option])), [options])
  const selected = React.useMemo(() => value.filter((id) => byId.has(id)), [value, byId])
  const available = options.filter((option) => !selected.includes(option.id))
  const [grabbed, setGrabbed] = React.useState<{ id: string; origin: number } | null>(null)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropIndex, setDropIndex] = React.useState<number | null>(null)
  const listRef = React.useRef<HTMLOListElement>(null)
  const full = selected.length >= MAX_PILLS

  const focusRow = (id: string) => requestAnimationFrame(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-pill-row="${CSS.escape(id)}"] [data-pill-handle]`)?.focus()
  })
  const titleOf = (id: string) => byId.get(id)?.title ?? id

  const move = (id: string, to: number, opts: { silent?: boolean } = {}) => {
    const from = selected.indexOf(id)
    if (from < 0) return
    const target = Math.max(0, Math.min(to, selected.length - 1))
    if (target === from) return
    onChange(movePill(selected, from, target))
    if (!opts.silent) announce(t('shell.pills.movedTo', { name: titleOf(id), position: target + 1, total: selected.length }))
    focusRow(id)
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

  const onHandleKeyDown = (event: React.KeyboardEvent, id: string) => {
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
    if (grabbed?.id === id) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); move(id, index - 1) }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); move(id, index + 1) }
      else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        move(id, grabbed.origin, { silent: true })
        setGrabbed(null)
        announce(t('shell.pills.cancelled', { name: titleOf(id) }))
      }
    }
  }

  return (
    <div className={cn('flex flex-col gap-4', className)} data-pills-configurator="">
      <p id="pills-configurator-help" className="text-caption text-muted-foreground">{t('shell.pills.help')}</p>
      <section aria-labelledby="pills-selected-title" className="flex flex-col gap-2">
        <h3 id="pills-selected-title" className="text-body font-semibold">{t('shell.pills.selected')}</h3>
        {selected.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-border-subtle p-3 text-caption text-muted-foreground" data-pills-empty="">
            {t('shell.pills.none')}
          </p>
        ) : (
          <ol
            ref={listRef}
            className="flex flex-col gap-1"
            aria-describedby="pills-configurator-help"
            onDragOver={(event) => { if (dragId) event.preventDefault() }}
            onDrop={(event) => {
              event.preventDefault()
              if (dragId !== null && dropIndex !== null) move(dragId, dropIndex > selected.indexOf(dragId) ? dropIndex - 1 : dropIndex)
              setDragId(null); setDropIndex(null)
            }}
          >
            {selected.map((id, index) => {
              const option = byId.get(id)!
              const Icon = option.icon
              const isGrabbed = grabbed?.id === id
              return (
                <li
                  key={id}
                  data-pill-row={id}
                  draggable
                  onDragStart={(event) => { setDragId(id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) }}
                  onDragEnd={() => { setDragId(null); setDropIndex(null) }}
                  onDragOver={(event) => {
                    if (!dragId) return
                    event.preventDefault()
                    const rect = event.currentTarget.getBoundingClientRect()
                    setDropIndex(event.clientY < rect.top + rect.height / 2 ? index : index + 1)
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-[var(--radius-control)] border px-2 py-1',
                    isGrabbed || dragId === id ? 'border-accent bg-[var(--state-selected)]' : 'border-border-subtle',
                    dropIndex === index && dragId !== id && 'border-t-accent',
                  )}
                >
                  <button
                    type="button"
                    data-pill-handle=""
                    aria-pressed={isGrabbed}
                    aria-label={t('shell.pills.handle', { name: option.title, position: index + 1, total: selected.length })}
                    onKeyDown={(event) => onHandleKeyDown(event, id)}
                    onBlur={() => { if (isGrabbed) setGrabbed(null) }}
                    className="flex size-6 cursor-grab items-center justify-center rounded-[var(--radius-control)] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <GripVertical className="icon-caption" aria-hidden />
                  </button>
                  <Icon className="icon-caption shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-body">{option.title}</span>
                  <button type="button" disabled={index === 0} onClick={() => move(id, index - 1)} aria-label={t('shell.pills.moveUp', { name: option.title })} className="flex size-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-[var(--state-hover)] disabled:opacity-40 focus-visible:ring-1 focus-visible:ring-ring">
                    <ArrowUp className="icon-caption" aria-hidden />
                  </button>
                  <button type="button" disabled={index === selected.length - 1} onClick={() => move(id, index + 1)} aria-label={t('shell.pills.moveDown', { name: option.title })} className="flex size-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-[var(--state-hover)] disabled:opacity-40 focus-visible:ring-1 focus-visible:ring-ring">
                    <ArrowDown className="icon-caption" aria-hidden />
                  </button>
                  <button type="button" onClick={() => remove(id)} aria-label={t('shell.pills.remove', { name: option.title })} data-pill-remove={id} className="flex size-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-ring">
                    <X className="icon-caption" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ol>
        )}
        <div className="flex flex-wrap gap-2">
          {selected.length > 0 && (
            <button type="button" onClick={() => { onChange([]); announce(t('shell.pills.clearedAll')) }} className="rounded-[var(--radius-control)] px-2 py-1 text-caption text-muted-foreground hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-ring" data-pills-clear="">
              {t('shell.pills.noPills')}
            </button>
          )}
        </div>
      </section>
      <section aria-labelledby="pills-available-title" className="flex flex-col gap-2">
        <h3 id="pills-available-title" className="text-body font-semibold">{t('shell.pills.available')}</h3>
        {full && <p className="text-caption text-muted-foreground">{t('shell.pills.limit', { count: MAX_PILLS })}</p>}
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
                  className="flex h-7 items-center gap-1.5 rounded-full border border-border-subtle px-2.5 text-body hover:bg-[var(--state-hover)] disabled:opacity-40 focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Plus className="icon-caption" aria-hidden />
                  <Icon className="icon-caption" aria-hidden />
                  {option.title}
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

/**
 * Главная widget kit — flat, borderless building blocks. Tone steps only (no
 * 1px lines); radius tokens 4/6/8/10/12; 4px spacing grid; type inherits
 * --font-sans (Arial Narrow). High contrast: the widget tone and the row
 * hover step get stronger via `.rox-home-widget` rules in index.css, never an
 * outline.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, GripVertical, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HOME_WIDGET_SIZES, type HomeWidgetSize } from './dashboard-layout'

export interface WidgetEditProps {
  size: HomeWidgetSize
  onResize: (size: HomeWidgetSize) => void
  onRemove: () => void
  onShift: (delta: -1 | 1) => void
  dragHandle?: React.HTMLAttributes<HTMLButtonElement> & { ref?: React.Ref<HTMLButtonElement> }
}

export function WidgetFrame({
  title,
  onOpen,
  meta,
  edit,
  children,
  testId,
  action,
}: {
  title: string
  /** Small header action (e.g. «Запись»), hidden in edit mode. */
  action?: React.ReactNode
  /** Click-through to the widget's screen. */
  onOpen?: () => void
  meta?: React.ReactNode
  edit?: WidgetEditProps | null
  children: React.ReactNode
  testId: string
}) {
  const { t } = useTranslation()
  return (
    <section
      className="rox-home-widget flex h-full min-h-0 min-w-0 flex-col rounded-[10px] px-3 pb-3 pt-2"
      data-home-widget={testId}
      aria-label={title}
    >
      <header className="flex h-7 shrink-0 items-center gap-1">
        {edit?.dragHandle ? (
          <button
            type="button"
            {...edit.dragHandle}
            className="-ml-1 flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-[4px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground active:cursor-grabbing"
            aria-label={t('workbench.home.edit.drag', { name: title })}
            title={t('workbench.home.edit.dragHint')}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); edit.onShift(-1) }
              else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); edit.onShift(1) }
            }}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onOpen && !edit ? (
          <button
            type="button"
            onClick={onOpen}
            className="group flex min-w-0 items-center gap-0.5 rounded-[4px] text-[12px] font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            <span className="truncate">{title}</span>
            <ChevronRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        ) : (
          <h2 className="min-w-0 truncate text-[12px] font-bold uppercase tracking-wide text-muted-foreground">{title}</h2>
        )}
        <span className="min-w-0 flex-1" />
        {!edit && meta ? <span className="shrink-0 truncate text-[12px] text-muted-foreground">{meta}</span> : null}
        {!edit && action ? <span className="ml-1 flex shrink-0 items-center">{action}</span> : null}
        {edit ? (
          <div className="flex shrink-0 items-center gap-1">
            <div className="flex items-center rounded-[6px] bg-foreground/[0.06] p-0.5" role="radiogroup" aria-label={t('workbench.home.edit.size')}>
              {HOME_WIDGET_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={edit.size === size}
                  title={t(`workbench.home.edit.size${size}`)}
                  onClick={() => edit.onResize(size)}
                  className={cn(
                    'h-5 min-w-5 rounded-[4px] px-1 text-[11px] font-bold',
                    edit.size === size ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={edit.onRemove}
              className="flex h-6 w-6 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              aria-label={t('workbench.home.edit.remove', { name: title })}
              title={t('workbench.home.edit.remove', { name: title })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </header>
      <div className={cn('relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto', edit && 'pointer-events-none select-none opacity-70')}>{children}</div>
    </section>
  )
}

/** One clickable list row. */
export function WidgetRow({
  onClick,
  leading,
  title,
  trailing,
  sub,
  testId,
  aside,
}: {
  onClick?: () => void
  /** Control rendered next to the row (outside its button), e.g. a toggle. */
  aside?: React.ReactNode
  leading?: React.ReactNode
  title: React.ReactNode
  trailing?: React.ReactNode
  sub?: React.ReactNode
  testId?: string
}) {
  const body = (
    <>
      {leading ? <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] leading-5 text-foreground">{title}</span>
        {sub ? <span className="truncate text-[12px] leading-4 text-muted-foreground">{sub}</span> : null}
      </span>
      {trailing != null ? <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{trailing}</span> : null}
    </>
  )
  const cls = 'rox-home-row flex w-full min-w-0 items-center gap-2 rounded-[6px] px-1.5 py-1 text-left'
  return (
    <li className={cn('min-w-0', aside != null && 'flex items-center gap-1')} data-home-row={testId}>
      {onClick ? (
        <button type="button" className={cls} onClick={onClick}>{body}</button>
      ) : (
        <div className={cls}>{body}</div>
      )}
      {aside != null ? <span className="flex shrink-0 items-center pr-1.5">{aside}</span> : null}
    </li>
  )
}

export function WidgetList({ children, columns = 1 }: { children: React.ReactNode; columns?: 1 | 2 }) {
  return <ul className={cn('-mx-1.5 min-w-0', columns === 2 ? 'grid grid-cols-2 gap-x-4' : 'flex flex-col')}>{children}</ul>
}

/** Honest empty state: what is missing and why, plus at most one action. */
export function WidgetEmpty({ text, hint, action }: { text: string; hint?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-start justify-center gap-1 text-[13px]" data-home-empty="">
      <p className="text-foreground">{text}</p>
      {hint ? <p className="text-[12px] leading-4 text-muted-foreground">{hint}</p> : null}
      {action ? (
        <button type="button" onClick={action.onClick} className="mt-1 rounded-[6px] bg-foreground/[0.08] px-2 py-1 text-[12px] font-bold text-foreground hover:bg-foreground/[0.14]">
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

export function WidgetStat({ label, value, sub, tone, onClick }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'danger' | 'warning' | 'accent'; onClick?: () => void }) {
  const inner = (
    <>
      <span className={cn(
        'block truncate text-[20px] font-bold leading-7 tabular-nums',
        tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-[var(--warning,#d9a13b)]' : tone === 'accent' ? 'text-accent' : 'text-foreground',
      )}>{value}{sub != null ? <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">{sub}</span> : null}</span>
      <span className="block truncate text-[11px] uppercase leading-4 tracking-wide text-muted-foreground">{label}</span>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="rox-home-row min-w-0 rounded-[6px] px-1.5 py-1 text-left">{inner}</button>
  ) : (
    <div className="min-w-0 px-1.5 py-1">{inner}</div>
  )
}

export function Dot({ tone }: { tone: 'accent' | 'success' | 'warning' | 'danger' | 'muted' }) {
  const color = {
    accent: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-[var(--warning,#d9a13b)]',
    danger: 'bg-destructive',
    muted: 'bg-text-muted',
  }[tone]
  return <span className={cn('inline-block h-2 w-2 rounded-full', color)} aria-hidden="true" />
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-0 pb-0.5 pt-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{children}</div>
}

/** Flat on/off switch (tone steps, no outline; HC gets a stronger track). */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'rox-home-toggle relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-foreground/20',
      )}
    >
      <span className={cn('inline-block h-3 w-3 rounded-full bg-background transition-transform', checked ? 'translate-x-[14px]' : 'translate-x-0.5')} />
    </button>
  )
}

/** Compact pill button used inside widgets (e.g. «Запись», «Добавить»). */
export function WidgetButton({ children, onClick, tone, disabled, title }: { children: React.ReactNode; onClick: () => void; tone?: 'danger'; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-[6px] px-2 text-[12px] font-bold disabled:opacity-60',
        tone === 'danger' ? 'bg-destructive/15 text-destructive hover:bg-destructive/25' : 'bg-foreground/[0.08] text-foreground hover:bg-foreground/[0.14]',
      )}
    >
      {children}
    </button>
  )
}

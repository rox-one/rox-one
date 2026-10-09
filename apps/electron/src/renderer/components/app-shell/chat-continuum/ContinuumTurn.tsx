/**
 * One turn in the continuum.
 *
 * There is no per-turn card: the turn is a document block. The left gutter
 * carries the timestamp and a marker sitting on a continuous spine, so the
 * conversation reads as one flowing record instead of a stack of containers.
 *
 * Ported from the G5 kit (`G5Turn` / `G5Prose` / `G5StreamingCaret` /
 * `G5Thinking`); measured anatomy: gutter 72px, marker 3×12, spine 1px,
 * rhythm 28px, prose 68ch.
 */
import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type ContinuumTurnKind = 'user' | 'assistant' | 'system'

export function ContinuumTurn({
  time,
  kind = 'assistant',
  streaming = false,
  thinking,
  focusOrder,
  children,
}: {
  /** Pre-formatted clock label, rendered in the gutter. */
  time: string
  kind?: ContinuumTurnKind
  streaming?: boolean
  /** Optional reasoning block rendered above the turn body (kit thinking row). */
  thinking?: { text: string; isStreaming: boolean; steps?: number }
  focusOrder?: number
  children: React.ReactNode
}) {
  return (
    <article
      data-g05-turn={kind}
      data-streaming={streaming ? 'true' : undefined}
      data-focus-order={focusOrder}
      className="relative pb-7 last:pb-2 pl-[72px]"
    >
      {/* Continuous 1px spine behind the markers (hidden for system dividers). */}
      {kind !== 'system' && (
        <span
          aria-hidden
          data-g05-spine
          className="absolute bottom-0 left-[49px] top-0 w-px bg-border-subtle"
        />
      )}
      <span
        aria-hidden
        className={cn(
          'absolute left-12 top-[6px] h-3 w-[3px] rounded-full',
          kind === 'user' && 'bg-accent',
          kind === 'assistant' && 'bg-border-strong',
          kind === 'system' && 'bg-transparent',
        )}
      />
      <time
        dateTime={time}
        className={cn(
          'absolute left-0 top-[3px] w-10 text-right text-caption tabular-nums',
          kind === 'user' ? 'font-medium text-text-secondary' : 'text-text-secondary',
        )}
      >
        {time}
      </time>
      <div className="min-w-0">
        {thinking && thinking.text && (
          <ContinuumThinkingDisclosure steps={thinking.steps}>
            <div className="whitespace-pre-wrap">{thinking.text}</div>
          </ContinuumThinkingDisclosure>
        )}
        {children}
        {streaming && <ContinuumStreamingCaret />}
      </div>
    </article>
  )
}

/** Prose measure inside the continuum. Artifacts deliberately break out of it. */
export function ContinuumProse({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('max-w-[68ch] text-reading text-text-primary', className)}>{children}</div>
  )
}

/** Author caption for the running turn while tokens still arrive. */
export function ContinuumStreamingCaret() {
  const { t } = useTranslation()
  return (
    <span className="mt-1 inline-flex items-baseline gap-1.5 text-text-secondary">
      <span
        aria-hidden
        data-g05-caret
        className="inline-block h-[1em] w-[2px] translate-y-[1px] bg-current motion-safe:animate-pulse motion-reduce:animate-none"
      />
      <span className="text-caption">{t('chat.continuum.streaming', { defaultValue: 'печатает…' })}</span>
    </span>
  )
}

/** Collapsible reasoning block — plain row, not a card. */
export function ContinuumThinkingDisclosure({
  steps,
  defaultOpen = false,
  focusOrder,
  children,
}: {
  steps?: number
  defaultOpen?: boolean
  focusOrder?: number
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(defaultOpen)
  const panelId = React.useId()

  return (
    <div data-g05-thinking className="mb-3 max-w-[68ch]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        data-focus-order={focusOrder}
        onClick={() => setOpen((value) => !value)}
        className="group -ml-1 inline-flex min-h-[28px] items-center gap-1.5 rounded-[var(--radius-control)] px-1 text-small text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-[length:var(--ring-width)] focus-visible:ring-focus-ring motion-reduce:transition-none"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'icon-toolbar text-text-muted motion-safe:transition-transform motion-safe:duration-[var(--motion-fast)]',
            open && 'rotate-90',
          )}
        />
        <span className="font-medium">{t('chat.continuum.thinking', { defaultValue: 'Обдумал' })}</span>
        {typeof steps === 'number' && (
          <>
            <span aria-hidden className="text-text-muted">
              ·
            </span>
            <span className="text-text-secondary">
              {t('chat.continuum.thinkingSteps', { count: steps, defaultValue: 'шагов: {{count}}' })}
            </span>
          </>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          className="mt-1.5 border-l border-border-subtle pl-4 text-small leading-relaxed text-text-secondary"
        >
          {children}
        </div>
      )}
    </div>
  )
}
/**
 * WidgetCard — the renderer-side mount lifecycle for ONE stored board widget.
 *
 * `board:widgetMount` is ticket-scoped: each call mints a fresh nonce bound to
 * the widget's current `(widgetId, revision)` and the current view generation,
 * and the previous revision's tickets are dropped on a re-put. This component
 * is the only place that talks to that RPC:
 *
 * - it mounts on demand and renders the leased document through `WidgetFrame`,
 *   keyed by the ticket so a new ticket always means a fresh, untainted frame;
 * - it releases the ticket on unmount and whenever the ticket changes
 *   (`board:widgetRelease` is idempotent, so the double-hook is harmless);
 * - a `board:changed` push for this widget whose revision has advanced
 *   re-mounts once with a fresh ticket — the old ticket is already dead
 *   server-side;
 * - a mount refused with the typed `WIDGET_TICKET_REFUSED` retries exactly
 *   once with a fresh ticket, then settles into typed refusal chrome instead
 *   of retrying forever;
 * - a `NOT_FOUND` mount settles as "no widget staged" chrome.
 */

import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, ShieldAlert, SquareDashed } from 'lucide-react'
import { toErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { WidgetFrame } from './WidgetFrame'

/** Automatic remounts a typed stale-ticket refusal may trigger before settling. */
export const MAX_WIDGET_STALE_REMOUNTS = 1

/** Terminal state when a mount never produced a lease. */
export type WidgetCardRefusalReason = 'unavailable' | 'ticket-refused' | 'mount-failed'

export interface WidgetCardProps {
  /** Board widget identity: the `name`/`widgetId` of a `board/widgets/<name>/` entry. */
  widgetId: string | null
  /** Operator-visible title; falls back to the widget id. */
  title?: string
  className?: string
  frameClassName?: string
  renderTimeoutMs?: number
}

interface WidgetLease {
  ticket: string
  content: string
  revision: number
}

type WidgetCardPhase = 'idle' | 'mounting' | 'leased' | WidgetCardRefusalReason

export function WidgetCard({ widgetId, title, className, frameClassName, renderTimeoutMs }: WidgetCardProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<WidgetCardPhase>('idle')
  const [lease, setLease] = useState<WidgetLease | null>(null)
  const [detail, setDetail] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const staleRemountsRef = useRef(0)
  const leaseRevisionRef = useRef(0)

  useEffect(() => {
    if (!widgetId) {
      setLease(null)
      setPhase('idle')
      return
    }
    let cancelled = false
    staleRemountsRef.current = 0
    setLease(null)
    setDetail('')
    setPhase('mounting')

    const mount = async (): Promise<void> => {
      try {
        const result = await window.electronAPI.mountBoardWidget({ widgetId })
        if (cancelled) return
        leaseRevisionRef.current = result.revision
        setLease({ ticket: result.ticket, content: result.content, revision: result.revision })
        setPhase('leased')
      } catch (error) {
        if (cancelled) return
        const code =
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : null
        if (code === 'WIDGET_TICKET_REFUSED' && staleRemountsRef.current < MAX_WIDGET_STALE_REMOUNTS) {
          // A refused ticket mints a new one on the next call; try once more,
          // then stop so a server stuck on the refusal cannot be hammered.
          staleRemountsRef.current += 1
          await mount()
          return
        }
        setLease(null)
        setDetail(toErrorMessage(error))
        setPhase(
          code === 'NOT_FOUND' ? 'unavailable' : code === 'WIDGET_TICKET_REFUSED' ? 'ticket-refused' : 'mount-failed',
        )
      }
    }

    void mount()
    return () => {
      cancelled = true
    }
  }, [widgetId, refreshKey])

  // Release on unmount and on every ticket change. `board:widgetRelease` is
  // idempotent, so a ticket that already expired is not an error worth surfacing.
  useEffect(() => {
    const ticket = lease?.ticket
    if (!ticket) return
    return () => {
      void window.electronAPI.releaseBoardWidget({ ticket }).catch(() => {})
    }
  }, [lease?.ticket])

  // A re-put of this widget advances its revision server-side and drops the
  // live ticket, so the frame must be re-leased rather than kept.
  useEffect(() => {
    if (!widgetId) return
    return window.electronAPI.onBoardChanged(payload => {
      if (payload.widgetId !== widgetId) return
      if (payload.revision > leaseRevisionRef.current) setRefreshKey(key => key + 1)
    })
  }, [widgetId])

  if (!widgetId) return null

  if (phase === 'mounting') {
    return (
      <div
        role="status"
        data-testid="widget-card-loading"
        className={cn('flex h-full w-full items-center justify-center gap-2 text-small text-muted-foreground', className)}
      >
        <LoaderCircle className="icon-caption animate-spin" aria-hidden />
        {t('board.widget.loading')}
      </div>
    )
  }

  if (phase === 'leased' && lease) {
    return (
      <WidgetFrame
        key={lease.ticket}
        title={title ?? widgetId}
        content={lease.content}
        className={frameClassName}
        {...(renderTimeoutMs === undefined ? {} : { renderTimeoutMs })}
      />
    )
  }

  if (phase === 'idle') return null

  const unavailable = phase === 'unavailable'
  const Icon = unavailable ? SquareDashed : ShieldAlert
  const titleKey = unavailable ? 'board.widget.unavailableTitle' : 'board.widget.refusedTitle'
  const bodyKey = unavailable ? 'board.widget.unavailableBody' : 'board.widget.refusedBody'
  return (
    <div
      role="status"
      data-testid="widget-card-refusal"
      data-reason={phase}
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-4 py-6 text-center',
        className,
      )}
    >
      <Icon className="icon-rail text-muted-foreground" aria-hidden />
      <div className="text-body font-semibold text-foreground">{t(titleKey)}</div>
      <p className="max-w-[360px] text-small leading-relaxed text-muted-foreground">{t(bodyKey)}</p>
      {phase === 'mount-failed' && detail ? (
        <p className="max-w-[360px] break-words text-caption text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  )
}
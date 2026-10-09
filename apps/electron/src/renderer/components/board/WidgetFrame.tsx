/**
 * WidgetFrame — the sandboxed host for ONE leased board-widget document.
 *
 * Ported posture from the pages renderer (`PageFrame`) and OpenClaw's
 * `ui/src/components/board/board-widget-frame.ts`: the leased document is
 * rendered into an opaque-origin frame and the host trusts nothing that frame
 * says unless it both came from THIS frame's window and parses against a
 * strict message schema.
 *
 * Deliberate ROX contract for this version (wave 3, rows b2.3/b2.5):
 *
 * - `sandbox="allow-scripts"` only — NEVER `allow-same-origin`. Scripts plus
 *   same-origin would hand the widget document the embedding application's
 *   origin and, through it, the preload `electronAPI` bridge. The frame's
 *   origin is opaque and serializes as `'null'`.
 * - `srcDoc` is exactly the leased document (`buildWidgetDocument` output):
 *   nothing is injected, rewritten or re-wrapped here. The document already
 *   carries its own `default-src 'none'` CSP and bridge bootstrap.
 * - The bridge bootstrap posts a `MessagePort` to the host. This version
 *   deliberately NEVER opens that port: there is no `board.data` /
 *   `board.action` proxying, so a widget cannot reach privileged state even
 *   though the wrap document offers the channel.
 * - The ONLY message consumed is the wrap's `size` report, and only from this
 *   frame's window with origin `'null'`. `ready` and the MessagePort-bearing
 *   `bootstrap` are dropped too, so no channel is ever established, and
 *   everything else (foreign windows, the host document itself, other
 *   origins, malformed payloads) is dropped as well.
 * - A frame that never reports content is surfaced as typed failure chrome
 *   instead of a silently blank iframe.
 */

import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Ban } from 'lucide-react'
import { WIDGET_SIZE_MESSAGE_TYPE } from '@rox/shared/widgets/wrap'
import { cn } from '@/lib/utils'

/** The opaque origin every `sandbox` frame without `allow-same-origin` serializes. */
export const WIDGET_FRAME_ORIGIN = 'null'

/**
 * How long a frame may stay silent before the host stops waiting for content.
 * The wrap's size reporter fires on load and again at 50 ms / 500 ms, so a
 * widget that renders anything reports long before this.
 */
export const WIDGET_RENDER_TIMEOUT_MS = 10_000

/** Why the frame was replaced by chrome. */
export type WidgetFrameFailureCode = 'frame-unavailable' | 'runtime-error'

export interface WidgetFrameFailure {
  code: WidgetFrameFailureCode
}

export interface WidgetFrameProps {
  /** Operator-visible title; also the frame's accessible name. */
  title: string
  /** Exact leased document to render. Never transformed. */
  content: string
  className?: string
  /** Reported content height in CSS px, for the host's own layout. */
  onContentHeight?: (height: number) => void
  renderTimeoutMs?: number
}

/**
 * Strict schema for the ONLY message this host consumes.
 *
 * The wrap document also posts `ready` and the MessagePort-bearing
 * `bootstrap`; both are deliberately dropped, so no privileged channel is ever
 * established. Anything that is not a finite, positive `size` height returns
 * `null` and can never reach component state.
 */
export function parseWidgetFrameMessage(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as { type?: unknown; height?: unknown }
  if (record.type !== WIDGET_SIZE_MESSAGE_TYPE) return null
  const height = record.height
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null
  return height
}

/**
 * The full accept rule: the event must come from THIS frame's window with the
 * opaque origin, and its payload must parse. Everything else is dropped.
 */
export function acceptWidgetFrameMessage(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  frameWindow: Window | null,
): number | null {
  if (!frameWindow || event.source !== frameWindow) return null
  if (event.origin !== WIDGET_FRAME_ORIGIN) return null
  return parseWidgetFrameMessage(event.data)
}

export function WidgetFrame({
  title,
  content,
  className,
  onContentHeight,
  renderTimeoutMs = WIDGET_RENDER_TIMEOUT_MS,
}: WidgetFrameProps) {
  const { t } = useTranslation()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const heightCallbackRef = useRef(onContentHeight)
  heightCallbackRef.current = onContentHeight

  const [height, setHeight] = useState<number | null>(null)
  const [failure, setFailure] = useState<WidgetFrameFailure | null>(null)

  useEffect(() => {
    setHeight(null)
    setFailure(null)
    // A frame that never reports content (a widget that threw before painting,
    // a document that never executed) would otherwise stay a blank box forever.
    const timer = window.setTimeout(() => {
      setFailure(current => current ?? { code: 'runtime-error' })
    }, renderTimeoutMs)

    const onMessage = (event: MessageEvent) => {
      const reportedHeight = acceptWidgetFrameMessage(event, frameRef.current?.contentWindow ?? null)
      // Anything that is not a same-frame, opaque-origin size report is dropped;
      // `ready` and the MessagePort-bearing `bootstrap` never reach this path.
      if (reportedHeight === null) return
      window.clearTimeout(timer)
      setFailure(null)
      setHeight(reportedHeight)
      heightCallbackRef.current?.(reportedHeight)
    }
    // Attached imperatively, not via a React `onError` prop: `error` on a frame
    // is not delegated, and the direct listener is what actually fires.
    const frame = frameRef.current
    const onFrameError = () => setFailure(current => current ?? { code: 'frame-unavailable' })
    frame?.addEventListener('error', onFrameError)
    window.addEventListener('message', onMessage)
    return () => {
      window.clearTimeout(timer)
      frame?.removeEventListener('error', onFrameError)
      window.removeEventListener('message', onMessage)
    }
  }, [content, renderTimeoutMs])

  if (failure) {
    const unavailable = failure.code === 'frame-unavailable'
    const Icon = unavailable ? Ban : AlertTriangle
    return (
      <div
        role="alert"
        data-testid="widget-frame-failure"
        data-failure-code={failure.code}
        className={cn(
          'flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-dashed border-border bg-card px-4 py-6 text-center',
          className,
        )}
      >
        <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.6} aria-hidden />
        <div className="text-body font-semibold text-foreground">
          {t(unavailable ? 'board.widget.frame.unavailableTitle' : 'board.widget.frame.runtimeErrorTitle')}
        </div>
        <p className="max-w-[360px] text-small leading-relaxed text-muted-foreground">
          {t(unavailable ? 'board.widget.frame.unavailableBody' : 'board.widget.frame.runtimeErrorBody')}
        </p>
      </div>
    )
  }

  return (
    <iframe
      ref={frameRef}
      data-testid="widget-frame"
      title={title}
      // NEVER add allow-same-origin: scripts + same-origin would expose the
      // embedding application's origin and the preload bridge to widget code.
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="eager"
      // The bridged document travels as the exact leased bytes; the wrap's CSP
      // meta stays authoritative inside the frame.
      srcDoc={content}
      className={cn('w-full border-0 bg-white', className)}
      style={{ height: height === null ? '100%' : `${height}px` }}
    />
  )
}
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useNavigationActions } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import * as storage from '@/lib/local-storage'
import {
  GUIDED_TOUR_START_EVENT, GUIDED_TOUR_STEPS, GUIDED_TOUR_VERSION, findShowableIndex, placeCard, resolveStepRect,
  shouldAutoStartGuidedTour, type GuidedTourStatus, type GuidedTourStep, type RectLike,
} from './model'

const PAD = 6
const CARD_WIDTH = 320
const START_DELAY_MS = 450
const MAX_WAIT_MS = 120_000

function hasForeignDialog() {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
}

function viewport() { return { width: window.innerWidth, height: window.innerHeight } }
function queryRect(selector: string): RectLike | null {
  let element: Element | null = null
  try { element = document.querySelector(selector) } catch { return null }
  if (!(element instanceof HTMLElement) || !element.isConnected) return null
  const style = window.getComputedStyle(element)
  if (style.visibility === 'hidden' || style.display === 'none') return null
  const r = element.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}
function isShowable(step: GuidedTourStep) { return resolveStepRect(step, queryRect, viewport()) !== null }

export function persistGuidedTour(status: GuidedTourStatus) {
  storage.set(storage.KEYS.guidedTour, { status, version: GUIDED_TOUR_VERSION, at: Date.now() })
}

/**
 * Spotlight tour host. Auto-starts once after the first-run wizard (landing on
 * Home first) and on demand via `requestGuidedTour()`.
 */
export function GuidedTourHost({ shellReady }: { shellReady: boolean }) {
  const { t } = useTranslation()
  const nav = useNavigationActions()
  const navRef = useRef(nav); navRef.current = nav
  const [index, setIndex] = useState(-1)
  const [rect, setRect] = useState<RectLike | null | undefined>(undefined)
  const [cardHeight, setCardHeight] = useState(180)
  const direction = useRef<1 | -1>(1)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const autoStarted = useRef(false)
  const titleId = useId(); const bodyId = useId()
  const active = index >= 0
  const steps = GUIDED_TOUR_STEPS

  const begin = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void Promise.resolve(navRef.current.navigate(routes.view.home())).catch(() => undefined)
    // Wait for other first-run dialogs (memory onboarding, what's new) to close.
    let waited = 0
    const attempt = () => {
      if (hasForeignDialog() && waited < MAX_WAIT_MS) { waited += START_DELAY_MS; window.setTimeout(attempt, START_DELAY_MS); return }
      direction.current = 1
      const first = findShowableIndex(steps, 0, 1, isShowable)
      if (first >= 0) setIndex(first)
    }
    window.setTimeout(attempt, START_DELAY_MS)
  }, [steps])

  // Auto-start once per version after the wizard; the shell must be ready.
  useEffect(() => {
    if (!shellReady || autoStarted.current) return
    autoStarted.current = true
    // Automated runs (Playwright/WebDriver) never get an unsolicited overlay.
    if (typeof navigator !== 'undefined' && navigator.webdriver) return
    if (shouldAutoStartGuidedTour(storage.get<unknown>(storage.KEYS.guidedTour, null))) begin()
  }, [shellReady, begin])

  useEffect(() => {
    const onStart = () => { if (shellReady) begin() }
    window.addEventListener(GUIDED_TOUR_START_EVENT, onStart)
    return () => window.removeEventListener(GUIDED_TOUR_START_EVENT, onStart)
  }, [shellReady, begin])

  const finish = useCallback((status: GuidedTourStatus) => {
    persistGuidedTour(status)
    setIndex(-1)
    const restore = returnFocus.current
    if (restore?.isConnected) restore.focus({ preventScroll: true })
  }, [])

  const go = useCallback((dir: 1 | -1) => {
    direction.current = dir
    const next = findShowableIndex(steps, index + dir, dir, isShowable)
    if (next < 0) { if (dir === 1) finish('completed'); return }
    setIndex(next)
  }, [index, steps, finish])

  // Measure the current target; follow layout changes while active.
  useLayoutEffect(() => {
    if (!active) return
    let frame = 0
    const measure = () => {
      const next = resolveStepRect(steps[index]!, queryRect, viewport())
      if (next === null) { go(direction.current); return }
      setRect(prev => (prev && next && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height) ? prev : next)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    measure()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(document.body)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); observer?.disconnect() }
  }, [active, index, steps, go])

  useLayoutEffect(() => {
    if (!active) return
    const h = cardRef.current?.offsetHeight
    if (h && h !== cardHeight) setCardHeight(h)
    primaryRef.current?.focus({ preventScroll: true })
  }, [active, index, cardHeight])

  // Keyboard: Esc skips, ←/→ step, Tab stays inside the card.
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish('skipped') }
      else if (event.key === 'ArrowRight') { event.preventDefault(); go(1) }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1) }
      else if (event.key === 'Tab' && cardRef.current) {
        const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
        if (focusable.length === 0) return
        const first = focusable[0]!; const last = focusable[focusable.length - 1]!
        if (!cardRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus() }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, go, finish])

  if (!active) return null
  const step = steps[index]!
  const vp = viewport()
  const hole = rect ? { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : undefined
  const card = placeCard(hole, { width: Math.min(CARD_WIDTH, vp.width - 24), height: cardHeight }, vp)
  const showable = steps.filter(isShowable)
  const position = Math.max(1, showable.indexOf(step) + 1)
  const hasPrev = findShowableIndex(steps, index - 1, -1, isShowable) >= 0
  const isLast = findShowableIndex(steps, index + 1, 1, isShowable) < 0
  const path = hole
    ? `M0 0H${vp.width}V${vp.height}H0Z M${hole.left} ${hole.top}H${hole.left + hole.width}V${hole.top + hole.height}H${hole.left}Z`
    : `M0 0H${vp.width}V${vp.height}H0Z`

  return createPortal(
    // eslint-disable-next-line rox/prefer-primitives -- spotlight needs an SVG cut-out scrim, which Dialog/Sheet cannot draw
    <div data-guided-tour="" data-step={step.id} className="fixed inset-0 z-popover">
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <path fill="black" fillOpacity={0.55} fillRule="evenodd" d={path} />
        {hole && <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx={10} fill="none" stroke="white" strokeOpacity={0.55} strokeWidth={1.5} className="motion-safe:transition-all" />}
      </svg>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-guided-tour-card=""
        className="absolute rounded-lg border border-border-subtle bg-background p-4 text-sm shadow-modal-small motion-safe:transition-[left,top] motion-safe:duration-200"
        style={{ left: card.left, top: card.top, width: Math.min(CARD_WIDTH, vp.width - 24) }}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-caption text-muted-foreground numeric" aria-live="polite">
            {t('guidedTour.counter', { current: position, total: showable.length })}
          </span>
          <button type="button" onClick={() => finish('skipped')} aria-label={t('guidedTour.close')} className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-ring">
            <X className="icon-toolbar" aria-hidden />
          </button>
        </div>
        <h2 id={titleId} className="text-base font-semibold text-foreground">{t(step.titleKey)}</h2>
        <p id={bodyId} className="mt-1 leading-relaxed text-text-secondary">{t(step.bodyKey)}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={() => finish('skipped')} className="rounded-full px-2 py-1 text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
            {t('guidedTour.skip')}
          </button>
          <div className="flex items-center gap-1.5">
            {hasPrev && (
              <button type="button" onClick={() => go(-1)} className="rounded-full border border-border-subtle px-3 py-1 hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-ring">
                {t('guidedTour.back')}
              </button>
            )}
            <button ref={primaryRef} type="button" onClick={() => go(1)} data-guided-tour-next="" className="rounded-full bg-foreground px-3 py-1 font-medium text-background hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring">
              {isLast ? t('guidedTour.done') : t('guidedTour.next')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

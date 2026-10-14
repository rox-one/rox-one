import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useStore } from 'jotai'
import { focusedPanelRouteAtom } from '@/atoms/panel-stack'
import { useNavigationActions } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import type { Route } from '../../../shared/routes'
import * as storage from '@/lib/local-storage'
import {
  GUIDED_TOUR_START_EVENT, GUIDED_TOUR_STEPS, GUIDED_TOUR_VERSION, findShowableIndex, isUsableRect, placeCard, resolveStepRect,
  shouldAutoStartGuidedTour, type GuidedTourStatus, type GuidedTourStep, type RectLike,
} from './model'
import { consumeGuidedTourFirstRun, setGuidedTourStatus } from './state'

const PAD = 6
const CARD_WIDTH = 320
const START_DELAY_MS = 450
const MAX_WAIT_MS = 120_000
/** A missing target is retried this many times (~50 ms apart) before the step is skipped. */
const MISSING_RETRIES = 10
const RETRY_MS = 50
/** After a step change, keep re-measuring for this long to follow CSS transitions. */
const SETTLE_MS = 600

function hasForeignDialog() {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
}

function viewport() { return { width: window.innerWidth, height: window.innerHeight } }
function queryElement(selector: string): HTMLElement | null {
  let element: Element | null = null
  try { element = document.querySelector(selector) } catch { return null }
  if (!(element instanceof HTMLElement) || !element.isConnected) return null
  const style = window.getComputedStyle(element)
  if (style.visibility === 'hidden' || style.display === 'none') return null
  return element
}
function queryRect(selector: string): RectLike | null {
  const element = queryElement(selector)
  if (!element) return null
  const r = element.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}
function isShowable(step: GuidedTourStep) { return resolveStepRect(step, queryRect, viewport()) !== null }
function resolveStepElement(step: GuidedTourStep): HTMLElement | null {
  const vp = viewport()
  for (const selector of step.selectors) {
    const element = queryElement(selector)
    if (element && isUsableRect(queryRect(selector), vp)) return element
  }
  return null
}
function sameRect(a: RectLike | null | undefined, b: RectLike | null | undefined) {
  if (!a || !b) return a === b
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

export function persistGuidedTour(status: GuidedTourStatus) {
  storage.set(storage.KEYS.guidedTour, { status, version: GUIDED_TOUR_VERSION, at: Date.now() })
}

type BeginReason = 'auto' | 'manual'

/**
 * Spotlight tour host. Auto-starts once per tour version for everyone (after
 * the first-run wizard, or on the next launch for existing users) and on
 * demand via `requestGuidedTour()`. First run lands on Home; otherwise the
 * route the user was on is restored when the tour ends.
 */
export function GuidedTourHost({ shellReady }: { shellReady: boolean }) {
  const { t } = useTranslation()
  const nav = useNavigationActions()
  const store = useStore()
  const navRef = useRef(nav); navRef.current = nav
  const [index, setIndex] = useState(-1)
  const [rect, setRect] = useState<RectLike | null | undefined>(undefined)
  const [showable, setShowable] = useState<readonly GuidedTourStep[]>([])
  const [cardHeight, setCardHeight] = useState(180)
  const direction = useRef<1 | -1>(1)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const restoreRoute = useRef<string | null>(null)
  const startTimer = useRef<number | null>(null)
  const phase = useRef<'idle' | 'pending' | 'running'>('idle')
  const autoStarted = useRef(false)
  const titleId = useId(); const bodyId = useId()
  const active = index >= 0
  const steps = GUIDED_TOUR_STEPS

  const setPhase = useCallback((next: 'idle' | 'pending' | 'running') => {
    phase.current = next
    setGuidedTourStatus(next)
  }, [])
  const clearStartTimer = useCallback(() => {
    if (startTimer.current !== null) { window.clearTimeout(startTimer.current); startTimer.current = null }
  }, [])

  const begin = useCallback((reason: BeginReason) => {
    // Idempotent: ignore while a start is pending or the tour is running.
    if (phase.current !== 'idle') return
    clearStartTimer()
    setPhase('pending')
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const firstRun = consumeGuidedTourFirstRun()
    const current = store.get(focusedPanelRouteAtom)
    const home = routes.view.home()
    // First run lands on Home for good; otherwise come back where the user was.
    restoreRoute.current = !firstRun && reason === 'auto' && current && current !== home ? current : null
    if (firstRun || reason === 'auto') void Promise.resolve(navRef.current.navigate(home)).catch(() => undefined)
    let waited = 0
    let retries = 0
    const attempt = () => {
      startTimer.current = null
      if (phase.current !== 'pending') return
      // Wait for other first-run dialogs (memory onboarding, what's new) to close.
      if (hasForeignDialog()) {
        if (waited >= MAX_WAIT_MS) { restoreRoute.current = null; setPhase('idle'); return } // give up; retry next launch
        waited += START_DELAY_MS
        startTimer.current = window.setTimeout(attempt, START_DELAY_MS)
        return
      }
      direction.current = 1
      const list = steps.filter(isShowable)
      const first = findShowableIndex(steps, 0, 1, isShowable)
      // Home may still be mounting: give targeted steps a moment before starting.
      if ((first < 0 || list.length < 2) && retries < MISSING_RETRIES) {
        retries += 1
        startTimer.current = window.setTimeout(attempt, RETRY_MS)
        return
      }
      if (first < 0) { setPhase('idle'); return }
      setShowable(list)
      setPhase('running')
      setIndex(first)
    }
    startTimer.current = window.setTimeout(attempt, START_DELAY_MS)
  }, [steps, store, clearStartTimer, setPhase])

  useEffect(() => () => {
    clearStartTimer()
    if (phase.current !== 'idle') setGuidedTourStatus('idle')
  }, [clearStartTimer])

  // Auto-start once per version; the shell must be ready.
  useEffect(() => {
    if (!shellReady || autoStarted.current) return
    autoStarted.current = true
    // Automated runs (Playwright/WebDriver) never get an unsolicited overlay.
    if (typeof navigator !== 'undefined' && navigator.webdriver) return
    if (shouldAutoStartGuidedTour(storage.get<unknown>(storage.KEYS.guidedTour, null))) begin('auto')
  }, [shellReady, begin])

  useEffect(() => {
    const onStart = () => { if (shellReady) begin('manual') }
    window.addEventListener(GUIDED_TOUR_START_EVENT, onStart)
    return () => window.removeEventListener(GUIDED_TOUR_START_EVENT, onStart)
  }, [shellReady, begin])

  const finish = useCallback((status: GuidedTourStatus) => {
    persistGuidedTour(status)
    setIndex(-1)
    setRect(undefined)
    setPhase('idle')
    const route = restoreRoute.current
    restoreRoute.current = null
    if (route) void Promise.resolve(navRef.current.navigate(route as Route)).catch(() => undefined)
    const restore = returnFocus.current
    if (restore?.isConnected) restore.focus({ preventScroll: true })
  }, [setPhase])

  const go = useCallback((dir: 1 | -1, from = index) => {
    direction.current = dir
    let next = findShowableIndex(steps, from + dir, dir, isShowable)
    // Nothing showable backwards: move forward instead of sticking on a stale step.
    if (next < 0 && dir === -1) { direction.current = 1; next = findShowableIndex(steps, from + 1, 1, isShowable) }
    if (next < 0) { finish('completed'); return }
    setIndex(next)
  }, [index, steps, finish])

  // Measure the current target; follow layout changes while active.
  useLayoutEffect(() => {
    if (!active) return
    const step = steps[index]!
    let frame = 0
    let retryTimer = 0
    let missing = 0
    let observed: Element[] = []
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule())
    const observeTarget = () => {
      const element = resolveStepElement(step)
      const next = element ? [element, element.offsetParent].filter((e): e is Element => !!e) : []
      if (next.length === observed.length && next.every((e, i) => e === observed[i])) return
      for (const e of observed) observer?.unobserve(e)
      for (const e of next) observer?.observe(e)
      observed = next
    }
    const measure = () => {
      const next = resolveStepRect(step, queryRect, viewport())
      if (next === null) {
        // Transiently missing (route transition, lazy mount): retry before skipping.
        if (missing === 0) setRect(undefined) // don't keep highlighting the previous step's target
        if (missing < MISSING_RETRIES) { missing += 1; retryTimer = window.setTimeout(measure, RETRY_MS); return }
        go(direction.current, index)
        return
      }
      missing = 0
      observeTarget()
      setRect(prev => sameRect(prev, next) ? prev : next)
      setShowable(prev => {
        const list = steps.filter(s => s === step || isShowable(s))
        return list.length === prev.length && list.every((s, i) => s === prev[i]) ? prev : list
      })
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    measure()
    // Follow sidebar/panel/pill CSS transitions that don't resize <body>.
    const settleUntil = performance.now() + SETTLE_MS
    let settleFrame = 0
    const settle = () => { schedule(); if (performance.now() < settleUntil) settleFrame = requestAnimationFrame(settle) }
    settleFrame = requestAnimationFrame(settle)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    document.addEventListener('transitionend', schedule, true)
    document.addEventListener('animationend', schedule, true)
    observer?.observe(document.body)
    return () => {
      cancelAnimationFrame(frame); cancelAnimationFrame(settleFrame); window.clearTimeout(retryTimer)
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true)
      document.removeEventListener('transitionend', schedule, true); document.removeEventListener('animationend', schedule, true)
      observer?.disconnect()
    }
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
  // Derived from the list computed in measure() — no DOM reads during render.
  const position = Math.max(1, showable.indexOf(step) + 1)
  const total = Math.max(position, showable.length)
  const hasPrev = showable.indexOf(step) > 0
  const isLast = showable.indexOf(step) === showable.length - 1 || showable.indexOf(step) < 0
  const path = hole
    ? `M0 0H${vp.width}V${vp.height}H0Z M${hole.left} ${hole.top}H${hole.left + hole.width}V${hole.top + hole.height}H${hole.left}Z`
    : `M0 0H${vp.width}V${vp.height}H0Z`

  return createPortal(
    // eslint-disable-next-line rox/prefer-primitives -- spotlight needs an SVG cut-out scrim, which Dialog/Sheet cannot draw
    <div data-guided-tour="" data-step={step.id} className="fixed inset-0 z-popover titlebar-no-drag">
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <path className="fill-black/55 dark:fill-black/70" fillRule="evenodd" d={path} />
        {hole && <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx={10} fill="none" strokeWidth={1.5} className="stroke-white/60 motion-safe:transition-all" />}
      </svg>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-guided-tour-card=""
        className="titlebar-no-drag absolute rounded-lg border border-border-subtle bg-background p-4 text-sm shadow-modal-small motion-safe:transition-[left,top] motion-safe:duration-200"
        style={{ left: card.left, top: card.top, width: Math.min(CARD_WIDTH, vp.width - 24) }}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-caption text-muted-foreground numeric" aria-live="polite">
            {t('guidedTour.counter', { current: position, total })}
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

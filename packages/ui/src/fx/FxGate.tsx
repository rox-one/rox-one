/**
 * FxGate — the single entry point for decorative libraries.dev effects.
 *
 * Renders `fallback` (static, no motion) when:
 *   - the «Анимации» setting is «Выключен», or capability/budget is missing
 *     (no WebGL2 for kind="webgl", concurrency slot taken);
 * and renders `children({ paused: true })` — a frozen frame — when:
 *   - the setting is «Упрощённые», OS reduced motion, low-power profile,
 *     battery saver, hidden window, or the effect is scrolled off-screen.
 *
 * Children must be a lazily-loaded effect (React.lazy + dynamic import) so the
 * effect never lands in the initial chunk; Suspense shows `fallback` while it
 * loads.
 */
import * as React from 'react'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useFxLevel } from './fx-level'
import { hasWebGL2, useBatterySaver, useDocumentVisible, useFxReducedMotion } from './fx-env'
import { acquireFxSlot, onFxSlotFreed, releaseFxSlot, type FxKind } from './fx-budget'

export interface FxRenderState {
  /** Freeze animation (static frame). */
  paused: boolean
}

export interface FxGateProps {
  kind: FxKind
  fallback: React.ReactNode
  children: (state: FxRenderState) => React.ReactNode
  className?: string
}

export type FxMode = 'fallback' | 'static' | 'live'

export interface FxModeInputs {
  level: 'full' | 'reduced' | 'off'
  kind: FxKind
  reducedMotion: boolean
  batterySaver: boolean
  visible: boolean
  onScreen: boolean
  webgl2: boolean
  hasSlot: boolean
}

/** Pure decision table, exported for tests. */
export function resolveFxMode(i: FxModeInputs): FxMode {
  if (i.level === 'off') return 'fallback'
  if (i.kind === 'webgl' && !i.webgl2) return 'fallback'
  if (!i.hasSlot) return 'fallback'
  if (i.level === 'reduced' || i.reducedMotion || i.batterySaver || !i.visible || !i.onScreen) return 'static'
  return 'live'
}

function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1]
      if (e) setOnScreen(e.isIntersecting)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return onScreen
}

export function FxGate({ kind, fallback, children, className }: FxGateProps) {
  const level = useFxLevel()
  const reducedMotion = useFxReducedMotion()
  const batterySaver = useBatterySaver()
  const visible = useDocumentVisible()
  const ref = useRef<HTMLSpanElement>(null)
  const onScreen = useOnScreen(ref)
  const [id] = useState(() => Symbol('fx'))
  const wantsSlot = level !== 'off' && (kind !== 'webgl' || hasWebGL2())
  const [hasSlot, setHasSlot] = useState(false)

  useEffect(() => {
    if (!wantsSlot) return
    const tryAcquire = () => setHasSlot(acquireFxSlot(kind, id))
    tryAcquire()
    const off = onFxSlotFreed(tryAcquire)
    return () => {
      off()
      releaseFxSlot(kind, id)
      setHasSlot(false)
    }
  }, [kind, id, wantsSlot])

  const mode = resolveFxMode({
    level,
    kind,
    reducedMotion,
    batterySaver,
    visible,
    onScreen,
    webgl2: kind !== 'webgl' || hasWebGL2(),
    hasSlot: wantsSlot && hasSlot,
  })

  return (
    <span ref={ref} className={className} data-fx-kind={kind} data-fx-mode={mode} style={{ display: 'inline-flex' }}>
      {mode === 'fallback'
        ? fallback
        : <Suspense fallback={fallback}>{children({ paused: mode === 'static' })}</Suspense>}
    </span>
  )
}

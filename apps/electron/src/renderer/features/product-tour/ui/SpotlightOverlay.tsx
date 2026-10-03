import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { SafeReason, TourBinding, TourStep, TourTargetRegistration } from '../contracts'
import { useModalRegistry } from '../../../context/ModalContext'
import { useDismissibleLayerRegistry } from '../../../context/DismissibleLayerContext'
import { measureTargetGeometry, type TargetGeometry } from './geometry'
import { observeTargetGeometry } from './geometry-observer'
import { TourPopover } from './TourPopover'

export interface SpotlightOverlayProps {
  readonly target: TourTargetRegistration
  readonly step: TourStep
  readonly binding: TourBinding
  readonly open?: boolean
  readonly onPause: (reason: SafeReason) => void
  readonly onNext?: () => void
  readonly onBack?: () => void
  readonly onSkip?: () => void
  readonly onDismiss?: () => void
  readonly onHandoffChange?: (open: boolean) => void
  readonly canNext?: boolean
  readonly returnFocus?: HTMLElement | null
}

function sameGeometry(a: TargetGeometry | null, b: TargetGeometry | null) {
  return a === b || (a !== null && b !== null && a.rect.left === b.rect.left && a.rect.top === b.rect.top && a.rect.width === b.rect.width && a.rect.height === b.rect.height
    && a.spotlightRect.left === b.spotlightRect.left && a.spotlightRect.top === b.spotlightRect.top && a.spotlightRect.width === b.spotlightRect.width && a.spotlightRect.height === b.spotlightRect.height
    && a.viewport.width === b.viewport.width && a.viewport.height === b.viewport.height)
}

/** Decorative mask and interactive non-modal popup share one portal and the existing close registries. */
export function SpotlightOverlay({ target, step, binding, open = true, onPause, onNext, onBack, onSkip, onDismiss, onHandoffChange, canNext, returnFocus }: SpotlightOverlayProps) {
  const modals = useModalRegistry()
  const layers = useDismissibleLayerRegistry()
  const modalSnapshot = useSyncExternalStore(modals.subscribe, modals.getSnapshot, modals.getSnapshot)
  const layerSnapshot = useSyncExternalStore(layers.subscribe, layers.getSnapshot, layers.getSnapshot)
  const layerId = `product-tour-${binding.runToken}`
  const hasBlocker = useCallback(() => modals.getSnapshot().some((layer) => layer.id !== layerId)
    || layers.getSnapshot().some((layer) => layer.id !== layerId), [modals, layers, layerId])
  const handedOff = modalSnapshot.some((layer) => layer.id !== layerId) || layerSnapshot.some((layer) => layer.id !== layerId)
  const active = open && !handedOff
  const [geometry, setGeometry] = useState<TargetGeometry | null>(() => measureTargetGeometry(target.element))
  const popupRef = useRef<HTMLDivElement | null>(null)
  const callbacks = useRef({ onPause, onHandoffChange })
  callbacks.current = { onPause, onHandoffChange }

  useEffect(() => {
    if (!open) return
    const close = () => callbacks.current.onPause('user-paused')
    const unregisterModal = modals.registerModal(layerId, close, -1000)
    const unregisterLayer = layers.registerLayer({ id: layerId, type: 'custom', priority: -1000, close })
    return () => { unregisterLayer(); unregisterModal() }
  }, [open, modals, layers, layerId])

  useEffect(() => { if (open) callbacks.current.onHandoffChange?.(handedOff) }, [open, handedOff])

  useLayoutEffect(() => {
    if (!active) return
    const measured = measureTargetGeometry(target.element)
    setGeometry((current) => sameGeometry(current, measured) ? current : measured)
    return observeTargetGeometry(target.element, (next) => setGeometry((current) => sameGeometry(current, next) ? current : next))
  }, [active, target.element])

  useEffect(() => {
    if (active && !geometry) callbacks.current.onPause('target-occluded')
  }, [active, geometry])

  useLayoutEffect(() => {
    if (!open) return
    const document = target.element.ownerDocument
    const prior = document.activeElement as HTMLElement | null
    return () => {
      // Native handoff and ordinary outside clicks retain their own focus.
      if (hasBlocker() || !popupRef.current?.contains(document.activeElement)) return
      const restore = prior?.isConnected ? prior : returnFocus?.isConnected ? returnFocus : null
      restore?.focus({ preventScroll: true })
    }
  }, [open, binding.runToken, hasBlocker, target.element, returnFocus])

  useEffect(() => {
    if (!active) return
    const document = target.element.ownerDocument
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as Node | null
      if (!node || target.element.contains(node) || popupRef.current?.contains(node) || hasBlocker()) return
      // Observe without cancelling: the normal application click still runs.
      callbacks.current.onPause('focus-lost')
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [active, target.element, hasBlocker])

  if (!active || !geometry) return null
  const hole = geometry.spotlightRect
  return (
    <Popover.Root open modal={false}>
      <Popover.Portal>
        <div data-product-tour-portal="" className="contents">
        <div className="fixed inset-0 z-dropdown pointer-events-none" aria-hidden="true" data-product-tour-overlay="">
          <svg className="h-full w-full" data-product-tour-mask="" aria-hidden="true">
            <path fill="black" fillOpacity="0.4" fillRule="evenodd" d={`M0 0H${geometry.viewport.width}V${geometry.viewport.height}H0Z M${hole.left} ${hole.top}H${hole.right}V${hole.bottom}H${hole.left}Z`} />
            <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx={8} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
          </svg>
        </div>
        <TourPopover ref={popupRef} target={target} step={step} binding={binding} geometry={geometry} onPause={() => onPause('user-paused')} onNext={onNext} onBack={onBack} onSkip={onSkip} onDismiss={onDismiss} canNext={canNext} />
        </div>
      </Popover.Portal>
    </Popover.Root>
  )
}

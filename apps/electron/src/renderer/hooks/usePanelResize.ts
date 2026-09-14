/**
 * Pointer-capture resize hook (ZS-05).
 *
 * Primary pointer only. pointerup commits; cancel/Escape/blur/unmount restore.
 * lostpointercapture after a normal release is not a second cancel.
 */

import * as React from 'react'

import { createLayoutCommitDebouncer, SHELL_LAYOUT_KEYBOARD_DEBOUNCE_MS } from '@/lib/shell-layout-preferences'
import { createResizeController, type ResizeBounds, type ResizeController } from '@/components/app-shell/resize-controller'
import type { PanelResizeAxis } from '@/lib/panel-workspace-layout'

export interface UsePanelResizeHandlers {
  onPreview: (sizeA: number, sizeB: number) => void
  onCommit: (sizeA: number, sizeB: number) => void
  onCancel: (sizeA: number, sizeB: number) => void
}

export function usePanelResize(handlers: UsePanelResizeHandlers, axis: PanelResizeAxis = 'x') {
  const handlersRef = React.useRef(handlers)
  handlersRef.current = handlers
  const controllerRef = React.useRef<ResizeController | null>(null)
  const originRef = React.useRef(0)
  const captureRef = React.useRef<{ element: HTMLElement; pointerId: number } | null>(null)
  const releasedNormallyRef = React.useRef(false)
  const previousBodyRef = React.useRef<{ cursor: string; userSelect: string }>({ cursor: '', userSelect: '' })
  const ownsBodyStylesRef = React.useRef(false)
  const [dragging, setDragging] = React.useState(false)

  const keyboardCommit = React.useMemo(
    () => createLayoutCommitDebouncer(() => {
      controllerRef.current?.commit()
    }, SHELL_LAYOUT_KEYBOARD_DEBOUNCE_MS),
    [],
  )

  const restoreBody = React.useCallback(() => {
    if (!ownsBodyStylesRef.current) return
    ownsBodyStylesRef.current = false
    document.body.style.cursor = previousBodyRef.current.cursor
    document.body.style.userSelect = previousBodyRef.current.userSelect
  }, [])

  const stopCapture = React.useCallback(() => {
    const capture = captureRef.current
    captureRef.current = null
    if (!capture) return
    try {
      if (capture.element.hasPointerCapture(capture.pointerId)) {
        capture.element.releasePointerCapture(capture.pointerId)
      }
    } catch { /* Element may have been removed during a panel close. */ }
  }, [])

  const ensureController = React.useCallback(() => {
    if (controllerRef.current) return controllerRef.current
    controllerRef.current = createResizeController({
      onPreview: (a, b) => handlersRef.current.onPreview(a, b),
      onCommit: (a, b) => {
        setDragging(false)
        restoreBody()
        stopCapture()
        handlersRef.current.onCommit(a, b)
      },
      onCancel: (a, b) => {
        setDragging(false)
        restoreBody()
        stopCapture()
        handlersRef.current.onCancel(a, b)
      },
    })
    return controllerRef.current
  }, [restoreBody, stopCapture])

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>, bounds: ResizeBounds | null) => {
    if (event.button !== 0 || event.isPrimary === false || !bounds) return
    const controller = ensureController()
    keyboardCommit.cancel()
    if (controller.active) controller.commit()
    if (!controller.start(bounds)) return
    originRef.current = axis === 'x' ? event.clientX : event.clientY
    releasedNormallyRef.current = false
    previousBodyRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    ownsBodyStylesRef.current = true
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    setDragging(true)
    captureRef.current = { element: event.currentTarget, pointerId: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [axis, ensureController, keyboardCommit])

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    const controller = controllerRef.current
    if (!controller?.active || !controller.snapshot) return
    if (captureRef.current?.pointerId !== event.pointerId) return
    const coordinate = axis === 'x' ? event.clientX : event.clientY
    controller.moveTo(controller.snapshot.sizeA + coordinate - originRef.current)
  }, [axis])

  const handlePointerUp = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    const controller = controllerRef.current
    if (!controller?.active) return
    if (captureRef.current?.pointerId !== event.pointerId) return
    releasedNormallyRef.current = true
    stopCapture()
    controller.commit()
  }, [stopCapture])

  const handlePointerCancel = React.useCallback(() => {
    controllerRef.current?.cancel()
  }, [])

  const handleLostPointerCapture = React.useCallback(() => {
    if (releasedNormallyRef.current) return
    controllerRef.current?.cancel()
  }, [])

  const handleKeyAdjust = React.useCallback((delta: number, bounds: ResizeBounds | null) => {
    if (!bounds) return
    const controller = ensureController()
    if (!controller.active) {
      if (!controller.start(bounds)) return
      setDragging(true)
    }
    controller.moveBy(delta, true)
    keyboardCommit.schedule()
  }, [ensureController, keyboardCommit])

  const handleKeyCommit = React.useCallback(() => {
    if (captureRef.current) return
    keyboardCommit.cancel()
    controllerRef.current?.commit()
  }, [keyboardCommit])

  const handleKeyCancel = React.useCallback(() => {
    keyboardCommit.cancel()
    controllerRef.current?.cancel()
  }, [keyboardCommit])

  const handleReset = React.useCallback((bounds: ResizeBounds | null, sizeA: number) => {
    if (!bounds) return
    const controller = ensureController()
    if (!controller.start({ ...bounds, sizeA })) return
    controller.commit()
  }, [ensureController])

  const neighborChanged = React.useCallback((leftId: string, rightId: string) => {
    controllerRef.current?.neighborChanged(leftId, rightId)
  }, [])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !controllerRef.current?.active) return
      event.preventDefault()
      event.stopPropagation()
      keyboardCommit.cancel()
      controllerRef.current.cancel()
    }
    const onBlur = () => {
      if (controllerRef.current?.active) controllerRef.current.cancel()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [keyboardCommit])

  React.useEffect(() => () => {
    keyboardCommit.cancel()
    controllerRef.current?.dispose()
    restoreBody()
  }, [keyboardCommit, restoreBody])

  return {
    dragging,
    controller: controllerRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleLostPointerCapture,
    handleKeyAdjust,
    handleKeyCommit,
    handleKeyCancel,
    handleReset,
    neighborChanged,
  }
}

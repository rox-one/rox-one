/**
 * Shared sash primitive (ZS-05): 12px hit / 2px line, 24px on coarse pointers.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { useResizeGradient } from '@/hooks/useResizeGradient'
import { useHorizontalResizeGradient } from '@/hooks/useHorizontalResizeGradient'
import {
  PANEL_SASH_HIT_WIDTH,
  PANEL_SASH_HIT_WIDTH_COARSE,
  PANEL_SASH_LINE_WIDTH,
} from './panel-constants'
import { KEYBOARD_RESIZE_LARGE_STEP, KEYBOARD_RESIZE_STEP } from './resize-math'

export interface ResizeHandleProps {
  orientation?: 'vertical' | 'horizontal'
  labelKey: 'shell.resize.sidebar' | 'shell.resize.navigator' | 'shell.resize.panels'
  controlsId?: string
  valueNow: number
  valueMin: number
  valueMax: number
  dragging?: boolean
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove?: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp?: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerCancel?: (event: React.PointerEvent<HTMLDivElement>) => void
  onLostPointerCapture?: (event: React.PointerEvent<HTMLDivElement>) => void
  onKeyAdjust?: (delta: number) => void
  onKeyCommit?: () => void
  onKeyCancel?: () => void
  onReset?: () => void
}

export function sashHitWidthPx(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return PANEL_SASH_HIT_WIDTH
  }
  return window.matchMedia('(pointer: coarse)').matches
    ? PANEL_SASH_HIT_WIDTH_COARSE
    : PANEL_SASH_HIT_WIDTH
}

export function ResizeHandle({
  orientation = 'vertical',
  labelKey,
  controlsId,
  valueNow,
  valueMin,
  valueMax,
  dragging = false,
  disabled = false,
  className,
  style,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyAdjust,
  onKeyCommit,
  onKeyCancel,
  onReset,
  ...rest
}: ResizeHandleProps & React.HTMLAttributes<HTMLDivElement>) {
  const { t } = useTranslation()
  const vertical = orientation === 'vertical'
  const verticalGradient = useResizeGradient()
  const horizontalGradient = useHorizontalResizeGradient()
  const { ref, handlers, gradientStyle } = vertical ? verticalGradient : horizontalGradient
  const hit = sashHitWidthPx()
  const label = t(labelKey)
  const valueText = t('shell.resize.valuePx', { value: Math.round(valueNow) })

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const step = event.shiftKey ? KEYBOARD_RESIZE_LARGE_STEP : KEYBOARD_RESIZE_STEP
    if (event.key === (vertical ? 'ArrowLeft' : 'ArrowUp')) {
      event.preventDefault()
      onKeyAdjust?.(-step)
      return
    }
    if (event.key === (vertical ? 'ArrowRight' : 'ArrowDown')) {
      event.preventDefault()
      onKeyAdjust?.(step)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onKeyAdjust?.(valueMin - valueNow)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      onKeyAdjust?.(valueMax - valueNow)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onKeyCommit?.()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onKeyCancel?.()
      return
    }
  }

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-controls={controlsId}
      aria-valuemin={Math.round(valueMin)}
      aria-valuemax={Math.round(valueMax)}
      aria-valuenow={Math.round(valueNow)}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      {...rest}
      className={cn(
        'z-panel flex justify-center outline-none',
        vertical ? 'cursor-col-resize items-stretch' : 'cursor-row-resize items-center',
        'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
        dragging && 'shell-sash-active',
        className,
      )}
      style={{ ...(vertical ? { width: hit } : { height: hit, width: '100%' }), touchAction: 'none', ...style }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return
        handlers.onMouseDown()
        onPointerDown?.(event)
      }}
      onPointerMove={(event) => {
        handlers.onMouseMove(event as unknown as React.MouseEvent<HTMLDivElement>)
        onPointerMove?.(event)
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onPointerLeave={handlers.onMouseLeave}
      onDoubleClick={() => { if (!disabled) onReset?.() }}
      onKeyDown={handleKeyDown}
      onBlur={() => { if (document.hasFocus()) onKeyCommit?.() }}
    >
      <div
        className="h-full"
        style={{
          width: vertical ? PANEL_SASH_LINE_WIDTH : '100%',
          height: vertical ? undefined : PANEL_SASH_LINE_WIDTH,
          ...(dragging
            ? { background: 'var(--shell-sash, color-mix(in oklch, var(--foreground) 36%, transparent))' }
            : gradientStyle),
        }}
      />
    </div>
  )
}

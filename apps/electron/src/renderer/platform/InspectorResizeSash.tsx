import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { usePanelResize } from '@/hooks/usePanelResize'
import { cn } from '@/lib/utils'
import {
  INSPECTOR_DEFAULT_WIDTH,
  inspectorResizeBounds,
  inspectorResizeWidthForKey,
  inspectorWidthLimits,
  normalizeInspectorWidth,
} from './inspector-model'

/** Shared resize controller keeps previews transient and owns pointer cleanup. */
export function InspectorResizeSash({
  width,
  viewportWidth,
  controlsId,
  active,
  onPreview,
  onCommit,
  onCancel,
}: {
  width: number
  viewportWidth: number
  controlsId: string
  active: boolean
  onPreview: (width: number) => void
  onCommit: (width: number) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const limits = inspectorWidthLimits(viewportWidth)
  const resize = usePanelResize({
    onPreview: (_left, right) => onPreview(right),
    onCommit: (_left, right) => onCommit(right),
    onCancel,
  })
  const bounds = inspectorResizeBounds(width, viewportWidth)

  // Retained panels remain mounted while hidden, so cancel their resize explicitly.
  useEffect(() => {
    resize.handleKeyCancel()
  }, [active, viewportWidth, resize.handleKeyCancel])

  return (
    <div
      role="separator"
      aria-label={t('inspector.resize')}
      aria-controls={controlsId}
      aria-orientation="vertical"
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={Math.round(width)}
      aria-valuetext={t('shell.resize.valuePx', { value: Math.round(width) })}
      tabIndex={active ? 0 : -1}
      className={cn(
        'group absolute inset-y-0 left-0 z-panel flex w-3 touch-none cursor-col-resize items-stretch justify-start outline-none [@media(pointer:coarse)]:w-6',
        'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
        resize.dragging && 'shell-sash-active',
      )}
      onPointerDown={(event) => { if (active) resize.handlePointerDown(event, bounds) }}
      onPointerMove={resize.handlePointerMove}
      onPointerUp={resize.handlePointerUp}
      onPointerCancel={resize.handlePointerCancel}
      onLostPointerCapture={resize.handleLostPointerCapture}
      onDoubleClick={() => {
        if (active) resize.handleReset(bounds, viewportWidth - normalizeInspectorWidth(INSPECTOR_DEFAULT_WIDTH, viewportWidth))
      }}
      onBlur={() => { if (document.hasFocus()) resize.handleKeyCommit() }}
      onKeyDown={(event) => {
        if (!active) return
        const next = inspectorResizeWidthForKey(event.key, event.shiftKey, width, viewportWidth)
        if (next !== null) {
          event.preventDefault()
          resize.handleKeyAdjust(width - next, bounds)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          resize.handleKeyCommit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          resize.handleKeyCancel()
        }
      }}
    >
      <span className={cn('w-0.5 transition-colors group-hover:bg-foreground/15 group-focus-visible:bg-ring', resize.dragging && 'bg-foreground/30')} />
    </div>
  )
}


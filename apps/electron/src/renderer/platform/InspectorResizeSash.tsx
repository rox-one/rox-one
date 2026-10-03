import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { usePanelResize } from '@/hooks/usePanelResize'
import { SIDE_PANEL_DEFAULT_WIDTH } from '@/lib/shell-layout-preferences'
import { cn } from '@/lib/utils'
import { inspectorResizeBounds, inspectorResizeWidthForKey } from './inspector-resize'

/** Golden Gate interaction recovery, with current InspectorHost layout limits. */
export function InspectorResizeSash({ width, viewportWidth, maxWidth, controlsId, active, onPreview, onCommit, onCancel }: {
  width: number; viewportWidth: number; maxWidth: number; controlsId: string; active: boolean
  onPreview: (width: number) => void; onCommit: (width: number) => void; onCancel: () => void
}) {
  const { t } = useTranslation()
  const resize = usePanelResize({ onPreview: (_left, right) => onPreview(right), onCommit: (_left, right) => onCommit(right), onCancel })
  const bounds = inspectorResizeBounds(width, viewportWidth, maxWidth)
  const gestureViewport = useRef(viewportWidth)
  useLayoutEffect(() => { resize.handleKeyCancel() }, [active, viewportWidth, maxWidth, resize.handleKeyCancel])
  useLayoutEffect(() => {
    // Native viewport changes can precede React's next render and pointerup.
    const cancel = () => resize.handleKeyCancel()
    window.addEventListener('resize', cancel)
    return () => window.removeEventListener('resize', cancel)
  }, [resize.handleKeyCancel])
  return <div role="separator" aria-label={t('inspector.resize')} aria-controls={controlsId}
    aria-orientation="vertical" aria-valuemin={280} aria-valuemax={maxWidth} aria-valuenow={Math.round(width)}
    aria-valuetext={t('shell.resize.valuePx', { value: Math.round(width) })} tabIndex={active ? 0 : -1}
    className={cn('group absolute inset-y-0 left-0 z-10 flex w-1.5 touch-none cursor-col-resize items-stretch outline-none [@media(pointer:coarse)]:w-3',
      'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring', resize.dragging && 'shell-sash-active')}
    onPointerDown={event => {
      if (active) { gestureViewport.current = window.innerWidth; resize.handlePointerDown(event, bounds) }
    }}
    onPointerMove={resize.handlePointerMove} onPointerUp={event => {
      if (window.innerWidth !== gestureViewport.current) resize.handleKeyCancel()
      else resize.handlePointerUp(event)
    }}
    onPointerCancel={resize.handlePointerCancel} onLostPointerCapture={resize.handleLostPointerCapture}
    onDoubleClick={() => { if (active) resize.handleReset(bounds, bounds.total - Math.min(maxWidth, SIDE_PANEL_DEFAULT_WIDTH)) }}
    onBlur={() => { if (document.hasFocus()) resize.handleKeyCommit() }}
    onKeyDown={event => {
      if (!active || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      const next = inspectorResizeWidthForKey(event.key, event.shiftKey, width, maxWidth)
      if (next !== null) { event.preventDefault(); resize.handleKeyAdjust(width - next, bounds) }
      else if (event.key === 'Enter') { event.preventDefault(); resize.handleKeyCommit() }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); resize.handleKeyCancel() }
    }}>
    <span className={cn('w-0.5 transition-colors group-hover:bg-foreground/15 group-focus-visible:bg-ring', resize.dragging && 'bg-foreground/30')} />
  </div>
}

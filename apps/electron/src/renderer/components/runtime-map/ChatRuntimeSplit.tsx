import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2, RotateCcw } from 'lucide-react'
import { clampChatRatio, splitStorageKey } from './layout/viewport-policy'
import './runtime-map.css'

export interface ChatRuntimeSplitProps {
  chat: React.ReactNode
  map?: React.ReactNode
  open: boolean
  scopeKey: string
  onRequestExpand?: () => void
  onCloseMap?: () => void
}

class RuntimeMapBoundary extends React.Component<{ children: React.ReactNode; fallback: (retry: () => void) => React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children
  }
}

/** The chat is always the same first child; only its adjacent map mounts/unmounts. */
export function ChatRuntimeSplit({ chat, map, open, scopeKey, onRequestExpand, onCloseMap }: ChatRuntimeSplitProps) {
  const { t } = useTranslation()
  const container = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(1000)
  const [ratio, setRatio] = React.useState(0.42)
  const dragging = React.useRef(false)
  React.useEffect(() => {
    try { const saved = Number(localStorage.getItem(splitStorageKey(scopeKey))); setRatio(saved > 0 ? saved : 0.42) } catch { setRatio(0.42) }
  }, [scopeKey])
  React.useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(entries => { const size = entries[0]?.contentRect.width; if (size) setWidth(size) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const changeRatio = React.useCallback((value: number) => {
    const next = clampChatRatio(value, width)
    setRatio(next)
    try { localStorage.setItem(splitStorageKey(scopeKey), String(next)) } catch { /* Optional viewport preference. */ }
  }, [scopeKey, width])
  const actualRatio = clampChatRatio(ratio, width)
  const compact = open && width < 720
  return (
    <div ref={container} className="runtime-split" data-testid="chat-runtime-split" data-map-open={open}>
      <div className="runtime-chat-slot" data-testid="runtime-chat-slot" style={{ flexBasis: open ? `${actualRatio * 100}%` : '100%', flexGrow: open ? 0 : 1, minWidth: open ? 360 : 0 }}>{chat}</div>
      {open && <>
        <div
          className="runtime-split-handle" role="separator" tabIndex={0} aria-orientation="vertical"
          aria-label={t('runtimeMap.resize')} aria-valuemin={Math.round(360 / Math.max(720, width) * 100)} aria-valuemax={Math.round((1 - 360 / Math.max(720, width)) * 100)} aria-valuenow={Math.round(actualRatio * 100)}
          onPointerDown={event => { if (event.button !== 0) return; dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
          onPointerMove={event => { if (dragging.current && container.current) changeRatio((event.clientX - container.current.getBoundingClientRect().left) / width) }}
          onPointerUp={event => { dragging.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
          onPointerCancel={() => { dragging.current = false }}
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { changeRatio(actualRatio + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 32 : 8) / width); event.preventDefault() } if (event.key === 'Home') { changeRatio(0.42); event.preventDefault() } }}
        />
        <div className="runtime-map-slot" data-testid="runtime-map-slot">
          {compact && <div className="runtime-narrow-notice"><Maximize2 size={14} /><span>{t('runtimeMap.narrow')}</span>{onRequestExpand && <button type="button" onClick={onRequestExpand}>{t('runtimeMap.expand')}</button>}</div>}
          <RuntimeMapBoundary key={scopeKey} fallback={retry => <div className="runtime-empty" role="alert"><p>{t('runtimeMap.renderError')}</p><button type="button" onClick={retry}><RotateCcw size={14} />{t('runtimeMap.retry')}</button>{onCloseMap && <button type="button" onClick={onCloseMap}>{t('runtimeMap.close')}</button>}</div>}>{map}</RuntimeMapBoundary>
        </div>
      </>}
    </div>
  )
}

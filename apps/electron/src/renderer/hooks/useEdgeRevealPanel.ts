import { useCallback, useEffect, useRef } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  inspectorEdgeHoverActiveAtom,
  inspectorEdgeRevealModeAtom,
  resolveInspectorEdgeReveal,
  type InspectorEdgeRevealMode,
} from '@/atoms/panel-auto-hide'
import { inspectorUserOpenedAtom, inspectorVisibleAtom } from '@/atoms/unified-shell'

const EDGE_ZONE_PX = 8
const HOVER_DELAY_MS = 250

export function useEdgeRevealPanel(enabled: boolean) {
  const active = enabled
  const [mode, setMode] = useAtom(inspectorEdgeRevealModeAtom)
  const [hoverActive, setHoverActive] = useAtom(inspectorEdgeHoverActiveAtom)
  const [visible, setVisible] = useAtom(inspectorVisibleAtom)
  const setUserOpened = useSetAtom(inspectorUserOpenedAtom)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resolved = resolveInspectorEdgeReveal({
    mode,
    hoverActive,
    userOpened: visible,
    visible,
  })

  useEffect(() => {
    if (!active) return
    if (resolved.effectiveVisible && !visible) {
      setVisible(true)
      setUserOpened(true)
    }
    if (!resolved.effectiveVisible && visible && mode === 'hidden' && !hoverActive) {
      setVisible(false)
      setUserOpened(false)
    }
  }, [active, hoverActive, mode, resolved.effectiveVisible, setUserOpened, setVisible, visible])

  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }, [])

  const onEdgePointerEnter = useCallback(() => {
    if (!active || mode === 'pinned') return
    clearHoverTimer()
    hoverTimer.current = setTimeout(() => {
      setMode('hover')
      setHoverActive(true)
    }, HOVER_DELAY_MS)
  }, [active, clearHoverTimer, mode, setHoverActive, setMode])

  const onEdgePointerLeave = useCallback(() => {
    if (!active || mode === 'pinned') return
    clearHoverTimer()
    setHoverActive(false)
    if (mode === 'hover') setMode('hidden')
  }, [active, clearHoverTimer, mode, setHoverActive, setMode])

  const pinInspector = useCallback(() => {
    if (!active) return
    clearHoverTimer()
    setMode('pinned')
    setHoverActive(false)
    setVisible(true)
    setUserOpened(true)
  }, [active, clearHoverTimer, setHoverActive, setMode, setUserOpened, setVisible])

  const hideInspector = useCallback(() => {
    if (!active) return
    clearHoverTimer()
    setMode('hidden')
    setHoverActive(false)
    setVisible(false)
    setUserOpened(false)
  }, [active, clearHoverTimer, setHoverActive, setMode, setUserOpened, setVisible])

  return {
    edgeZonePx: EDGE_ZONE_PX,
    mode: mode as InspectorEdgeRevealMode,
    hoverActive,
    peeking: resolved.peeking,
    onEdgePointerEnter,
    onEdgePointerLeave,
    pinInspector,
    hideInspector,
  }
}

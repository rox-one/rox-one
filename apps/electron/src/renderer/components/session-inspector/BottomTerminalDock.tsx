import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { ChevronsDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import {
  focusedPanelRouteAtom,
  parseSessionIdFromRoute,
} from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { bottomDockHeightAtom, bottomTerminalOpenAtom } from '@/atoms/unified-shell'
import { InspectorTerminal } from './InspectorTerminal'
import { ResizeHandle, sashHitWidthPx } from '../app-shell/ResizeHandle'

const MIN_HEIGHT = 88
const MAX_HEIGHT = 480

export function BottomTerminalDock() {
  const { t } = useTranslation()
  const [open, setOpen] = useAtom(bottomTerminalOpenAtom)
  const [height, setHeight] = useAtom(bottomDockHeightAtom)
  const route = useAtomValue(focusedPanelRouteAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionId = route ? parseSessionIdFromRoute(route) : null
  const cwd = sessionId ? sessionMetaMap.get(sessionId)?.workingDirectory : undefined
  const drag = React.useRef<{ startY: number; startH: number } | null>(null)
  const keyboardStart = React.useRef(height)
  const maxHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(window.innerHeight * 0.30)))
  const clamp = (value: number) => Math.min(maxHeight, Math.max(MIN_HEIGHT, value))
  const sashHeight = sashHitWidthPx()
  // Focus the command input only after an explicit open (not on restore at launch).
  const wasOpenRef = React.useRef(open)
  const [focusOnOpen, setFocusOnOpen] = React.useState(false)
  React.useEffect(() => {
    if (open && !wasOpenRef.current) setFocusOnOpen(true)
    wasOpenRef.current = open
  }, [open])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    drag.current = { startY: event.clientY, startH: height }
    const move = (e: PointerEvent) => {
      const state = drag.current
      if (!state) return
      const next = clamp(state.startH + (state.startY - e.clientY))
      setHeight(next)
    }
    const up = (e: PointerEvent) => {
      if (e.type === 'pointercancel' && drag.current) setHeight(drag.current.startH)
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  // Collapsed: no permanent strip. The single entry point is the top-bar
  // terminal button (data-testid="bottom-terminal-toggle").
  if (!open) return null

  return (
    <div
      className="rox-shell-pane rox-shell-divider-t relative flex shrink-0 flex-col pointer-events-auto"
      style={{ height }}
      data-bottom-terminal="true"
      data-shell-role="content"
    >
      <ResizeHandle
        orientation="horizontal"
        reverseArrowKeys
        labelKey="shell.resize.terminal"
        valueNow={height}
        valueMin={MIN_HEIGHT}
        valueMax={maxHeight}
        style={{ position: 'absolute', top: -sashHeight / 2, left: 0, width: '100%', height: sashHeight }}
        onPointerDown={onPointerDown}
        onFocus={() => { keyboardStart.current = height }}
        onKeyAdjust={delta => setHeight(current => clamp(current + delta))}
        onKeyCommit={() => { keyboardStart.current = height }}
        onKeyCancel={() => setHeight(keyboardStart.current)}
        onReset={() => { setHeight(clamp(104)); keyboardStart.current = clamp(104) }}
      />
      <div className="flex h-6 shrink-0 items-center pl-1.5 pr-1">
        <div
          className="h-full min-w-0 flex-1"
          aria-hidden
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('inspector.hide')}
              onClick={() => setOpen(false)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground/60 hover:bg-foreground/5 hover:text-foreground"
            >
              <ChevronsDown className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('inspector.hide')}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <InspectorTerminal cwd={cwd} autoFocus={focusOnOpen} />
      </div>
    </div>
  )
}

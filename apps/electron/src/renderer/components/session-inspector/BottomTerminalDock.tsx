import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { ChevronsDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import {
  focusedPanelRouteAtom,
  parseSessionIdFromRoute,
} from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { bottomDockHeightAtom, bottomTerminalOpenAtom } from '@/atoms/unified-shell'
import { InspectorTerminal } from './InspectorTerminal'

const MIN_HEIGHT = 140
const MAX_HEIGHT = 640

export function BottomTerminalDock() {
  const { t } = useTranslation()
  const [open, setOpen] = useAtom(bottomTerminalOpenAtom)
  const [height, setHeight] = useAtom(bottomDockHeightAtom)
  const route = useAtomValue(focusedPanelRouteAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionId = route ? parseSessionIdFromRoute(route) : null
  const cwd = sessionId ? sessionMetaMap.get(sessionId)?.workingDirectory : undefined
  const drag = React.useRef<{ startY: number; startH: number } | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    drag.current = { startY: event.clientY, startH: height }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return
    const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, state.startH + (state.startY - event.clientY)))
    setHeight(next)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
  }

  if (!open) return null

  return (
    <div
      className="relative flex shrink-0 flex-col overflow-hidden border-t border-foreground/5 bg-background"
      style={{ height }}
      data-bottom-terminal="true"
    >
      <div
        className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize hover:bg-foreground/15"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/5 px-3">
        <span className="truncate text-[12px] font-medium">{t('inspector.terminal')}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('inspector.hide')}
              onClick={() => setOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground/60 hover:bg-foreground/5 hover:text-foreground"
            >
              <ChevronsDown className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('inspector.hide')}</TooltipContent>
        </Tooltip>
      </div>
      <InspectorTerminal cwd={cwd} />
    </div>
  )
}

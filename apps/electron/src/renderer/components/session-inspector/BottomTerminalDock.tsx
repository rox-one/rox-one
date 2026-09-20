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

const MIN_HEIGHT = 96
const MAX_HEIGHT = 560

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
    const move = (e: PointerEvent) => {
      const state = drag.current
      if (!state) return
      const viewportCap = Math.max(MIN_HEIGHT, Math.floor(window.innerHeight * 0.36))
      const next = Math.min(MAX_HEIGHT, viewportCap, Math.max(MIN_HEIGHT, state.startH + (state.startY - e.clientY)))
      setHeight(next)
    }
    const up = () => {
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label={t('inspector.terminal')}
        onClick={() => setOpen(true)}
        className="chrome-strip pointer-events-auto mx-1 mb-1 flex h-[28px] shrink-0 items-center rounded-md border border-border/40 bg-background px-2.5 text-left"
        data-bottom-terminal="collapsed"
      >
        <span className="chrome-label truncate font-medium tracking-tight">{t('inspector.terminal')}</span>
      </button>
    )
  }

  return (
    <div
      className="relative mx-1 mb-1 flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-middle pointer-events-auto"
      style={{ height }}
      data-bottom-terminal="true"
    >
      <div
        className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize hover:bg-foreground/15"
        onPointerDown={onPointerDown}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('inspector.hide')}
            onClick={() => setOpen(false)}
            className="absolute right-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-[6px] text-muted-foreground/60 hover:bg-foreground/5 hover:text-foreground"
          >
            <ChevronsDown className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{t('inspector.hide')}</TooltipContent>
      </Tooltip>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <InspectorTerminal cwd={cwd} />
      </div>
    </div>
  )
}

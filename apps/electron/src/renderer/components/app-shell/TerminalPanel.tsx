/**
 * TerminalPanel
 *
 * Content-only terminal surface. The owning panel cell (the first panel of the
 * first column) supplies the height; this component only draws the flush header
 * and the terminal transcript. The single entry point stays the TopBar button
 * (`data-testid="bottom-terminal-toggle"`) driving `bottomTerminalOpenAtom`.
 */

import { useAtomValue, useSetAtom } from 'jotai'
import { ChevronsDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import {
  focusedPanelRouteAtom,
  parseSessionIdFromRoute,
} from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { bottomTerminalOpenAtom } from '@/atoms/unified-shell'
import { InspectorTerminal } from '@/components/session-inspector/InspectorTerminal'

export function TerminalPanel({ autoFocus = false }: { autoFocus?: boolean } = {}) {
  const { t } = useTranslation()
  const setOpen = useSetAtom(bottomTerminalOpenAtom)
  const route = useAtomValue(focusedPanelRouteAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionId = route ? parseSessionIdFromRoute(route) : null
  const cwd = sessionId ? sessionMetaMap.get(sessionId)?.workingDirectory : undefined

  return (
    <div
      className="rox-shell-pane rox-shell-divider-t relative flex h-full min-h-0 flex-col pointer-events-auto"
      data-terminal-panel="true"
      data-shell-role="content"
    >
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
        <InspectorTerminal cwd={cwd} autoFocus={autoFocus} />
      </div>
    </div>
  )
}
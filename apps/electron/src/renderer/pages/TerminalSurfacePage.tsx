/**
 * TerminalSurfacePage — MainContentPanel host for `terminal/{terminalId}`.
 *
 * Dedicated UEW PTY/xterm contribution stays unwired (flags default off;
 * terminal-contribution.render returns null). This surface never silent-
 * falls through to the sessions empty prompt: it mounts the existing
 * InspectorTerminal host, or an empty/unavailable state with a path to
 * the bottom terminal dock.
 */
import * as React from 'react'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { InspectorTerminal } from '@/components/session-inspector/InspectorTerminal'
import { bottomTerminalOpenAtom } from '@/atoms/unified-shell'

export interface TerminalSurfacePageProps {
  /** Terminal id from `terminal/{terminalId}` route details. Null = bare navigator. */
  terminalId: string | null
}

export default function TerminalSurfacePage({ terminalId }: TerminalSurfacePageProps) {
  const { t } = useTranslation()
  const setBottomTerminalOpen = useSetAtom(bottomTerminalOpenAtom)
  const openDock = React.useCallback(() => setBottomTerminalOpen(true), [setBottomTerminalOpen])

  if (!terminalId) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-muted-foreground"
        data-terminal-surface="empty"
        data-testid="terminal-surface-empty"
      >
        <p className="text-sm">{t('terminal.surface.noTerminalSelected')}</p>
        <p className="max-w-md text-center text-xs text-muted-foreground/80">
          {t('terminal.surface.useDockHint')}
        </p>
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-md border border-border/60 bg-foreground/[0.03] px-3 text-xs font-medium text-foreground hover:bg-foreground/5"
          data-terminal-surface-open-dock="true"
          onClick={openDock}
        >
          {t('terminal.surface.openDock')}
        </button>
      </div>
    )
  }

  // Real host: reuse the existing inspector shell bridge (BottomTerminalDock's
  // InspectorTerminal). Full UEW xterm PTY is out of scope / still stubbed.
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-terminal-surface="host"
      data-terminal-id={terminalId}
      data-testid="terminal-surface-host"
    >
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-border/40 px-3">
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {t('inspector.terminal')} · {terminalId}
        </span>
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground"
          data-terminal-surface-open-dock="true"
          onClick={openDock}
        >
          {t('terminal.surface.openDock')}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <InspectorTerminal />
      </div>
    </div>
  )
}

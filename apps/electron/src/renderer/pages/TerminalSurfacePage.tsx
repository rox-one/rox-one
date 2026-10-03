/**
 * TerminalSurfacePage — MainContentPanel host for `terminal/{terminalId}`.
 *
 * Dedicated UEW PTY/xterm contribution stays unwired (flags default off;
 * terminal-contribution.render returns null). This surface never silent-
 * falls through to the sessions empty prompt: it preserves unsupported terminal IDs
 * on an unavailable surface, with an empty state and a path to
 * the bottom terminal dock.
 */
import * as React from 'react'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
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

  // The current shell bridge has no durable terminal-id lookup. Opening the
  // generic inspector here would impersonate the requested terminal (and can
  // execute in another session's directory). Preserve the address honestly.
  return (
    <div
      role="status"
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-muted-foreground"
      data-terminal-surface="unavailable"
      data-terminal-id={terminalId}
      data-testid="terminal-surface-unavailable"
    >
      <p className="text-sm">{t('common.unavailable')}</p>
      <p className="max-w-md text-center text-xs">{t('terminal.surface.useDockHint')}</p>
      <button type="button" onClick={openDock} data-terminal-surface-open-dock="true"
        className="inline-flex h-8 items-center rounded-md border px-3 text-xs focus-visible:ring-2 focus-visible:ring-ring">
        {t('terminal.surface.openDock')}
      </button>
    </div>
  )
}

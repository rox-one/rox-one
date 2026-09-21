import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ExternalLink } from 'lucide-react'
import { RADIUS_INNER } from '@/components/app-shell/panel-constants'
import { CONATION_BOARD_DEEP_LINK } from './conation-board-panels'

type Props = {
  /** When false, panel shows off state. */
  enabled?: boolean
}

/**
 * ROX-010: Board as deep-link to Conation first.
 * No live in-pane second kanban — Rox Board stays the board surface.
 */
export function ConationBoardPanel({ enabled = true }: Props) {
  const { t } = useTranslation()

  if (!enabled) {
    return (
      <div
        data-conation-board="off"
        className="m-0.5 flex min-h-0 flex-1 flex-col items-center justify-center border border-border/50 bg-background p-6 text-sm text-muted-foreground shadow-middle"
        style={{ borderRadius: RADIUS_INNER }}
      >
        {t('conation.board.off')}
      </div>
    )
  }

  const openBoard = () => {
    const openUrl = window.electronAPI?.openUrl
    if (!openUrl) {
      toast.error(t('toast.failedToOpenLink'))
      return
    }
    void openUrl(CONATION_BOARD_DEEP_LINK).catch(() => {
      toast.error(t('toast.failedToOpenLink'))
    })
  }

  return (
    <div
      data-conation-board="deeplink"
      className="m-0.5 flex min-h-0 flex-1 flex-col overflow-hidden border border-border/50 bg-background shadow-middle"
      style={{ borderRadius: RADIUS_INNER }}
    >
      <div className="flex h-8 shrink-0 items-center border-b border-border/40 px-3">
        <span className="chrome-label truncate text-xs font-medium tracking-tight text-foreground/80">
          {t('conation.board.title', { defaultValue: 'Board' })}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <p className="text-sm leading-relaxed text-muted-foreground">{t('conation.board.description')}</p>
        <code className="rounded-md bg-foreground/[0.04] px-2 py-1.5 font-mono text-[11px] text-foreground/70">
          {CONATION_BOARD_DEEP_LINK}
        </code>
        <button
          type="button"
          onClick={openBoard}
          data-conation-board-open="true"
          className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-border/60 bg-foreground/[0.03] px-3 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('conation.board.open')}
        </button>
      </div>
    </div>
  )
}

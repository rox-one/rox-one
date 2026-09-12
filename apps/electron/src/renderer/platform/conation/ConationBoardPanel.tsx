import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
    return <div data-conation-board="off">{t('conation.board.off')}</div>
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
    <div data-conation-board="deeplink">
      <p>{t('conation.board.description')}</p>
      <p>
        <code>{CONATION_BOARD_DEEP_LINK}</code>
      </p>
      <button type="button" onClick={openBoard} data-conation-board-open="true">
        {t('conation.board.open')}
      </button>
    </div>
  )
}

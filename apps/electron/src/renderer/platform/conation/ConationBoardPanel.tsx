import React from 'react'
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
  if (!enabled) {
    return <div data-conation-board="off">Conation Board is off.</div>
  }

  const openBoard = () => {
    void window.electronAPI?.openUrl?.(CONATION_BOARD_DEEP_LINK)
  }

  return (
    <div data-conation-board="deeplink">
      <p>Board opens on Conation (deep-link). No second in-pane kanban.</p>
      <p>
        <code>{CONATION_BOARD_DEEP_LINK}</code>
      </p>
      <button type="button" onClick={openBoard} data-conation-board-open="true">
        Open Board on Conation
      </button>
    </div>
  )
}

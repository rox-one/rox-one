import React from 'react'
import { CONATION_FUND_DEEP_LINK } from './conation-fund-panels'

type Props = {
  /** When false, panel shows off state. */
  enabled?: boolean
}

/**
 * ROX-009: Fund canvas as deep-link to Conation first.
 * No live in-pane CRDT / Fund compositor until Perf harness numbers.
 */
export function ConationFundPanel({ enabled = true }: Props) {
  if (!enabled) {
    return <div data-conation-fund="off">Conation Fund is off.</div>
  }

  const openFund = () => {
    void window.electronAPI?.openUrl?.(CONATION_FUND_DEEP_LINK)
  }

  return (
    <div data-conation-fund="deeplink">
      <p>Fund canvas opens on Conation (deep-link). Live in-pane canvas stays off until Perf.</p>
      <p>
        <code>{CONATION_FUND_DEEP_LINK}</code>
      </p>
      <button type="button" onClick={openFund} data-conation-fund-open="true">
        Open Fund on Conation
      </button>
    </div>
  )
}

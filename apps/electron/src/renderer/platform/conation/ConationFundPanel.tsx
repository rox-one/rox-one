import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
  const { t } = useTranslation()

  if (!enabled) {
    return <div data-conation-fund="off">{t('conation.fund.off')}</div>
  }

  const openFund = () => {
    const openUrl = window.electronAPI?.openUrl
    if (!openUrl) {
      toast.error(t('toast.failedToOpenLink'))
      return
    }
    void openUrl(CONATION_FUND_DEEP_LINK).catch(() => {
      toast.error(t('toast.failedToOpenLink'))
    })
  }

  return (
    <div data-conation-fund="deeplink">
      <p>{t('conation.fund.description')}</p>
      <p>
        <code>{CONATION_FUND_DEEP_LINK}</code>
      </p>
      <button type="button" onClick={openFund} data-conation-fund-open="true">
        {t('conation.fund.open')}
      </button>
    </div>
  )
}

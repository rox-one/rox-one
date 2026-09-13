import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  attemptConationChannelPost,
  attemptConationMailSend,
} from './conation-mail-panels'

type Props = {
  /** When false, panel shows off state. */
  enabled?: boolean
}

/**
 * #380: Mail/Channels stay blocked-write. No live send, no fake success.
 * Evidence U1. L4 live Mail is NOT_RUN.
 */
export function ConationMailPanel({ enabled = true }: Props) {
  const { t } = useTranslation()
  const mailAttempt = attemptConationMailSend()
  const channelAttempt = attemptConationChannelPost()

  if (!enabled) {
    return <div data-conation-mail="off">{t('common.unavailable')}</div>
  }

  return (
    <div data-conation-mail="blocked" data-conation-mail-live="false" data-evidence="U1">
      <p>{t('common.unavailable')}</p>
      <p>{t('workbench.mode.unavailable')}</p>
      <p>{t('meetings.notApplied')}</p>
      <button type="button" disabled data-conation-mail-send={mailAttempt.status}>
        {t('common.unavailable')}
      </button>
      <button type="button" disabled data-conation-channel-post={channelAttempt.status}>
        {t('common.unavailable')}
      </button>
    </div>
  )
}

import { useTranslation } from 'react-i18next'

export type DeliveryState = 'draft' | 'queued' | 'blocked' | 'unknown' | 'verified'

export type ConationPanelProps = {
  mail?: { to: string[]; attachments: string[]; status: DeliveryState }
  crm?: { accountId: string; remoteType: string; remoteId: string; displayName: string }
  calendar?: { occurrenceKey: string }
  credentialsPresent?: boolean
  onSendMail?: () => void
}

export function ConationPanels(props: ConationPanelProps) {
  const { t } = useTranslation()
  const credentialsPresent = props.credentialsPresent === true
  const mailStatus = credentialsPresent ? (props.mail?.status ?? 'blocked') : 'blocked'
  const mailReason = credentialsPresent ? 'meetings.conation.blockedUntil333' : 'meetings.conation.noCredentials'

  return (
    <div className="mt-4 grid gap-3" data-testid="meeting-conation-panels">
      <section data-testid="meeting-mail-panel" className="border p-3">
        <h3>{t('meetings.mail.title')}</h3>
        <p>{t('meetings.mail.recipients')}: {(props.mail?.to ?? []).join(', ')}</p>
        <p data-testid="meeting-mail-status">{t(`meetings.conation.${mailStatus === 'queued' ? 'queued' : mailStatus === 'unknown' ? 'unknown' : 'blocked'}`)}</p>
        <p>{t(mailReason)}</p>
        <p>{t('meetings.conation.rollbackDisabled')}</p>
        <button type="button" data-testid="meeting-mail-send" disabled onClick={props.onSendMail}>
          {t('meetings.mail.send')}
        </button>
      </section>
      <section data-testid="meeting-crm-panel" className="border p-3">
        <h3>{t('meetings.crm.title')}</h3>
        <p data-entity-id={props.crm ? `crm-company:${props.crm.remoteId}` : undefined}>
          {props.crm ? `${props.crm.accountId}:${props.crm.remoteType}:${props.crm.remoteId}` : t('meetings.crm.useIds')}
        </p>
        <p>{t('meetings.crm.blocked')}</p>
      </section>
      <section data-testid="meeting-calendar-panel" className="border p-3">
        <h3>{t('meetings.calendar.title')}</h3>
        <p>{props.calendar?.occurrenceKey}</p>
        <p>{t('meetings.calendar.blocked')}</p>
        <p data-testid="meeting-no-dialer">{t('meetings.calendar.noDialer')}</p>
      </section>
      <section data-testid="meeting-room-panel" className="border p-3">
        <h3>{t('meetings.rooms.undecided')}</h3>
        <button type="button" data-testid="meeting-room-join" disabled>
          {t('meetings.rooms.undecided')}
        </button>
      </section>
    </div>
  )
}

export function MailThreadList(props: {
  threads?: { entityId: string; subject: string }[]
  credentialsPresent?: boolean
}) {
  const { t } = useTranslation()
  const items = props.credentialsPresent ? (props.threads ?? []) : []
  return (
    <div data-testid="mail-thread-list" data-kind="mail-thread" className="mt-3">
      <h3>{t('meetings.threads.title')}</h3>
      {items.length === 0 ? (
        <p data-testid="mail-thread-empty">{t('meetings.threads.empty')}</p>
      ) : (
        <ul>
          {items.map((thread) => (
            <li key={thread.entityId} data-entity-id={thread.entityId}>{thread.subject}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

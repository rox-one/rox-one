import { useTranslation } from 'react-i18next'
import { ConationPanels, MailThreadList } from './ConationPanels'
import { CatalogDisclosure } from '../tasks/CatalogPanel'
import { meetingStatusKey } from './request-state'

export default function MeetingDetail(props: { meeting: { id: string; title: string; status: string } }) {
  const { t } = useTranslation()
  return (
    <article data-testid="meeting-detail" data-entity-id={`call:${props.meeting.id}`} className="min-w-0">
      <h2 data-catalog-detail-heading tabIndex={-1} className="break-words text-[16px] font-semibold leading-snug outline-none">{props.meeting.title}</h2>
      <p className="mt-2 text-[12px] text-muted-foreground">{t('meetings.status')}: <span className="font-medium text-foreground">{t(meetingStatusKey(props.meeting.status))}</span></p>
      <div className="mt-3">
        <CatalogDisclosure title={t('meetings.connectedServices')}>
          <ConationPanels credentialsPresent={false} />
          <MailThreadList credentialsPresent={false} />
        </CatalogDisclosure>
      </div>
    </article>
  )
}

import { useTranslation } from 'react-i18next'

export default function MeetingDetail(props: { meeting: { id: string; title: string; status: string } }) {
  const { t } = useTranslation()
  return (
    <article data-testid="meeting-detail" data-entity-id={`call:${props.meeting.id}`}>
      <h2>{props.meeting.title}</h2>
      <p>{t('meetings.status')}: {props.meeting.status}</p>
    </article>
  )
}

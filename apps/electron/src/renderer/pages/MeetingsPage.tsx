import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MeetingDetail from './meetings/MeetingDetail'
import ProposalInbox, { type MeetingProposalRow } from './meetings/ProposalInbox'

export type MeetingListItem = {
  id: string
  title: string
  status: string
}

export default function MeetingsPage(props: {
  meetings?: MeetingListItem[]
  proposals?: MeetingProposalRow[]
  selectedId?: string | null
}) {
  const { t } = useTranslation()
  const meetings = props.meetings ?? []
  const [selectedId, setSelectedId] = useState<string | null>(props.selectedId ?? meetings[0]?.id ?? null)
  const selected = useMemo(() => meetings.find((item) => item.id === selectedId) ?? null, [meetings, selectedId])

  if (meetings.length === 0) {
    return (
      <div data-testid="meetings-empty" className="flex h-full flex-col gap-3 p-4">
        <h1>{t('meetings.title')}</h1>
        <p className="text-muted-foreground">{t('meetings.empty')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full" data-testid="meetings-page">
      <aside className="w-64 border-r p-3">
        <h1>{t('meetings.title')}</h1>
        <button type="button" data-testid="meetings-start">{t('meetings.start')}</button>
        <ul>
          {meetings.map((meeting) => (
            <li key={meeting.id}>
              <button type="button" data-testid={`meeting-row-${meeting.id}`} onClick={() => setSelectedId(meeting.id)}>
                {meeting.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex-1 p-4">
        {selected ? <MeetingDetail meeting={selected} /> : <p>{t('meetings.select')}</p>}
        <p data-testid="meeting-live-transcript" className="mt-3 text-sm">{t('meetings.transcriptPending')}</p>
        <ProposalInbox proposals={props.proposals ?? []} />
      </section>
    </div>
  )
}

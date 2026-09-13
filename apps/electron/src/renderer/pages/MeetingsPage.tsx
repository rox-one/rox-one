import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import MeetingDetail from './meetings/MeetingDetail'
import ProposalInbox from './meetings/ProposalInbox'
import {
  approveNativeProposalViaRpc,
  buildMeetingGrant,
  createNativeProposalViaRpc,
  i18nKeyForProposalError,
  resolveMeetingProposalApi,
  type MeetingProposalApi,
  type MeetingProposalRow,
  type NativeProposalType,
} from './meetings/proposal-rpc'

export type MeetingListItem = {
  id: string
  title: string
  status: string
}

export default function MeetingsPage(props: {
  meetings?: MeetingListItem[]
  proposals?: MeetingProposalRow[]
  selectedId?: string | null
  workspaceId?: string | null
  actorId?: string
  api?: MeetingProposalApi | null
}) {
  const { t } = useTranslation()
  const shell = useOptionalAppShellContext()
  const workspaceId = props.workspaceId ?? shell?.activeWorkspaceId ?? null
  const actorId = props.actorId ?? 'local-actor'
  const grant = workspaceId ? buildMeetingGrant({ workspaceId, actorId }) : null
  const api = resolveMeetingProposalApi(props.api)
  const [meetings, setMeetings] = useState<MeetingListItem[]>(props.meetings ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(props.selectedId ?? meetings[0]?.id ?? null)
  const [items, setItems] = useState<MeetingProposalRow[]>(props.proposals ?? [])
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<NativeProposalType>('create_task')
  const [banner, setBanner] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const selected = useMemo(() => meetings.find((item) => item.id === selectedId) ?? null, [meetings, selectedId])

  function startLocalMeeting() {
    const meeting: MeetingListItem = {
      id: `meeting-${crypto.randomUUID()}`,
      title: t('meetings.localMeeting'),
      status: 'open',
    }
    setMeetings((current) => [meeting, ...current])
    setSelectedId(meeting.id)
    setBanner(null)
  }

  async function handleCreate() {
    setBanner(null)
    const result = await createNativeProposalViaRpc({
      api,
      workspaceId,
      meetingId: selected?.id ?? null,
      actorId,
      grant,
      type: kind,
      payload: { title: title.trim() },
    })
    if (!result.ok) {
      setBanner(result.code)
      return
    }
    setItems((current) => [result.row, ...current.filter((row) => row.id !== result.row.id)])
    setTitle('')
  }

  async function handleApprove(row: MeetingProposalRow) {
    setBanner(null)
    setApprovingId(row.id)
    const result = await approveNativeProposalViaRpc({
      api,
      workspaceId,
      actorId,
      grant,
      row,
    })
    setApprovingId(null)
    setItems((current) => current.map((item) => item.id === row.id ? result.row : item))
    if (!result.ok) setBanner(result.code)
  }

  const createForm = (
    <div className="mt-4 flex flex-col gap-2" data-testid="meetings-create-form">
      <label>
        {t('meetings.proposalTitle')}
        <input
          data-testid="meetings-proposal-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <select
        data-testid="meetings-proposal-kind"
        value={kind}
        onChange={(event) => setKind(event.target.value as NativeProposalType)}
      >
        <option value="create_task">{t('meetings.kindTask')}</option>
        <option value="create_note">{t('meetings.kindNote')}</option>
      </select>
      <button type="button" data-testid="meetings-create-proposal" onClick={() => void handleCreate()}>
        {t('meetings.createProposal')}
      </button>
    </div>
  )

  const bannerNode = banner ? (
    <p data-testid="meetings-rpc-error">{t(i18nKeyForProposalError(banner))}</p>
  ) : null

  if (meetings.length === 0) {
    return (
      <div data-testid="meetings-empty" className="flex h-full flex-col gap-3 p-4">
        <h1>{t('meetings.title')}</h1>
        <p className="text-muted-foreground">{t('meetings.empty')}</p>
        <button type="button" data-testid="meetings-start" onClick={startLocalMeeting}>{t('meetings.start')}</button>
        {bannerNode}
        {createForm}
        <ProposalInbox proposals={items} onApprove={(row) => void handleApprove(row)} approvingId={approvingId} />
      </div>
    )
  }

  return (
    <div className="flex h-full" data-testid="meetings-page">
      <aside className="w-64 border-r p-3">
        <h1>{t('meetings.title')}</h1>
        <button type="button" data-testid="meetings-start" onClick={startLocalMeeting}>{t('meetings.start')}</button>
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
        {bannerNode}
        {createForm}
        <ProposalInbox proposals={items} onApprove={(row) => void handleApprove(row)} approvingId={approvingId} />
      </section>
    </div>
  )
}

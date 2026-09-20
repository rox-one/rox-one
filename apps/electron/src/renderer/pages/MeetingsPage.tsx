import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { navigate } from '@/lib/navigate'
import MeetingDetail from './meetings/MeetingDetail'
import ProposalInbox from './meetings/ProposalInbox'
import {
  approveNativeProposalViaRpc,
  buildMeetingGrant,
  createNativeProposalViaRpc,
  openNativeProposalTargetViaRpc,
  rejectNativeProposalViaRpc,
  resolveMeetingOpenTargetApi,
  resolveMeetingProposalApi,
  type MeetingOpenTargetApi,
  type MeetingProposalApi,
  type MeetingProposalRow,
  type NativeProposalType,
} from './meetings/proposal-rpc'
import {
  listNativeMeetingsViaRpc,
  resolveMeetingCatalogApi,
  resolveMeetingSearchApi,
  searchNativeMeetingsViaRpc,
  startNativeMeetingViaRpc,
  type MeetingCatalogApi,
  type MeetingListItem,
  type MeetingSearchApi,
} from './meetings/start-rpc'
import {
  applyCaptureIntentViaRpc,
  buildMeetingCaptureGrant,
  resolveMeetingCaptureApi,
  type CaptureIntentAction,
  type MeetingCaptureApi,
} from './meetings/capture-rpc'
import {
  buildMeetingImportGrant,
  importMediaViaRpc,
  resolveMeetingImportApi,
  specFromBytes,
  type MeetingImportApi,
} from './meetings/import-rpc'
import {
  finalizeMeetingViaRpc,
  resolveMeetingFinalizeApi,
  type MeetingFinalizeApi,
} from './meetings/finalize-rpc'
import {
  addManualNoteViaRpc,
  correctSegmentViaRpc,
  i18nKeyForManualError,
  resolveMeetingManualApi,
  type MeetingManualApi,
} from './meetings/manual-rpc'

export type { MeetingListItem }

export default function MeetingsPage(props: {
  meetings?: MeetingListItem[]
  proposals?: MeetingProposalRow[]
  selectedId?: string | null
  workspaceId?: string | null
  actorId?: string
  api?: (MeetingProposalApi & Partial<MeetingOpenTargetApi> & Partial<MeetingCatalogApi> & Partial<MeetingSearchApi> & Partial<MeetingCaptureApi> & Partial<MeetingImportApi> & Partial<MeetingFinalizeApi> & Partial<MeetingManualApi>) | null
}) {
  const { t } = useTranslation()
  const shell = useOptionalAppShellContext()
  const workspaceId = props.workspaceId ?? shell?.activeWorkspaceId ?? null
  const actorId = props.actorId ?? 'local-actor'
  const grant = workspaceId ? buildMeetingGrant({ workspaceId, actorId }) : null
  const captureGrant = workspaceId ? buildMeetingCaptureGrant({ workspaceId, actorId }) : null
  const importGrant = workspaceId ? buildMeetingImportGrant({ workspaceId, actorId }) : null
  const proposalApi = resolveMeetingProposalApi(props.api)
  const openTargetApi = resolveMeetingOpenTargetApi(props.api)
  const catalogApi = resolveMeetingCatalogApi(props.api)
  const searchApi = resolveMeetingSearchApi(props.api)
  const captureApi = resolveMeetingCaptureApi(props.api)
  const importApi = resolveMeetingImportApi(props.api)
  const finalizeApi = resolveMeetingFinalizeApi(props.api)
  const manualApi = resolveMeetingManualApi(props.api)
  const [meetings, setMeetings] = useState<MeetingListItem[]>(props.meetings ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(props.selectedId ?? meetings[0]?.id ?? null)
  const [items, setItems] = useState<MeetingProposalRow[]>(props.proposals ?? [])
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<NativeProposalType>('create_task')
  const [banner, setBanner] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noteSeq, setNoteSeq] = useState(0)
  const [segmentId, setSegmentId] = useState('')
  const [replacement, setReplacement] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchApplied, setSearchApplied] = useState(false)
  const selected = useMemo(() => meetings.find((item) => item.id === selectedId) ?? null, [meetings, selectedId])
  const weekHeaders = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
    return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(2024, 0, 1 + index)))
  }, [])

  useEffect(() => {
    if (props.meetings !== undefined) return
    void listNativeMeetingsViaRpc({ api: catalogApi, workspaceId }).then((listed) => {
      if (!listed.ok) return
      setMeetings(listed.meetings)
    })
  }, [catalogApi, props.meetings, workspaceId])

  async function handleStart() {
    setBanner(null)
    const result = await startNativeMeetingViaRpc({
      api: catalogApi,
      workspaceId,
      actorId,
      grant,
      title: t('meetings.localMeeting'),
    })
    if (!result.ok) {
      setBanner(result.code)
      return
    }
    setMeetings((current) => [result.meeting, ...current.filter((item) => item.id !== result.meeting.id)])
    setSelectedId(result.meeting.id)
  }

  async function handleSearch() {
    setBanner(null)
    const result = await searchNativeMeetingsViaRpc({
      api: searchApi,
      workspaceId,
      query: searchQuery,
    })
    if (!result.ok) {
      setBanner(result.code)
      return
    }
    setSearchApplied(true)
    setMeetings(result.meetings)
    setSelectedId((current) => result.meetings.some((item) => item.id === current) ? current : (result.meetings[0]?.id ?? null))
  }

  async function handleCreate() {
    setBanner(null)
    const result = await createNativeProposalViaRpc({
      api: proposalApi,
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
      api: proposalApi,
      workspaceId,
      actorId,
      grant,
      row,
    })
    setApprovingId(null)
    setItems((current) => current.map((item) => item.id === row.id ? result.row : item))
    if (!result.ok) setBanner(result.code)
  }

  async function handleReject(row: MeetingProposalRow) {
    setBanner(null)
    setApprovingId(row.id)
    const result = await rejectNativeProposalViaRpc({
      api: proposalApi,
      workspaceId,
      actorId,
      grant,
      row,
    })
    setApprovingId(null)
    setItems((current) => current.map((item) => item.id === row.id ? result.row : item))
    if (!result.ok) setBanner(result.code)
  }

  async function handleOpenTarget(row: MeetingProposalRow) {
    setBanner(null)
    const result = await openNativeProposalTargetViaRpc({
      api: openTargetApi,
      workspaceId,
      actorId,
      grant,
      row,
    })
    if (!result.ok) {
      setBanner(result.code)
      return
    }
    navigate(result.route)
  }

  async function handleCapture(action: CaptureIntentAction) {
    setBanner(null)
    const result = await applyCaptureIntentViaRpc({
      api: captureApi,
      workspaceId,
      meetingId: selected?.id ?? null,
      actorId,
      grant: captureGrant,
      action,
    })
    if (!result.ok) {
      setBanner(result.code)
      return
    }
    setMeetings((current) => current.map((item) => item.id === result.meeting.id ? result.meeting : item))
  }

  async function handleImport(file: File | null) {
    setBanner(null)
    if (!file) {
      setBanner('import-empty')
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const spec = await specFromBytes(bytes, file.type || undefined)
    const result = await importMediaViaRpc({
      api: importApi,
      workspaceId,
      meetingId: selected?.id ?? null,
      actorId,
      grant: importGrant,
      spec,
    })
    if (!result.ok) {
      setBanner(result.code)
      return
    }
    setMeetings((current) => current.map((item) => item.id === result.meeting.id ? result.meeting : item))
  }

  async function handleFinalize() {
    setBanner(null)
    const result = await finalizeMeetingViaRpc({
      api: finalizeApi,
      workspaceId,
      meetingId: selected?.id ?? null,
      actorId,
      grant: importGrant,
    })
    if (!result.ok) {
      setBanner(result.code)
      return
    }
    setMeetings((current) => current.map((item) => item.id === result.meeting.id ? result.meeting : item))
  }

  async function handleManualNote() {
    setBanner(null)
    const text = noteText.trim()
    const result = await addManualNoteViaRpc({
      api: manualApi,
      workspaceId,
      meetingId: selected?.id ?? null,
      actorId,
      grant: importGrant,
      spec: selected ? { noteId: `note-${selected.id}-${noteSeq}`, text } : null,
    })
    if (!result.ok) {
      setBanner(result.code)
      return
    }
    setNoteText('')
    setNoteSeq((current) => current + 1)
    setMeetings((current) => current.map((item) => item.id === result.meeting.id ? result.meeting : item))
  }

  async function handleCorrectSegment() {
    setBanner(null)
    const result = await correctSegmentViaRpc({
      api: manualApi,
      workspaceId,
      meetingId: selected?.id ?? null,
      actorId,
      grant: importGrant,
      spec: { segmentId: segmentId.trim(), replacement: replacement.trim() },
    })
    if (!result.ok) {
      setBanner(result.code)
      return
    }
    setSegmentId('')
    setReplacement('')
    setMeetings((current) => current.map((item) => item.id === result.meeting.id ? result.meeting : item))
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
    <p data-testid="meetings-rpc-error">{t(i18nKeyForManualError(banner))}</p>
  ) : null

  const nativeNote = <p data-testid="meetings-native-catalog">{t('meetings.nativeCatalog')}</p>
  const searchForm = (
    <div className="mt-3 flex flex-col gap-2" data-testid="meetings-search">
      <p data-testid="meetings-search-intent">{t('meetings.searchIntent')}</p>
      <input
        data-testid="meetings-search-query"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />
      <button type="button" data-testid="meetings-search-submit" onClick={() => void handleSearch()}>
        {t('meetings.search')}
      </button>
    </div>
  )
  const captureControls = selected ? (
    <div className="mt-3 flex flex-col gap-2" data-testid="meetings-capture">
      <p data-testid="meetings-capture-intent">{t('meetings.captureIntent')}</p>
      <button type="button" data-testid="meetings-capture-start" onClick={() => void handleCapture('start')}>
        {t('meetings.captureStart')}
      </button>
      <button type="button" data-testid="meetings-capture-pause" onClick={() => void handleCapture('pause')}>
        {t('meetings.capturePause')}
      </button>
      <button type="button" data-testid="meetings-capture-stop" onClick={() => void handleCapture('stop')}>
        {t('meetings.captureStop')}
      </button>
      <p data-testid="meetings-import-intent">{t('meetings.importIntent')}</p>
      <label>
        {t('meetings.importMedia')}
        <input
          data-testid="meetings-import-file"
          type="file"
          accept="audio/*"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null
            void handleImport(file)
            event.target.value = ''
          }}
        />
      </label>
      <p data-testid="meetings-finalize-intent">{t('meetings.finalizeIntent')}</p>
      <button type="button" data-testid="meetings-finalize" onClick={() => void handleFinalize()}>
        {t('meetings.finalize')}
      </button>
      <p data-testid="meetings-add-manual-note-intent">{t('meetings.addManualNoteIntent')}</p>
      <label>
        {t('meetings.addManualNote')}
        <input
          data-testid="meetings-manual-note-text"
          value={noteText}
          onChange={(event) => setNoteText(event.target.value)}
        />
      </label>
      <button type="button" data-testid="meetings-add-manual-note" onClick={() => void handleManualNote()}>
        {t('meetings.addManualNote')}
      </button>
      <p data-testid="meetings-correct-intent">{t('meetings.correctIntent')}</p>
      <label>
        {t('meetings.correctSegment')}
        <input
          data-testid="meetings-correct-segment-id"
          value={segmentId}
          onChange={(event) => setSegmentId(event.target.value)}
        />
      </label>
      <input
        data-testid="meetings-correct-replacement"
        value={replacement}
        onChange={(event) => setReplacement(event.target.value)}
      />
      <button type="button" data-testid="meetings-correct-segment" onClick={() => void handleCorrectSegment()}>
        {t('meetings.correctSegment')}
      </button>
    </div>
  ) : null

  if (meetings.length === 0 && !searchApplied) {
    return (
      <div data-testid="meetings-empty" className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
        <h1>{t('meetings.title')}</h1>
        <p className="text-muted-foreground">{t('meetings.empty')}</p>
        <div
          data-testid="meetings-week-strip"
          className="grid grid-cols-7 overflow-hidden rounded-md border border-border"
          role="presentation"
        >
          {weekHeaders.map((label, index) => (
            <div
              key={index}
              className="border-r border-border px-1 py-2 text-center text-xs font-medium text-muted-foreground last:border-r-0"
            >
              {label}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" data-testid="meetings-start" onClick={() => void handleStart()}>
            {t('meetings.start')}
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2" data-testid="meetings-search">
            <input
              data-testid="meetings-search-query"
              className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <button type="button" data-testid="meetings-search-submit" onClick={() => void handleSearch()}>
              {t('meetings.search')}
            </button>
          </div>
        </div>
        <p data-testid="meetings-native-catalog" className="text-xs text-muted-foreground">
          {t('meetings.nativeCatalog')}
        </p>
        {bannerNode}
        {createForm}
        <ProposalInbox
          proposals={items}
          onApprove={(row) => void handleApprove(row)}
          onReject={(row) => void handleReject(row)}
          onOpenTarget={(row) => void handleOpenTarget(row)}
          pendingId={approvingId}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full" data-testid="meetings-page">
      <aside className="w-64 border-r p-3">
        <h1>{t('meetings.title')}</h1>
        {nativeNote}
        {searchForm}
        <button type="button" data-testid="meetings-start" onClick={() => void handleStart()}>{t('meetings.start')}</button>
        {meetings.length === 0 && searchApplied ? (
          <p data-testid="meetings-search-empty">{t('meetings.searchEmpty')}</p>
        ) : null}
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
        {captureControls}
        <p data-testid="meeting-live-transcript" className="mt-3 text-sm">
          {t(selected?.status === 'completed' ? 'meetings.transcriptNone' : 'meetings.transcriptPending')}
        </p>
        {bannerNode}
        {createForm}
        <ProposalInbox
          proposals={items}
          onApprove={(row) => void handleApprove(row)}
          onReject={(row) => void handleReject(row)}
          onOpenTarget={(row) => void handleOpenTarget(row)}
          pendingId={approvingId}
        />
      </section>
    </div>
  )
}

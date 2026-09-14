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
import { loadMeetingSelection, resolveMeetingSelectionApi, type MeetingSelectionApi } from './meetings/selection'

export type { MeetingListItem }

export default function MeetingsPage(props: {
  meetings?: MeetingListItem[]
  proposals?: MeetingProposalRow[]
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  workspaceId?: string | null
  actorId?: string
  api?: (MeetingProposalApi & Partial<MeetingOpenTargetApi> & Partial<MeetingCatalogApi> & Partial<MeetingSearchApi> & Partial<MeetingCaptureApi> & Partial<MeetingImportApi> & Partial<MeetingFinalizeApi> & Partial<MeetingManualApi> & Partial<MeetingSelectionApi>) | null
}) {
  const { t } = useTranslation()
  const shell = useOptionalAppShellContext()
  const workspaceId = props.workspaceId ?? shell?.activeWorkspaceId ?? null
  const actorId = props.actorId ?? 'local-actor'
  const grant = workspaceId ? buildMeetingGrant({ workspaceId, actorId }) : null
  const captureGrant = workspaceId ? buildMeetingCaptureGrant({ workspaceId, actorId }) : null
  const importGrant = workspaceId ? buildMeetingImportGrant({ workspaceId, actorId }) : null
  const proposalApi = resolveMeetingProposalApi(props.api)
  const openTargetApi = resolveMeetingOpenTargetApi(props.api?.openMeetingTarget ? props.api as MeetingOpenTargetApi : undefined)
  const catalogApi = resolveMeetingCatalogApi(props.api?.createMeeting && props.api.listMeetings ? props.api as MeetingCatalogApi : undefined)
  const searchApi = resolveMeetingSearchApi(props.api)
  const captureApi = resolveMeetingCaptureApi(props.api?.startCapture && props.api.pauseCapture && props.api.stopCapture ? props.api as MeetingCaptureApi : undefined)
  const importApi = resolveMeetingImportApi(props.api?.importMedia ? props.api as MeetingImportApi : undefined)
  const finalizeApi = resolveMeetingFinalizeApi(props.api?.finalizeMeeting ? props.api as MeetingFinalizeApi : undefined)
  const manualApi = resolveMeetingManualApi(props.api?.addManualNote && props.api.correctSegment ? props.api as MeetingManualApi : undefined)
  const selectionApi = resolveMeetingSelectionApi(props.api)
  const [meetings, setMeetings] = useState<MeetingListItem[]>(props.meetings ?? [])
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const selectedId = props.selectedId === undefined ? localSelectedId : props.selectedId
  const selectMeeting = props.onSelect ?? setLocalSelectedId
  const [loadedSelection, setLoadedSelection] = useState<{
    workspaceId: string | null
    id: string
    meeting: MeetingListItem | null
  } | null>(null)
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
  const listedSelection = useMemo(() => meetings.find((item) => item.id === selectedId) ?? null, [meetings, selectedId])
  const currentLoadedSelection = loadedSelection?.workspaceId === workspaceId && loadedSelection.id === selectedId
    ? loadedSelection : null
  const selected = listedSelection ?? currentLoadedSelection?.meeting ?? null
  const selectedMissing = !!selectedId && !selected && (props.meetings !== undefined || currentLoadedSelection !== null)

  useEffect(() => {
    if (props.meetings !== undefined) {
      setMeetings(props.meetings)
      return
    }
    let cancelled = false
    void listNativeMeetingsViaRpc({ api: catalogApi, workspaceId }).then((listed) => {
      if (cancelled || !listed.ok) return
      setMeetings(listed.meetings)
    })
    return () => { cancelled = true }
  }, [catalogApi, props.meetings, workspaceId])

  useEffect(() => {
    if (!selectedId || listedSelection || props.meetings !== undefined) return
    let cancelled = false
    void loadMeetingSelection({ api: selectionApi, workspaceId, meetingId: selectedId })
      .catch(() => null)
      .then((meeting) => {
        if (!cancelled) setLoadedSelection({ workspaceId, id: selectedId, meeting })
      })
    return () => { cancelled = true }
  }, [selectionApi, workspaceId, selectedId, listedSelection, props.meetings])

  const updateMeeting = (meeting: MeetingListItem) => {
    setMeetings((current) => current.map((item) => item.id === meeting.id ? meeting : item))
    setLoadedSelection((current) => current?.id === meeting.id
      ? { ...current, meeting } : current)
  }

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
    selectMeeting(result.meeting.id)
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
    if (props.selectedId === undefined) {
      setLocalSelectedId((current) => result.meetings.some((item) => item.id === current) ? current : null)
    }
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
    updateMeeting(result.meeting)
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
    updateMeeting(result.meeting)
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
    updateMeeting(result.meeting)
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
    updateMeeting(result.meeting)
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
    updateMeeting(result.meeting)
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

  if (meetings.length === 0 && !searchApplied && !selectedId) {
    return (
      <div data-testid="meetings-empty" className="flex h-full flex-col gap-3 p-4">
        <h1>{t('meetings.title')}</h1>
        <p className="text-muted-foreground">{t('meetings.empty')}</p>
        {nativeNote}
        {searchForm}
        <button type="button" data-testid="meetings-start" onClick={() => void handleStart()}>{t('meetings.start')}</button>
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
              <button type="button" data-testid={`meeting-row-${meeting.id}`} aria-current={selectedId === meeting.id ? 'true' : undefined} onClick={() => selectMeeting(meeting.id)}>
                {meeting.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex-1 p-4">
        {selected ? <MeetingDetail meeting={selected} /> : <p>{t(selectedMissing ? 'meetings.meetingNotFound' : 'meetings.select')}</p>}
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

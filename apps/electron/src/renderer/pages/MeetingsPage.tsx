import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

import { ArrowLeft, CheckCheck, FileAudio, Loader2, Mic, Pause, Plus, Search, Square, Video, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CatalogDisclosure, CatalogSelect, useCatalogFocus } from './tasks/CatalogPanel'
import { EMPTY_MEETING_DRAFT, MeetingRequestTracker, clearSubmittedDraftFields, meetingStatusKey, type MeetingDraft } from './meetings/request-state'

export type { MeetingListItem }

type MeetingCatalogState = { workspaceId: string | null; meetings: MeetingListItem[] }
type CatalogLoad = { workspaceId: string | null; status: 'loading' | 'ready' | 'error'; code?: string }

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
  const [catalog, setCatalog] = useState<MeetingCatalogState>({ workspaceId, meetings: props.meetings ?? [] })
  const meetings = catalog.workspaceId === workspaceId ? catalog.meetings : []
  const setMeetings = useCallback((next: MeetingListItem[] | ((current: MeetingListItem[]) => MeetingListItem[])) => {
    setCatalog((current) => ({ workspaceId, meetings: typeof next === 'function' ? next(current.workspaceId === workspaceId ? current.meetings : []) : next }))
  }, [workspaceId])
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const selectedId = props.selectedId === undefined ? localSelectedId : props.selectedId
  const selectMeeting = props.onSelect ?? setLocalSelectedId
  const rootRef = useCatalogFocus(selectedId)
  const importRef = useRef<HTMLInputElement>(null)
  const [loadedSelection, setLoadedSelection] = useState<{
    workspaceId: string | null
    id: string
    meeting: MeetingListItem | null
    error?: string
  } | null>(null)
  const [proposalState, setProposalState] = useState({ workspaceId, rows: props.proposals ?? [] })
  const items = proposalState.workspaceId === workspaceId ? proposalState.rows : []
  const setItems = useCallback((next: MeetingProposalRow[] | ((current: MeetingProposalRow[]) => MeetingProposalRow[])) => {
    setProposalState((current) => ({ workspaceId, rows: typeof next === 'function' ? next(current.workspaceId === workspaceId ? current.rows : []) : next }))
  }, [workspaceId])
  const [drafts, setDrafts] = useState<Record<string, MeetingDraft>>({})
  const draftKey = JSON.stringify([workspaceId, selectedId])
  const draft = drafts[draftKey] ?? EMPTY_MEETING_DRAFT
  const { title, kind, noteText, noteSeq, segmentId, replacement } = draft
  const patchDraft = (patch: Partial<MeetingDraft>) => setDrafts((current) => ({ ...current, [draftKey]: { ...EMPTY_MEETING_DRAFT, ...current[draftKey], ...patch } }))
  const [bannerState, setBannerState] = useState<{ workspaceId: string | null; code: string } | null>(null)
  const banner = bannerState?.workspaceId === workspaceId ? bannerState.code : null
  const setBanner = (code: string | null) => setBannerState(code == null ? null : { workspaceId, code })
  const requests = useRef(new MeetingRequestTracker()).current
  requests.setScope(workspaceId)
  const [, refreshRequests] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchApplied, setSearchApplied] = useState(false)
  const [catalogLoad, setCatalogLoad] = useState<CatalogLoad>({ workspaceId, status: props.meetings === undefined ? 'loading' : 'ready' })
  const load = catalogLoad.workspaceId === workspaceId ? catalogLoad : { workspaceId, status: 'loading' as const }
  const [reload, setReload] = useState(0)
  const [selectionReload, setSelectionReload] = useState(0)
  const catalogEpoch = useRef(0)
  const listedSelection = useMemo(() => meetings.find((item) => item.id === selectedId) ?? null, [meetings, selectedId])
  const currentLoadedSelection = loadedSelection?.workspaceId === workspaceId && loadedSelection.id === selectedId ? loadedSelection : null
  const selected = listedSelection ?? currentLoadedSelection?.meeting ?? null
  const selectionError = !selected ? currentLoadedSelection?.error : undefined
  const selectedMissing = !!selectedId && !selected && !selectionError && (props.meetings !== undefined || currentLoadedSelection !== null)
  const selectedLoading = !!selectedId && !selected && !selectedMissing && !selectionError

  useEffect(() => () => requests.cancelAll(), [requests])
  useEffect(() => {
    setSearchQuery('')
    setSearchApplied(false)
    if (props.selectedId === undefined) setLocalSelectedId(null)
  }, [workspaceId])
  useEffect(() => {
    if (props.proposals !== undefined) setItems(props.proposals)
  }, [props.proposals, setItems])

  useEffect(() => {
    const epoch = ++catalogEpoch.current
    if (props.meetings !== undefined) {
      setMeetings(props.meetings)
      setCatalogLoad({ workspaceId, status: 'ready' })
      return
    }
    let cancelled = false
    setCatalogLoad({ workspaceId, status: 'loading' })
    void listNativeMeetingsViaRpc({ api: catalogApi, workspaceId }).then((listed) => {
      if (cancelled || catalogEpoch.current !== epoch) return
      if (!listed.ok) {
        setCatalogLoad({ workspaceId, status: 'error', code: listed.code })
        return
      }
      setMeetings(listed.meetings)
      setCatalogLoad({ workspaceId, status: 'ready' })
    }).catch(() => {
      if (!cancelled && catalogEpoch.current === epoch) setCatalogLoad({ workspaceId, status: 'error', code: 'rpc-unavailable' })
    })
    return () => { cancelled = true }
  }, [catalogApi, props.meetings, setMeetings, workspaceId, reload])

  useEffect(() => {
    if (!selectedId || listedSelection || props.meetings !== undefined) return
    let cancelled = false
    setLoadedSelection(null)
    if (!selectionApi || !workspaceId) {
      setLoadedSelection({ workspaceId, id: selectedId, meeting: null, error: 'rpc-unavailable' })
      return
    }
    void loadMeetingSelection({ api: selectionApi, workspaceId, meetingId: selectedId }).then((meeting) => {
      if (!cancelled) setLoadedSelection({ workspaceId, id: selectedId, meeting })
    }).catch(() => {
      if (!cancelled) setLoadedSelection({ workspaceId, id: selectedId, meeting: null, error: 'rpc-unavailable' })
    })
    return () => { cancelled = true }
  }, [selectionApi, workspaceId, selectedId, listedSelection, props.meetings, selectionReload])

  const updateMeeting = (meeting: MeetingListItem) => {
    setMeetings((current) => current.map((item) => item.id === meeting.id ? meeting : item))
    setLoadedSelection((current) => current?.workspaceId === workspaceId && current.id === meeting.id ? { ...current, meeting } : current)
  }

  async function request<T>(key: string, errorCode: string, operation: () => Promise<T>): Promise<T | undefined> {
    const token = requests.begin(key)
    if (!token) return undefined
    refreshRequests((value) => value + 1)
    setBanner(null)
    try {
      const result = await operation()
      return token.isCurrent() ? result : undefined
    } catch {
      if (token.isCurrent()) setBanner(errorCode)
      return undefined
    } finally {
      if (token.finish()) refreshRequests((value) => value + 1)
    }
  }

  async function handleStart() {
    const result = await request('start', 'start-failed', () => startNativeMeetingViaRpc({ api: catalogApi, workspaceId, actorId, grant, title: t('meetings.localMeeting') }))
    if (!result) return
    if (!result.ok) { setBanner(result.code); return }
    // A slower catalog response must not discard the new item.
    catalogEpoch.current += 1
    setCatalogLoad({ workspaceId, status: 'ready' })
    setMeetings((current) => [result.meeting, ...current.filter((item) => item.id !== result.meeting.id)])
    selectMeeting(result.meeting.id)
  }

  async function handleSearch() {
    if (requests.isPending('search')) return
    const epoch = ++catalogEpoch.current
    setCatalogLoad({ workspaceId, status: 'loading' })
    const result = await request('search', 'search-failed', () => searchNativeMeetingsViaRpc({ api: searchApi, workspaceId, query: searchQuery }).catch(() => ({ ok: false as const, code: 'search-failed' })))
    if (!result || epoch !== catalogEpoch.current) return
    if (!result.ok) { setCatalogLoad({ workspaceId, status: 'error', code: result.code }); return }
    setSearchApplied(true)
    setCatalogLoad({ workspaceId, status: 'ready' })
    setMeetings(result.meetings)
    if (props.selectedId === undefined) setLocalSelectedId((current) => result.meetings.some((item) => item.id === current) ? current : null)
  }

  function resetSearch() {
    catalogEpoch.current += 1
    requests.cancel('search')
    setSearchQuery('')
    setSearchApplied(false)
    setReload((current) => current + 1)
  }

  async function handleCreate() {
    const submitted = { title }
    const result = await request(`create:${selectedId}`, 'create-failed', () => createNativeProposalViaRpc({ api: proposalApi, workspaceId, meetingId: selected?.id ?? null, actorId, grant, type: kind, payload: { title: title.trim() } }))
    if (!result) return
    if (!result.ok) { setBanner(result.code); return }
    setItems((current) => [result.row, ...current.filter((row) => row.id !== result.row.id)])
    setDrafts((current) => ({ ...current, [draftKey]: clearSubmittedDraftFields(current[draftKey] ?? { ...EMPTY_MEETING_DRAFT }, submitted) }))
  }

  async function handleApprove(row: MeetingProposalRow) {
    const result = await request(`proposal:${row.id}`, 'approve-failed', () => approveNativeProposalViaRpc({ api: proposalApi, workspaceId, actorId, grant, row }))
    if (!result) return
    setItems((current) => current.map((item) => item.id === row.id ? result.row : item))
    if (!result.ok) setBanner(result.code)
  }

  async function handleReject(row: MeetingProposalRow) {
    const result = await request(`proposal:${row.id}`, 'reject-failed', () => rejectNativeProposalViaRpc({ api: proposalApi, workspaceId, actorId, grant, row }))
    if (!result) return
    setItems((current) => current.map((item) => item.id === row.id ? result.row : item))
    if (!result.ok) setBanner(result.code)
  }

  async function handleOpenTarget(row: MeetingProposalRow) {
    const result = await request(`open:${row.id}`, 'open-failed', () => openNativeProposalTargetViaRpc({ api: openTargetApi, workspaceId, actorId, grant, row }))
    if (!result) return
    if (!result.ok) { setBanner(result.code); return }
    navigate(result.route)
  }

  async function handleCapture(action: CaptureIntentAction) {
    const result = await request(`capture:${selectedId}`, 'capture-failed', () => applyCaptureIntentViaRpc({ api: captureApi, workspaceId, meetingId: selected?.id ?? null, actorId, grant: captureGrant, action }))
    if (!result) return
    if (!result.ok) { setBanner(result.code); return }
    updateMeeting(result.meeting)
  }

  async function handleImport(file: File | null) {
    if (!file) return
    const result = await request(`import:${selectedId}`, 'import-failed', async () => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const spec = await specFromBytes(bytes, file.type || undefined)
      return importMediaViaRpc({ api: importApi, workspaceId, meetingId: selected?.id ?? null, actorId, grant: importGrant, spec })
    })
    if (!result) return
    if (!result.ok) { setBanner(result.code); return }
    updateMeeting(result.meeting)
  }

  async function handleFinalize() {
    const result = await request(`finalize:${selectedId}`, 'finalize-failed', () => finalizeMeetingViaRpc({ api: finalizeApi, workspaceId, meetingId: selected?.id ?? null, actorId, grant: importGrant }))
    if (!result) return
    if (!result.ok) { setBanner(result.code); return }
    updateMeeting(result.meeting)
  }

  async function handleManualNote() {
    const submitted = { noteText }
    const text = noteText.trim()
    const result = await request(`note:${selectedId}`, 'note-failed', () => addManualNoteViaRpc({ api: manualApi, workspaceId, meetingId: selected?.id ?? null, actorId, grant: importGrant, spec: selected ? { noteId: `note-${selected.id}-${noteSeq}`, text } : null }))
    if (!result) return
    if (!result.ok) { setBanner(result.code); return }
    setDrafts((current) => ({ ...current, [draftKey]: { ...clearSubmittedDraftFields(current[draftKey] ?? { ...EMPTY_MEETING_DRAFT }, submitted), noteSeq: noteSeq + 1 } }))
    updateMeeting(result.meeting)
  }

  async function handleCorrectSegment() {
    const submitted = { segmentId, replacement }
    const result = await request(`correct:${selectedId}`, 'correct-failed', () => correctSegmentViaRpc({ api: manualApi, workspaceId, meetingId: selected?.id ?? null, actorId, grant: importGrant, spec: { segmentId: segmentId.trim(), replacement: replacement.trim() } }))
    if (!result) return
    if (!result.ok) { setBanner(result.code); return }
    setDrafts((current) => ({ ...current, [draftKey]: clearSubmittedDraftFields(current[draftKey] ?? { ...EMPTY_MEETING_DRAFT }, submitted) }))
    updateMeeting(result.meeting)
  }

  const captureBusy = requests.isPending(`capture:${selectedId}`)
  const importing = requests.isPending(`import:${selectedId}`)
  const noteBusy = requests.isPending(`note:${selectedId}`)
  const correctionBusy = requests.isPending(`correct:${selectedId}`)
  const createBusy = requests.isPending(`create:${selectedId}`)
  const finalizing = requests.isPending(`finalize:${selectedId}`)
  const capturing = selected?.status === 'capturing'
  const paused = selected?.status === 'paused'
  const busyIcon = <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />
  const proposalInbox = <ProposalInbox proposals={items} onApprove={(row) => void handleApprove(row)} onReject={(row) => void handleReject(row)} onOpenTarget={(row) => void handleOpenTarget(row)} pendingIds={new Set(items.filter((row) => requests.isPending(`proposal:${row.id}`)).map((row) => row.id))} />

  return (
    <div ref={rootRef} className="catalog-panel" data-testid="meetings-page" data-has-selection={selectedId != null}>
      {banner ? <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-[13px] text-destructive"><p data-testid="meetings-rpc-error" role="alert" className="min-w-0 flex-1">{t(i18nKeyForManualError(banner))}</p><Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={t('common.dismiss')} onClick={() => setBanner(null)}><X /></Button></div> : null}
      <div className="catalog-layout">
        <section className="catalog-master" aria-label={t('meetings.title')}>
          <header className="shrink-0 border-b border-border p-3">
            <div className="flex items-center gap-2"><h1 className="min-w-0 flex-1 text-[14px] font-semibold">{t('meetings.title')}</h1><Button type="button" size="sm" data-testid="meetings-start" disabled={requests.isPending('start')} aria-busy={requests.isPending('start')} onClick={() => void handleStart()}>{requests.isPending('start') ? busyIcon : <Plus size={14} />}{t('meetings.start')}</Button></div>
            <p data-testid="meetings-native-catalog" className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{t('meetings.nativeCatalog')}</p>
            <form className="mt-3 flex gap-1.5" data-testid="meetings-search" onSubmit={(event) => { event.preventDefault(); void handleSearch() }} role="search" aria-label={t('meetings.search')}>
              <Input data-catalog-entry data-testid="meetings-search-query" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} aria-label={t('meetings.search')} placeholder={t('common.search')} className="h-8 flex-1 text-[13px]" />
              <Button type="submit" size="icon" variant="secondary" className="size-8 shrink-0" data-testid="meetings-search-submit" disabled={requests.isPending('search')} aria-label={t('meetings.search')}>{requests.isPending('search') ? busyIcon : <Search />}</Button>
              {searchApplied || searchQuery ? <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" aria-label={t('common.clear')} onClick={resetSearch}><X /></Button> : null}
            </form>
            <p data-testid="meetings-search-intent" className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t('meetings.searchIntent')}</p>
          </header>
          <div className="flex-1 p-2">
            {load.status === 'loading' ? <p role="status" className="flex items-center justify-center gap-2 px-3 py-6 text-[13px] text-muted-foreground">{busyIcon}{t('common.loading')}</p> : null}
            {load.status === 'error' ? <div className="space-y-2 px-3 py-6 text-center"><p role="alert" className="text-[13px] text-destructive">{t(i18nKeyForManualError(load.code))}</p><Button size="sm" variant="secondary" onClick={() => setReload((current) => current + 1)}>{t('common.retry')}</Button></div> : null}
            {load.status === 'ready' && meetings.length === 0 ? <div data-testid={searchApplied ? 'meetings-search-empty' : 'meetings-empty'} className="flex flex-col items-center gap-2 px-3 py-8 text-center text-[13px] text-muted-foreground" role="status"><Video size={24} className="opacity-40" aria-hidden="true" /><p>{t(searchApplied ? 'meetings.searchEmpty' : 'meetings.empty')}</p>{searchApplied ? <Button size="sm" variant="ghost" onClick={resetSearch}>{t('common.clear')}</Button> : null}</div> : null}
            <ul className="space-y-0.5">
              {meetings.map((meeting) => <li key={meeting.id}><button type="button" data-testid={`meeting-row-${meeting.id}`} data-catalog-row={meeting.id} aria-current={selectedId === meeting.id ? 'true' : undefined} onClick={() => selectMeeting(meeting.id)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-focus aria-[current=true]:bg-foreground/8"><Video size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block truncate text-[13px]">{meeting.title}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{t(meetingStatusKey(meeting.status))}</span></span>{meeting.status === 'capturing' ? <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" /> : null}</button></li>)}
            </ul>
          </div>
          {!selectedId && items.length > 0 ? <div className="px-3 pb-3">{proposalInbox}</div> : null}
        </section>
        <section className="catalog-detail" aria-label={t('meetings.title')}>
          <Button variant="ghost" size="sm" className="catalog-back self-start px-1" onClick={() => selectMeeting(null)}><ArrowLeft size={14} />{t('common.backToList')}</Button>
          {selected ? (
            <>
              <MeetingDetail meeting={selected} />
              <section data-testid="meetings-capture" className="space-y-2 border-y border-border py-3">
                <p data-testid="meetings-capture-intent" className="text-[11px] leading-relaxed text-muted-foreground">{t('meetings.captureIntent')}</p>
                <div className="flex flex-wrap items-center gap-1.5" aria-busy={captureBusy}>
                  <Button type="button" size="sm" variant="secondary" data-testid="meetings-capture-start" disabled={captureBusy || capturing || selected.status === 'completed' || selected.status === 'finalizing'} onClick={() => void handleCapture('start')}>{captureBusy ? busyIcon : <Mic size={14} />}{t('meetings.captureStart')}</Button>
                  <Button type="button" size="sm" variant="ghost" data-testid="meetings-capture-pause" disabled={captureBusy || !capturing} onClick={() => void handleCapture('pause')}><Pause size={14} />{t('meetings.capturePause')}</Button>
                  <Button type="button" size="sm" variant={capturing || paused ? 'destructive' : 'ghost'} data-testid="meetings-capture-stop" disabled={captureBusy || (!capturing && !paused)} onClick={() => void handleCapture('stop')}><Square size={14} />{t('meetings.captureStop')}</Button>
                </div>
              </section>
              <p data-testid="meeting-live-transcript" className="text-[12px] text-muted-foreground">{t(selected.status === 'completed' ? 'meetings.transcriptNone' : 'meetings.transcriptPending')}</p>
              <CatalogDisclosure title={t('meetings.addManualNote')}>
                <form onSubmit={(event) => { event.preventDefault(); void handleManualNote() }} className="grid gap-2" aria-busy={noteBusy}>
                  <p data-testid="meetings-add-manual-note-intent" className="text-[11px] text-muted-foreground">{t('meetings.addManualNoteIntent')}</p>
                  <Textarea data-testid="meetings-manual-note-text" value={noteText} onChange={(event) => patchDraft({ noteText: event.target.value })} aria-label={t('meetings.addManualNote')} className="min-h-24 resize-y text-[13px]" />
                  <Button type="submit" size="sm" variant="secondary" className="justify-self-start" data-testid="meetings-add-manual-note" disabled={noteBusy || !noteText.trim()}>{noteBusy ? busyIcon : <Plus size={14} />}{t('meetings.addManualNote')}</Button>
                </form>
              </CatalogDisclosure>
              <CatalogDisclosure title={t('meetings.createProposal')}>
                <form onSubmit={(event) => { event.preventDefault(); void handleCreate() }} className="grid gap-2" data-testid="meetings-create-form" aria-busy={createBusy}>
                  <label><span className="catalog-label">{t('meetings.proposalTitle')}</span><Input data-testid="meetings-proposal-title" value={title} onChange={(event) => patchDraft({ title: event.target.value })} className="h-8 text-[13px]" /></label>
                  <CatalogSelect testId="meetings-proposal-kind" label={t('common.type')} value={kind} options={[{ value: 'create_task', label: t('meetings.kindTask') }, { value: 'create_note', label: t('meetings.kindNote') }]} onChange={(value) => patchDraft({ kind: value as NativeProposalType })} />
                  <Button type="submit" size="sm" variant="secondary" className="justify-self-start" data-testid="meetings-create-proposal" disabled={createBusy || !title.trim()}>{createBusy ? busyIcon : <Plus size={14} />}{t('meetings.createProposal')}</Button>
                </form>
              </CatalogDisclosure>
              {proposalInbox}
              <CatalogDisclosure title={t('meetings.importMedia')}>
                <p data-testid="meetings-import-intent" className="text-[11px] leading-relaxed text-muted-foreground">{t('meetings.importIntent')}</p>
                <Button type="button" size="sm" variant="secondary" className="justify-self-start" disabled={importing} aria-busy={importing} onClick={() => importRef.current?.click()}>{importing ? busyIcon : <FileAudio size={14} />}{t('meetings.importMedia')}</Button>
                <input ref={importRef} data-testid="meetings-import-file" type="file" accept="audio/*" className="hidden" aria-label={t('meetings.importMedia')} disabled={importing} onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ''; void handleImport(file) }} />
              </CatalogDisclosure>
              <CatalogDisclosure title={t('meetings.correctSegment')}>
                <form onSubmit={(event) => { event.preventDefault(); void handleCorrectSegment() }} className="grid gap-2" aria-busy={correctionBusy}>
                  <p data-testid="meetings-correct-intent" className="text-[11px] leading-relaxed text-muted-foreground">{t('meetings.correctIntent')}</p>
                  <label><span className="catalog-label">{t('meetings.segmentId')}</span><Input data-testid="meetings-correct-segment-id" value={segmentId} onChange={(event) => patchDraft({ segmentId: event.target.value })} className="h-8 text-[13px]" /></label>
                  <label><span className="catalog-label">{t('meetings.replacementText')}</span><Textarea data-testid="meetings-correct-replacement" value={replacement} onChange={(event) => patchDraft({ replacement: event.target.value })} className="min-h-20 resize-y text-[13px]" /></label>
                  <Button type="submit" size="sm" variant="secondary" className="justify-self-start" data-testid="meetings-correct-segment" disabled={correctionBusy || !segmentId.trim() || !replacement.trim()}>{correctionBusy ? busyIcon : null}{t('meetings.correctSegment')}</Button>
                </form>
              </CatalogDisclosure>
              <CatalogDisclosure title={t('meetings.finalize')}>
                <p data-testid="meetings-finalize-intent" className="text-[11px] leading-relaxed text-muted-foreground">{t('meetings.finalizeIntent')}</p>
                <Button type="button" size="sm" variant="secondary" className="justify-self-start" data-testid="meetings-finalize" disabled={finalizing || capturing || paused || captureBusy} aria-busy={finalizing} onClick={() => void handleFinalize()}>{finalizing ? busyIcon : <CheckCheck size={14} />}{t('meetings.finalize')}</Button>
              </CatalogDisclosure>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-[13px] text-muted-foreground">
              {selectedLoading ? busyIcon : <Video size={28} className="opacity-40" aria-hidden="true" />}
              <p data-catalog-detail-heading tabIndex={-1} role={selectionError ? 'alert' : 'status'} className="outline-none">{t(selectionError ? i18nKeyForManualError(selectionError) : selectedLoading ? 'common.loading' : selectedMissing ? 'meetings.meetingNotFound' : 'meetings.select')}</p>
              {selectionError ? <Button size="sm" variant="secondary" onClick={() => setSelectionReload((current) => current + 1)}>{t('common.retry')}</Button> : null}
              {selectedId ? <Button size="sm" variant="ghost" onClick={() => selectMeeting(null)}>{t('common.backToList')}</Button> : null}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

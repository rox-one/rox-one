/**
 * Встречи — mode screen (navigator → list → detail), on the existing
 * meetings:* IPC. Capture/import/finalize are journal intents: no OS audio is
 * recorded and no ASR runs yet, and rooms stay off until an SFU is chosen —
 * the screen says so instead of showing an invented transcript.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  GroupLabel,
  ListHeader,
  ListRow,
  ModeScreenLayout,
  NavItem,
  NavSection,
  NavTitle,
  SectionLabel,
  Tabs,
  useListKeys,
} from '@/components/mode-screen/ModeScreen'
import ProposalInbox from './meetings/ProposalInbox'
import { AgentReadiness } from './meetings/AgentReadiness'
import { useLocalMeetingReadiness } from './meetings/use-local-meeting-readiness'
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
import {
  loadMeetingSelection,
  resolveMeetingSelectionApi,
  type MeetingSelectionApi,
} from './meetings/selection'
import {
  bucketCounts,
  durationMs,
  groupMeetings,
  inBucket,
  isLive,
  pendingProposalCount,
  sourceKey,
  statusBadge,
  toMeetingView,
  upsertMeeting,
  type MeetingGroup,
  type MeetingView,
  type MeetingsBucket,
  type ProposalWithMeeting,
} from './meetings/meetings-model'
import { getAppLocale } from '@craft-agent/shared/i18n'

export type { MeetingListItem }

type DetailTab = 'transcript' | 'summary' | 'actions' | 'proposals'
type NavSelection = { kind: 'bucket'; bucket: MeetingsBucket } | { kind: 'agent'; id: string }

const AGENT_LABEL: Record<string, string> = {
  'rox.meeting.coordinator': 'meetings.agent.coordinator',
  'rox.meeting.assist': 'meetings.agent.assist',
  'rox.meeting.scribe': 'meetings.agent.scribe',
  'rox.meeting.knowledge': 'meetings.agent.knowledge',
  'rox.meeting.executor': 'meetings.agent.executor',
  'rox.meeting.author': 'meetings.agent.author',
  'rox.meeting.followup': 'meetings.agent.followup',
  'rox.meeting.analyst': 'meetings.agent.analyst',
}

export default function MeetingsPage(props: {
  meetings?: MeetingListItem[]
  proposals?: MeetingProposalRow[]
  selectedId?: string | null
  workspaceId?: string | null
  actorId?: string
  api?: (MeetingProposalApi & Partial<MeetingOpenTargetApi> & Partial<MeetingCatalogApi> & Partial<MeetingSearchApi> & Partial<MeetingCaptureApi> & Partial<MeetingImportApi> & Partial<MeetingFinalizeApi> & Partial<MeetingManualApi> & Partial<MeetingSelectionApi>) | null
}) {
  const { t, i18n } = useTranslation()
  const shell = useOptionalAppShellContext()
  const locale = i18n.resolvedLanguage || i18n.language || getAppLocale()
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
  const selectionApi = resolveMeetingSelectionApi(props.api)
  const readiness = useLocalMeetingReadiness('local')

  const [meetings, setMeetings] = useState<MeetingView[]>(props.meetings ?? [])
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'error'>(props.meetings ? 'ready' : 'loading')
  const [catalogReload, setCatalogReload] = useState(0)
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const routeBound = props.selectedId !== undefined
  const selectedId = routeBound ? props.selectedId ?? null : localSelectedId
  const selectMeeting = useCallback((id: string | null) => {
    if (routeBound) navigate(routes.view.meetings(id ?? undefined))
    else setLocalSelectedId(id)
  }, [routeBound])
  const [loadedSelection, setLoadedSelection] = useState<{
    workspaceId: string | null
    id: string
    meeting: MeetingListItem | null
    error?: string
  } | null>(null)
  const [selectionReload, setSelectionReload] = useState(0)
  const [items, setItems] = useState<ProposalWithMeeting[]>(props.proposals ?? [])
  const [nav, setNav] = useState<NavSelection>({ kind: 'bucket', bucket: 'all' })
  const [tab, setTab] = useState<DetailTab>('transcript')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<NativeProposalType>('create_task')
  const [actionTitle, setActionTitle] = useState('')
  const [banner, setBanner] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noteSeq, setNoteSeq] = useState(0)
  const [notes, setNotes] = useState<Array<{ meetingId: string; text: string; at: number }>>([])
  const [segmentId, setSegmentId] = useState('')
  const [replacement, setReplacement] = useState('')
  const [showCorrection, setShowCorrection] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchApplied, setSearchApplied] = useState(false)
  const [checkedActions, setCheckedActions] = useState<string[]>([])
  const [delegating, setDelegating] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const now = Date.now()

  const listedSelection = useMemo(() => meetings.find((item) => item.id === selectedId) ?? null, [meetings, selectedId])
  const currentLoadedSelection = loadedSelection?.workspaceId === workspaceId && loadedSelection.id === selectedId ? loadedSelection : null
  const selected: MeetingView | null = listedSelection ?? currentLoadedSelection?.meeting ?? null
  const selectionError = !selected ? currentLoadedSelection?.error : undefined
  const selectedMissing = !!selectedId && !selected && !selectionError && (props.meetings !== undefined || currentLoadedSelection !== null)
  const selectedLoading = !!selectedId && !selected && !selectedMissing && !selectionError

  const counts = useMemo(() => bucketCounts(meetings, items, now), [meetings, items, now])
  const bucket = nav.kind === 'bucket' ? nav.bucket : 'all'
  const visible = useMemo(
    () => (searchApplied ? meetings : meetings.filter((m) => inBucket(m, bucket, items, now))),
    [meetings, bucket, items, now, searchApplied],
  )
  const groups = useMemo(() => groupMeetings(visible, now), [visible, now])
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const live = useMemo(() => meetings.find(isLive) ?? null, [meetings])
  const meetingProposals = useMemo(() => items.filter((row) => row.meetingId === selected?.id), [items, selected?.id])
  const meetingActions = useMemo(() => meetingProposals.filter((row) => row.type === 'create_task'), [meetingProposals])
  const meetingNotes = useMemo(() => notes.filter((n) => n.meetingId === selected?.id), [notes, selected?.id])

  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }), [locale])

  useEffect(() => {
    if (props.meetings !== undefined) return
    if (!catalogApi || !workspaceId) {
      setCatalogState('error')
      return
    }
    let cancelled = false
    setCatalogState('loading')
    catalogApi.listMeetings(workspaceId).then((result) => {
      if (cancelled) return
      setMeetings((result.page ?? []).map(toMeetingView))
      setCatalogState('ready')
    }).catch(() => {
      if (!cancelled) setCatalogState('error')
    })
    return () => { cancelled = true }
  }, [catalogApi, props.meetings, workspaceId, catalogReload])

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

  useEffect(() => {
    setCheckedActions([])
    setShowCorrection(false)
  }, [selected?.id])

  const applyRow = (row: MeetingListItem) => setMeetings((current) => upsertMeeting(current, row))

  async function captureFor(meetingId: string, action: CaptureIntentAction): Promise<boolean> {
    const result = await applyCaptureIntentViaRpc({
      api: captureApi,
      workspaceId,
      meetingId,
      actorId,
      grant: captureGrant,
      action,
    })
    if (!result.ok) {
      setBanner(result.code)
      return false
    }
    applyRow(result.meeting)
    return true
  }

  async function handleStart(options: { record: boolean }) {
    setBanner(null)
    setBusy(true)
    try {
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
      applyRow(result.meeting)
      selectMeeting(result.meeting.id)
      setTab('transcript')
      if (options.record) await captureFor(result.meeting.id, 'start')
    } finally {
      setBusy(false)
    }
  }

  async function handleSearch() {
    setBanner(null)
    if (!searchQuery.trim()) {
      setSearchApplied(false)
      setCatalogReload((n) => n + 1)
      return
    }
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
    setMeetings((current) => result.meetings.map((row) => ({ ...current.find((m) => m.id === row.id), ...row })))
  }

  function clearSearch() {
    setSearchQuery('')
    setSearchApplied(false)
    setCatalogReload((n) => n + 1)
  }

  async function createProposal(type: NativeProposalType, proposalTitle: string): Promise<boolean> {
    setBanner(null)
    const meetingId = selected?.id ?? null
    const result = await createNativeProposalViaRpc({
      api: proposalApi,
      workspaceId,
      meetingId,
      actorId,
      grant,
      type,
      payload: { title: proposalTitle.trim() },
    })
    if (!result.ok) {
      setBanner(result.code)
      return false
    }
    setItems((current) => [{ ...result.row, meetingId }, ...current.filter((row) => row.id !== result.row.id)])
    return true
  }

  async function handleCreate() {
    if (!title.trim()) return
    if (await createProposal(kind, title)) setTitle('')
  }

  async function handleAddAction() {
    if (!actionTitle.trim()) return
    if (await createProposal('create_task', actionTitle)) setActionTitle('')
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
    setItems((current) => current.map((item) => item.id === row.id ? { ...result.row, meetingId: item.meetingId } : item))
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
    setItems((current) => current.map((item) => item.id === row.id ? { ...result.row, meetingId: item.meetingId } : item))
    if (!result.ok) setBanner(result.code)
  }

  async function handleApproveChecked() {
    const batch = meetingActions.filter((row) => checkedActions.includes(row.id) && row.status === 'proposed')
    for (const row of batch) await handleApprove(row)
    setCheckedActions([])
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
    if (!selected) {
      setBanner('meeting-required')
      return
    }
    await captureFor(selected.id, action)
  }

  async function handleImport(file: File | null) {
    setBanner(null)
    if (!file) {
      setBanner('import-empty')
      return
    }
    let meetingId = selected?.id ?? null
    if (!meetingId) {
      const started = await startNativeMeetingViaRpc({ api: catalogApi, workspaceId, actorId, grant, title: file.name })
      if (!started.ok) {
        setBanner(started.code)
        return
      }
      applyRow(started.meeting)
      selectMeeting(started.meeting.id)
      meetingId = started.meeting.id
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const spec = await specFromBytes(bytes, file.type || undefined)
    const result = await importMediaViaRpc({
      api: importApi,
      workspaceId,
      meetingId,
      actorId,
      grant: importGrant,
      spec,
    })
    if (!result.ok) {
      setBanner(result.code)
      return
    }
    applyRow(result.meeting)
  }

  /** «Завершить и подвести итоги»: stop the capture intent, then meetings:finalize. */
  async function handleFinalize() {
    setBanner(null)
    if (!selected) {
      setBanner('meeting-required')
      return
    }
    setBusy(true)
    try {
      if (selected.status === 'capturing' || selected.status === 'paused') {
        if (!(await captureFor(selected.id, 'stop'))) return
      }
      const result = await finalizeMeetingViaRpc({
        api: finalizeApi,
        workspaceId,
        meetingId: selected.id,
        actorId,
        grant: importGrant,
      })
      if (!result.ok) {
        // A stopped capture is already completed; finalize reports not-ready.
        if (result.code !== 'finalize-not-ready') setBanner(result.code)
        return
      }
      applyRow(result.meeting)
      setTab('summary')
    } finally {
      setBusy(false)
    }
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
    setNotes((current) => [...current, { meetingId: result.meeting.id, text, at: Date.now() }])
    setNoteText('')
    setNoteSeq((current) => current + 1)
    applyRow(result.meeting)
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
    applyRow(result.meeting)
  }

  /** «Поручить агенту»: new session with the meeting's journal context. */
  async function handleDelegate() {
    if (!selected || !workspaceId || !shell) return
    setDelegating(true)
    setBanner(null)
    try {
      const lines = [
        t('meetings.screen.delegatePrompt', { title: selected.title }),
        `${t('meetings.status')}: ${t(statusBadge(selected, items).key, { count: pendingProposalCount(items, selected.id) })}`,
        ...meetingNotes.map((n) => `- ${n.text}`),
        ...meetingProposals.map((p) => `- [${p.status}] ${p.title}`),
      ]
      const session = await shell.onCreateSession(workspaceId, { sessionStatus: 'todo' })
      await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: selected.title })
      await window.electronAPI.sendMessage(session.id, lines.join('\n'))
      navigate(routes.view.allSessions(session.id))
    } catch (error) {
      setBanner(error instanceof Error ? error.message : String(error))
    } finally {
      setDelegating(false)
    }
  }

  const onListKeys = useListKeys(ordered, selected && ordered.includes(selected) ? selected : null, (m) => selectMeeting(m.id))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const groupTitle = (group: MeetingGroup) => {
    switch (group.label.kind) {
      case 'now': return t('meetings.screen.groupNow')
      case 'planned': return t('meetings.screen.groupPlanned')
      case 'today': return t('meetings.screen.groupToday')
      case 'yesterday': return t('meetings.screen.groupYesterday')
      case 'undated': return t('meetings.screen.groupUndated')
      default: return dayFmt.format(group.label.date ?? 0)
    }
  }

  const bucketTitle: Record<MeetingsBucket, string> = {
    all: t('meetings.screen.all'),
    today: t('meetings.screen.today'),
    upcoming: t('meetings.screen.upcoming'),
    past: t('meetings.screen.past'),
    live: t('meetings.screen.live'),
    needsAction: t('meetings.screen.needsAction'),
  }

  const bannerNode = banner ? (
    <div role="alert" data-testid="meetings-rpc-error" className="mx-3 mt-2 rounded-[6px] bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
      {t(i18nKeyForManualError(banner), { defaultValue: banner })}
    </div>
  ) : null

  const selectBucket = (b: MeetingsBucket) => {
    setNav({ kind: 'bucket', bucket: b })
    if (searchApplied) clearSearch()
  }

  const navigator = (
    <>
      <NavTitle>{t('meetings.title')}</NavTitle>
      <NavItem label={t('meetings.screen.all')} count={counts.all} active={nav.kind === 'bucket' && nav.bucket === 'all'} onClick={() => selectBucket('all')} testId="meetings-nav-all" />
      <NavItem label={t('meetings.screen.today')} count={counts.today} active={nav.kind === 'bucket' && nav.bucket === 'today'} onClick={() => selectBucket('today')} testId="meetings-nav-today" />
      <NavItem label={t('meetings.screen.upcoming')} count={counts.upcoming} active={nav.kind === 'bucket' && nav.bucket === 'upcoming'} onClick={() => selectBucket('upcoming')} />
      <NavItem label={t('meetings.screen.past')} count={counts.past} active={nav.kind === 'bucket' && nav.bucket === 'past'} onClick={() => selectBucket('past')} />
      <NavItem label={t('meetings.screen.live')} count={counts.live} dot={counts.live ? 'danger' : undefined} active={nav.kind === 'bucket' && nav.bucket === 'live'} onClick={() => selectBucket('live')} />
      <NavSection title={t('meetings.screen.requireAction')}>
        <NavItem label={t('meetings.screen.needsAction')} count={counts.needsAction} dot={counts.needsAction ? 'warning' : undefined} active={nav.kind === 'bucket' && nav.bucket === 'needsAction'} onClick={() => selectBucket('needsAction')} />
      </NavSection>
      <NavSection title={t('meetings.screen.sources')}>
        <NavItem label={t('meetings.screen.calendarsNone')} dot="muted" onClick={() => navigate(routes.view.connections())} testId="meetings-connect-calendar" />
        <NavItem label={t('meetings.screen.importAudio')} onClick={() => fileRef.current?.click()} testId="meetings-nav-import" />
      </NavSection>
      <NavSection title={t('meetings.screen.agents')}>
        {readiness.agents.map((agent) => (
          <NavItem
            key={agent.id}
            label={t(AGENT_LABEL[agent.id] ?? agent.id, { defaultValue: agent.id })}
            dot={agent.blocker ? 'warning' : 'success'}
            active={nav.kind === 'agent' && nav.id === agent.id}
            onClick={() => setNav({ kind: 'agent', id: agent.id })}
          />
        ))}
      </NavSection>
      <input
        ref={fileRef}
        data-testid="meetings-import-file"
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          void handleImport(file)
          event.target.value = ''
        }}
      />
    </>
  )

  const listPanel = (
    <>
      <ListHeader
        title={searchApplied ? t('meetings.screen.searchResults') : bucketTitle[bucket]}
        subtitle={dayFmt.format(now)}
        actions={(
          <Button variant="primary" data-testid="meetings-start" disabled={busy} onClick={() => void handleStart({ record: true })}>
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            {t('meetings.screen.startRecording')}
          </Button>
        )}
      />
      <form
        className="mx-3 mt-1 flex items-center gap-1.5 rounded-[6px] bg-foreground/[0.05] px-2"
        data-testid="meetings-search"
        onSubmit={(event) => { event.preventDefault(); void handleSearch() }}
      >
        <span aria-hidden className="text-text-muted">⌕</span>
        <input
          ref={searchRef}
          data-testid="meetings-search-query"
          value={searchQuery}
          title={t('meetings.searchIntent')}
          placeholder={t('meetings.screen.searchPlaceholder')}
          aria-label={t('meetings.screen.searchPlaceholder')}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') clearSearch() }}
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-muted"
        />
        {searchApplied ? (
          <button type="button" className="text-[11px] text-text-muted hover:text-foreground" onClick={clearSearch}>{t('meetings.screen.clearSearch')}</button>
        ) : (
          <button type="submit" data-testid="meetings-search-submit" className="text-[11px] text-text-muted hover:text-foreground">⌘F</button>
        )}
      </form>
      {bannerNode}
      <div role="listbox" aria-label={t('meetings.title')} className="min-h-0 flex-1 overflow-y-auto pb-3" onKeyDown={onListKeys}>
        {catalogState === 'loading' && meetings.length === 0 ? (
          <EmptyState title={t('common.loading')} />
        ) : catalogState === 'error' && meetings.length === 0 ? (
          <EmptyState
            title={t('meetings.rpcUnavailable')}
            body={t('meetings.screen.catalogErrorBody')}
            action={<Button onClick={() => setCatalogReload((n) => n + 1)}>{t('common.retry')}</Button>}
          />
        ) : meetings.length === 0 && !searchApplied ? (
          <EmptyState
            testId="meetings-empty"
            title={t('meetings.empty')}
            body={t('meetings.screen.emptyBody')}
            action={(
              <div className="flex flex-wrap gap-1.5">
                <Button variant="primary" onClick={() => void handleStart({ record: true })}>{t('meetings.screen.startWithoutCalendar')}</Button>
                <Button onClick={() => fileRef.current?.click()}>{t('meetings.screen.importAudio')}</Button>
              </div>
            )}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            testId={searchApplied ? 'meetings-search-empty' : undefined}
            title={searchApplied ? t('meetings.searchEmpty') : bucket === 'today' ? t('meetings.screen.freeDay') : t('meetings.screen.bucketEmpty')}
            body={bucket === 'upcoming' ? t('meetings.screen.upcomingBody') : undefined}
          />
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <GroupLabel>{groupTitle(group)}</GroupLabel>
              {group.items.map((meeting) => {
                const badge = statusBadge(meeting, items)
                const dur = durationMs(meeting)
                return (
                  <ListRow
                    key={meeting.id}
                    testId={`meeting-row-${meeting.id}`}
                    selected={meeting.id === selectedId}
                    onClick={() => selectMeeting(meeting.id)}
                  >
                    <span className="w-10 shrink-0 pt-px text-[12px] tabular-nums text-text-muted">
                      {meeting.createdAt ? timeFmt.format(meeting.createdAt) : '—'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{meeting.title}</span>
                      <span className="block truncate text-[12px] text-text-muted">
                        {t(sourceKey(meeting))}
                        {dur ? ` · ${t('meetings.screen.minutes', { count: Math.max(1, Math.round(dur / 60000)) })}` : ''}
                        {pendingProposalCount(items, meeting.id) ? ` · ${t('meetings.screen.proposalsWaiting', { count: pendingProposalCount(items, meeting.id) })}` : ''}
                      </span>
                    </span>
                    <Badge tone={badge.tone}>{t(badge.key, { count: badge.count ?? 0 })}</Badge>
                  </ListRow>
                )
              })}
            </div>
          ))
        )}
      </div>
    </>
  )

  const agentView = nav.kind === 'agent' ? readiness.agents.find((a) => a.id === nav.id) ?? null : null

  const detailTabs = selected ? [
    { id: 'transcript' as const, label: isLive(selected) ? t('meetings.screen.liveTranscript') : t('meetings.screen.transcript') },
    { id: 'summary' as const, label: t('meetings.screen.summary') },
    { id: 'actions' as const, label: t('meetings.screen.actions'), count: meetingActions.length },
    { id: 'proposals' as const, label: t('meetings.proposals'), count: pendingProposalCount(items, selected.id) },
  ] : []

  const transcriptTab = selected ? (
    <div className="flex flex-col gap-3" data-testid="meeting-live-transcript">
      <EmptyState
        title={t(selected.status === 'completed' ? 'meetings.transcriptNone' : 'meetings.transcriptPending')}
        body={t('meetings.screen.transcriptBody')}
      />
      {meetingNotes.length ? (
        <div className="flex flex-col gap-1">
          <SectionLabel>{t('meetings.screen.manualNotes')}</SectionLabel>
          {meetingNotes.map((note) => (
            <div key={`${note.at}-${note.text}`} className="flex gap-2 text-[13px]">
              <span className="w-10 shrink-0 tabular-nums text-text-muted">{timeFmt.format(note.at)}</span>
              <span className="min-w-0 flex-1">{note.text}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div>
        <SectionLabel>{t('meetings.addManualNote')}</SectionLabel>
        <form className="flex gap-1.5" onSubmit={(event) => { event.preventDefault(); void handleManualNote() }}>
          <input
            data-testid="meetings-manual-note-text"
            value={noteText}
            placeholder={t('meetings.screen.notePlaceholder')}
            aria-label={t('meetings.addManualNote')}
            onChange={(event) => setNoteText(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-[6px] bg-foreground/[0.05] px-2 text-[13px] outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]"
          />
          <Button type="submit" data-testid="meetings-add-manual-note" disabled={!noteText.trim()}>{t('meetings.screen.add')}</Button>
        </form>
        <p className="pt-1 text-[11px] text-text-muted">{t('meetings.addManualNoteIntent')}</p>
      </div>
      <div>
        <button type="button" className="text-[12px] text-text-secondary hover:text-foreground" aria-expanded={showCorrection} onClick={() => setShowCorrection((v) => !v)}>
          {showCorrection ? '▾' : '▸'} {t('meetings.screen.correctionToggle')}
        </button>
        {showCorrection ? (
          <div className="mt-1.5 flex flex-col gap-1.5">
            <p className="text-[11px] text-text-muted">{t('meetings.correctIntent')}</p>
            <div className="flex gap-1.5">
              <input
                data-testid="meetings-correct-segment-id"
                value={segmentId}
                placeholder={t('meetings.screen.segmentId')}
                aria-label={t('meetings.screen.segmentId')}
                onChange={(event) => setSegmentId(event.target.value)}
                className="h-8 w-32 rounded-[6px] bg-foreground/[0.05] px-2 font-mono text-[12px] outline-none"
              />
              <input
                data-testid="meetings-correct-replacement"
                value={replacement}
                placeholder={t('meetings.screen.replacement')}
                aria-label={t('meetings.screen.replacement')}
                onChange={(event) => setReplacement(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-[6px] bg-foreground/[0.05] px-2 text-[13px] outline-none"
              />
              <Button data-testid="meetings-correct-segment" onClick={() => void handleCorrectSegment()}>{t('meetings.correctSegment')}</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  ) : null

  const summaryTab = selected ? (
    <div className="flex flex-col gap-3">
      <EmptyState
        title={selected.status === 'completed' ? t('meetings.screen.summaryDoneTitle') : t('meetings.screen.summaryPendingTitle')}
        body={selected.status === 'completed' ? t('meetings.screen.summaryDoneBody') : t('meetings.screen.summaryPendingBody')}
      />
      {selected.status !== 'completed' ? (
        <div>
          <Button variant="primary" data-testid="meetings-finalize" disabled={busy} onClick={() => void handleFinalize()}>{t('meetings.screen.finalize')}</Button>
          <p className="pt-1 text-[11px] text-text-muted">{t('meetings.finalizeIntent')}</p>
        </div>
      ) : null}
      <Card>
        <div className="text-[13px] font-medium">{t('meetings.screen.summaryNoteTitle')}</div>
        <p className="pb-2 text-[12px] text-text-secondary">{t('meetings.screen.summaryNoteBody')}</p>
        <Button onClick={() => void createProposal('create_note', t('meetings.screen.summaryNoteName', { title: selected.title }))}>
          {t('meetings.screen.summaryNoteAction')}
        </Button>
      </Card>
    </div>
  ) : null

  const pendingChecked = meetingActions.filter((row) => checkedActions.includes(row.id) && row.status === 'proposed').length
  const actionsTab = selected ? (
    <div className="flex flex-col gap-2">
      {meetingActions.length === 0 ? (
        <EmptyState title={t('meetings.screen.actionsEmptyTitle')} body={t('meetings.screen.actionsEmptyBody')} />
      ) : (
        <div className="flex flex-col gap-0.5">
          {meetingActions.map((row) => (
            <label key={row.id} className="flex items-start gap-2 rounded-[6px] px-2 py-1.5 hover:bg-foreground/[0.04]">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                disabled={row.status !== 'proposed' || approvingId === row.id}
                checked={checkedActions.includes(row.id) || row.status === 'applied' || row.status === 'approved'}
                onChange={(event) => setCheckedActions((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{row.title}</span>
                <span className="block text-[11px] text-text-muted">{t(`meetings.proposalStatus.${row.status}`, { defaultValue: row.status })}</span>
              </span>
              {row.revisionId ? (
                <Button variant="ghost" onClick={(event) => { event.preventDefault(); void handleOpenTarget(row) }}>{t('meetings.openTarget')}</Button>
              ) : null}
            </label>
          ))}
        </div>
      )}
      <form className="flex gap-1.5" onSubmit={(event) => { event.preventDefault(); void handleAddAction() }}>
        <input
          value={actionTitle}
          placeholder={t('meetings.screen.actionPlaceholder')}
          aria-label={t('meetings.screen.actionPlaceholder')}
          onChange={(event) => setActionTitle(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-[6px] bg-foreground/[0.05] px-2 text-[13px] outline-none placeholder:text-text-muted"
        />
        <Button type="submit" disabled={!actionTitle.trim()}>{t('meetings.screen.add')}</Button>
      </form>
      <div className="flex gap-1.5 pt-1">
        <Button variant="primary" disabled={pendingChecked === 0} onClick={() => void handleApproveChecked()}>
          {t('meetings.screen.createTasks', { count: pendingChecked })}
        </Button>
        <Button disabled={!shell || delegating} onClick={() => void handleDelegate()}>{t('meetings.screen.delegate')}</Button>
      </div>
    </div>
  ) : null

  const proposalsTab = selected ? (
    <div className="flex flex-col gap-3">
      <ProposalInbox
        proposals={meetingProposals}
        onApprove={(row) => void handleApprove(row)}
        onReject={(row) => void handleReject(row)}
        onOpenTarget={(row) => void handleOpenTarget(row)}
        pendingId={approvingId}
      />
      <form className="flex flex-wrap items-center gap-1.5" data-testid="meetings-create-form" onSubmit={(event) => { event.preventDefault(); void handleCreate() }}>
        <input
          data-testid="meetings-proposal-title"
          value={title}
          placeholder={t('meetings.proposalTitle')}
          aria-label={t('meetings.proposalTitle')}
          onChange={(event) => setTitle(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-[6px] bg-foreground/[0.05] px-2 text-[13px] outline-none placeholder:text-text-muted"
        />
        <select
          data-testid="meetings-proposal-kind"
          value={kind}
          aria-label={t('meetings.screen.proposalKind')}
          onChange={(event) => setKind(event.target.value as NativeProposalType)}
          className="h-8 rounded-[6px] bg-foreground/[0.05] px-2 text-[13px] outline-none"
        >
          <option value="create_task">{t('meetings.kindTask')}</option>
          <option value="create_note">{t('meetings.kindNote')}</option>
        </select>
        <Button type="submit" data-testid="meetings-create-proposal" disabled={!title.trim()}>{t('meetings.createProposal')}</Button>
      </form>
    </div>
  ) : null

  const recordingBar = selected && (isLive(selected) || selected.status === 'planned') ? (
    <div className="mx-4 mb-3 mt-auto flex flex-wrap items-center gap-3 rounded-[8px] bg-foreground/[0.05] px-3 py-2" data-testid="meetings-capture">
      {isLive(selected) ? (
        <>
          <span aria-hidden className={`size-2 rounded-full ${selected.status === 'capturing' ? 'bg-destructive' : 'bg-[var(--warning,#d9a13b)]'}`} />
          <span className="text-[12px]">{t('meetings.screen.mic')}</span>
          <span className="text-[11px] text-text-muted">{t('meetings.screen.sourceOff')}</span>
          <span className="text-[12px]">{t('meetings.screen.system')}</span>
          <span className="text-[11px] text-text-muted">{t('meetings.screen.sourceOff')}</span>
          <span className="ml-auto flex gap-1.5">
            {selected.status === 'capturing' ? (
              <Button data-testid="meetings-capture-pause" onClick={() => void handleCapture('pause')}>❚❚ {t('meetings.screen.pause')}</Button>
            ) : (
              <Button data-testid="meetings-capture-start" onClick={() => void handleCapture('start')}>▶ {t('meetings.screen.resume')}</Button>
            )}
            <Button variant="primary" data-testid="meetings-capture-stop" disabled={busy} onClick={() => void handleFinalize()}>■ {t('meetings.screen.finishAndSummarize')}</Button>
          </span>
        </>
      ) : (
        <>
          <span className="text-[12px] text-text-secondary">{t('meetings.captureIntent')}</span>
          <span className="ml-auto flex gap-1.5">
            <Button variant="primary" data-testid="meetings-capture-start" onClick={() => void handleCapture('start')}>● {t('meetings.screen.startRecording')}</Button>
            <Button onClick={() => fileRef.current?.click()}>{t('meetings.screen.importAudio')}</Button>
          </span>
        </>
      )}
    </div>
  ) : null

  const detailPanel = agentView ? (
    <div className="flex flex-col gap-3 p-5">
      <h2 className="text-[17px] font-semibold">{t(AGENT_LABEL[agentView.id] ?? agentView.id, { defaultValue: agentView.id })}</h2>
      <p className="text-[12px] text-text-secondary">{t('meetings.screen.agentBody')}</p>
      <AgentReadiness {...readiness} agents={[agentView]} />
    </div>
  ) : selected ? (
    <div className="flex min-h-full flex-col" data-testid="meeting-detail" data-entity-id={`call:${selected.id}`}>
      <header className="px-5 pt-4">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[17px] font-semibold">{selected.title}</h2>
          {selected.status === 'capturing' ? <Badge tone="danger">● {t('meetings.badge.rec')}</Badge> : null}
        </div>
        <p className="pt-0.5 text-[12px] text-text-muted">
          {selected.createdAt ? `${dayFmt.format(selected.createdAt)} ${timeFmt.format(selected.createdAt)} · ` : ''}
          {t(sourceKey(selected))} · {t(statusBadge(selected, items).key, { count: pendingProposalCount(items, selected.id) })}
        </p>
        <div className="pt-3">
          <Tabs tabs={detailTabs} value={tab} onChange={setTab} label={t('meetings.title')} />
        </div>
      </header>
      <div className="flex-1 px-5 pb-4 pt-2">
        {tab === 'transcript' ? transcriptTab : tab === 'summary' ? summaryTab : tab === 'actions' ? actionsTab : proposalsTab}
      </div>
      {recordingBar}
    </div>
  ) : (
    <div data-testid="meetings-selection-status">
      <EmptyState
        title={t(
          selectionError
            ? i18nKeyForManualError(selectionError)
            : selectedLoading
              ? 'common.loading'
              : selectedMissing
                ? 'meetings.meetingNotFound'
                : 'meetings.select',
        )}
        body={!selectedId ? t('meetings.screen.selectBody') : undefined}
        action={selectionError ? (
          <Button data-testid="meetings-selection-retry" onClick={() => setSelectionReload((n) => n + 1)}>{t('common.retry')}</Button>
        ) : selectedId ? (
          <Button data-testid="meetings-back-to-list" onClick={() => selectMeeting(null)}>{t('common.backToList')}</Button>
        ) : undefined}
      />
    </div>
  )

  const status = live ? (
    <>
      <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
      <span className="truncate">{t('meetings.screen.statusLive', { title: live.title })}</span>
    </>
  ) : (
    <>
      <span data-testid="meetings-native-catalog">{t('meetings.nativeCatalog')}</span>
      <span aria-hidden>·</span>
      <span>{t('meetings.rooms.undecided')}</span>
    </>
  )

  return (
    <ModeScreenLayout
      testId="meetings-page"
      navigator={navigator}
      list={listPanel}
      detail={detailPanel}
      status={status}
    />
  )
}

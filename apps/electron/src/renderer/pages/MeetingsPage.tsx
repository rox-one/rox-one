/**
 * Встречи — mode screen (navigator → list → detail) over LOCAL meetings:
 * microphone capture/import and Whisper transcription run on-device. Generated
 * analysis is a separate, explicitly started ordinary agent session and follows
 * the configured model/provider. Live rooms and system-audio capture are absent.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { formatHotkeyDisplay } from '@/lib/platform'
import {
  Badge,
  Button,
  EmptyState,
  GroupLabel,
  ListHeader,
  ListRow,
  ModeScreenLayout,
  useListKeys,
} from '@/components/mode-screen/ModeScreen'
import { clearRecorderError, meetingsApi, recordedMs, startRecording, useRecorder } from '@/lib/meetings/recorder'
import { newLocalId } from '@/lib/extra-screens/storage'
import type { LocalAsrEngine, LocalMeeting } from '../../shared/meetings-local'
import { LocalMeetingDetail, transcriptTone, type DetailTab } from './meetings/LocalMeetingDetail'
import { MeetingsSidebar } from './meetings/MeetingsSidebar'
import {
  formatDuration,
  groupLocalMeetings,
  inLocalBucket,
  isLiveMeeting,
  localBucketCounts,
  meetingMatches,
  meetingTime,
  normalizeQuery,
  transcriptPlainText,
  type LocalBucket,
  type LocalGroup,
} from './meetings/local-meetings-model'
import { getAppLocale } from '@rox/shared/i18n'
import { MeetingRequestTracker } from './meetings/request-state'
import { useTourSignals, useTourTarget } from '@/features/product-tour/runtime/hooks'
import { meetingsAutomationCapabilities } from '@/features/product-tour/adapters/work/meetings-automations'
import { useMeetingArtifactTour } from '@/features/product-tour/adapters/work/meetings-automations/useMeetingArtifactTour'

const ERROR_KEYS: Record<string, string> = {
  'mic-denied': 'meetings.local.err.micDenied',
  'mic-unavailable': 'meetings.local.err.micUnavailable',
  'recording-save-failed': 'meetings.local.err.recordingSave',
  'already-recording': 'meetings.local.err.alreadyRecording',
  'meeting-has-audio': 'meetings.local.err.hasAudio',
  'unsupported-format': 'meetings.local.err.format',
  'empty-file': 'meetings.local.err.emptyFile',
  'empty-recording': 'meetings.local.err.emptyRecording',
  'too-large': 'meetings.local.err.tooLarge',
  'engine-unavailable': 'meetings.local.tr.unavailableTitle',
  'summary-failed': 'meetings.local.err.summary',
  'trash-failed': 'meetings.local.err.trash',
  unavailable: 'meetings.local.err.unavailable',
}

export default function MeetingsPage(props: { selectedId?: string | null; workspaceId?: string | null }) {
  const { t, i18n } = useTranslation()
  const shell = useOptionalAppShellContext()
  const locale = i18n.resolvedLanguage || i18n.language || getAppLocale()
  const workspaceId = props.workspaceId ?? shell?.activeWorkspaceId ?? null
  const api = meetingsApi()
  const rec = useRecorder()
  const tourSignals = useTourSignals()
  const listTarget = useTourTarget('meetings.list')

  const [meetings, setMeetings] = useState<LocalMeeting[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(api ? 'loading' : 'error')
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null | undefined>(undefined)
  const [engine, setEngine] = useState<LocalAsrEngine | null>(null)
  const [reload, setReload] = useState(0)
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const routeBound = props.selectedId !== undefined
  const selectedId = routeBound ? props.selectedId ?? null : localSelectedId
  const selectMeeting = useCallback((id: string | null) => {
    if (routeBound) navigate(routes.view.meetings(id ?? undefined))
    else setLocalSelectedId(id)
  }, [routeBound])
  const [bucket, setBucket] = useState<LocalBucket>('all')
  const [tab, setTab] = useState<DetailTab>('overview')
  const [banner, setBanner] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [transcriptText, setTranscriptText] = useState<Record<string, string>>({})
  const [planning, setPlanning] = useState(false)
  const [planTitle, setPlanTitle] = useState('')
  const [planAt, setPlanAt] = useState('')
  const [planningPending, setPlanningPending] = useState(false)
  const planDraftRef = useRef({ title: planTitle, at: planAt })
  planDraftRef.current = { title: planTitle, at: planAt }
  const requestTracker = useRef(new MeetingRequestTracker()).current
  const catalogUpdatesRef = useRef<Map<string, LocalMeeting | null> | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const importRequestRef = useRef<string | null>(null)
  const [importRequestId, setImportRequestId] = useState<string | null>(null)
  const [cancelingImport, setCancelingImport] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [now, setNow] = useState(() => Date.now())

  // Only a committed workspace may publish reads or action receipts. Cleanup
  // invalidates the old visit even for A → B → A or an unmount without a rerender.
  useLayoutEffect(() => {
    requestTracker.setScope(workspaceId)
    catalogUpdatesRef.current = null
    setMeetings([])
    setLoadState(api ? 'loading' : 'error')
    setTranscriptText({})
    setLocalSelectedId(null)
    setBanner(null)
    setPlanning(false)
    setPlanTitle('')
    setPlanAt('')
    setPlanningPending(false)
    importRequestRef.current = null
    setImportRequestId(null)
    setCancelingImport(false)
    return () => { requestTracker.setScope(undefined) }
  }, [api, workspaceId, requestTracker])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!api) return
    const request = requestTracker.beginLatest('catalog', workspaceId)
    if (!request) return
    const updates = new Map<string, LocalMeeting | null>()
    catalogUpdatesRef.current = updates
    let cancelled = false
    setLoadState('loading')
    void api.list(workspaceId).then(
      (list) => {
        if (!cancelled && request.isCurrent()) {
          // A slower list snapshot cannot overwrite a newer pushed update or
          // deletion observed while this exact read was pending.
          const merged = new Map(list.map(meeting => [meeting.id, meeting]))
          for (const [id, meeting] of updates) {
            if (meeting) merged.set(id, meeting)
            else merged.delete(id)
          }
          setMeetings([...merged.values()]); setLoadedWorkspaceId(workspaceId); setLoadState('ready')
        }
      },
      () => { if (!cancelled && request.isCurrent()) setLoadState('error') },
    ).finally(() => { if (catalogUpdatesRef.current === updates) catalogUpdatesRef.current = null })
    void api.engine().then((e) => { if (!cancelled && request.isCurrent()) setEngine(e) }, () => {})
    return () => { cancelled = true; request.finish() }
  }, [api, workspaceId, reload, requestTracker])

  useEffect(() => {
    if (!api) return
    let cancelled = false
    const unsubscribe = window.electronAPI.onVoiceChanged?.(() => {
      void api.engine().then((next) => { if (!cancelled) setEngine(next) }, () => {})
    })
    return () => { cancelled = true; unsubscribe?.() }
  }, [api])

  // Main pushes every change (recording state, ASR progress, attachments…).
  useEffect(() => {
    if (!api) return
    const unsubscribe = api.onChanged(({ id }) => {
      const request = requestTracker.beginLatest(`update:${id}`, workspaceId)
      if (!request) return
      void api.get(id).then((m) => {
        if (!request.isCurrent()) return
        if (workspaceId && m?.workspaceId && m.workspaceId !== workspaceId) return
        catalogUpdatesRef.current?.set(id, m)
        setMeetings((current) => {
          if (!m) return current.filter((x) => x.id !== id)
          if (workspaceId && m.workspaceId && m.workspaceId !== workspaceId) return current
          const exists = current.some((x) => x.id === id)
          return exists ? current.map((x) => (x.id === id ? m : x)) : [m, ...current]
        })
      }, () => {}).finally(() => request.finish())
    })
    return () => {
      unsubscribe()
      // Subscription requests never survive their effect owner, including a
      // remount in the same committed workspace.
      requestTracker.cancelAll()
    }
  }, [api, workspaceId, requestTracker])

  useEffect(() => {
    if (rec.error) {
      setBanner(rec.error)
      clearRecorderError()
    }
  }, [rec.error])

  const upsert = useCallback((m: LocalMeeting) => {
    setMeetings((current) => (current.some((x) => x.id === m.id) ? current.map((x) => (x.id === m.id ? m : x)) : [m, ...current]))
  }, [])

  // Search also covers transcripts: load them lazily once a query is typed.
  const terms = useMemo(() => normalizeQuery(query), [query])
  useEffect(() => {
    if (!api || terms.length === 0) return
    const missing = meetings.filter((m) => m.transcript.status === 'done' && transcriptText[m.id] === undefined)
    if (missing.length === 0) return
    const request = requestTracker.beginLatest('transcripts', workspaceId)
    if (!request) return
    let cancelled = false
    void Promise.all(missing.map(async (m) => [m.id, transcriptPlainText((await api.readTranscript(m.id))?.segments ?? [])] as const)).then((pairs) => {
      if (!cancelled && request.isCurrent()) setTranscriptText((current) => ({ ...current, ...Object.fromEntries(pairs) }))
    }, () => { if (!cancelled && request.isCurrent()) setBanner('unavailable') })
    return () => { cancelled = true; request.finish() }
  }, [api, terms, meetings, transcriptText, workspaceId, requestTracker])

  const counts = useMemo(() => localBucketCounts(meetings, now), [meetings, now])
  const visible = useMemo(
    () => meetings.filter((m) => inLocalBucket(m, bucket, now) && meetingMatches(m, terms, transcriptText[m.id])),
    [meetings, bucket, now, terms, transcriptText],
  )
  const groups = useMemo(() => groupLocalMeetings(visible, now), [visible, now])
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const selected = useMemo(() => meetings.find((m) => m.id === selectedId) ?? null, [meetings, selectedId])
  const selectedMissing = !!selectedId && !selected && loadState === 'ready'
  const artifactTour = useMeetingArtifactTour(selected, tab)

  useEffect(() => {
    const capabilities = meetingsAutomationCapabilities({
      surface: 'meetings', apiAvailable: !!api, workspaceId, selectedId,
      meeting: loadedWorkspaceId === workspaceId ? selected : null,
      loadState: loadState === 'ready' && loadedWorkspaceId !== workspaceId ? 'loading' : loadState,
    })
    const cleanupAvailable = tourSignals.capability('meetings.available', capabilities['meetings.available']!)
    const cleanupArtifact = tourSignals.capability('meeting.artifact-present', capabilities['meeting.artifact-present']!)
    return () => { cleanupAvailable(); cleanupArtifact() }
  }, [tourSignals, api, workspaceId, selectedId, selected, loadState, loadedWorkspaceId])

  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }), [locale])

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

  async function handleRecord() {
    const request = requestTracker.begin('record', workspaceId)
    if (!request) return
    setBanner(null)
    const title = t('meetings.local.defaultTitle', { date: `${dayFmt.format(Date.now())} ${timeFmt.format(Date.now())}` })
    try {
      const result = await startRecording({ title, workspaceId })
      if (!request.isCurrent()) return
      if (!result.ok) {
        setBanner(result.code)
        return
      }
      upsert(result.meeting)
      selectMeeting(result.meeting.id)
      setTab('overview')
    } catch {
      if (request.isCurrent()) setBanner('unavailable')
    } finally {
      request.finish()
    }
  }

  async function handleImport(path?: string) {
    if (!api || importRequestRef.current) return
    const request = requestTracker.begin('import', workspaceId)
    if (!request) return
    setBanner(null)
    const requestId = newLocalId('import')
    importRequestRef.current = requestId
    setImportRequestId(requestId)
    setCancelingImport(false)
    try {
      const result = await api.importAudio({ requestId, workspaceId, path })
      if (!request.isCurrent()) return
      if (!result) return
      if (!result.ok) {
        setBanner(result.code)
        return
      }
      upsert(result.value)
      selectMeeting(result.value.id)
      setTab('transcript')
    } catch {
      if (request.isCurrent()) setBanner('unavailable')
    } finally {
      if (request.finish() && importRequestRef.current === requestId) {
        importRequestRef.current = null
        setImportRequestId(null)
        setCancelingImport(false)
      }
    }
  }

  async function cancelImport() {
    if (!api || !importRequestId) return
    const request = requestTracker.begin('cancel-import', workspaceId)
    if (!request) return
    try {
      if (await api.cancelImport(importRequestId) && request.isCurrent()) setCancelingImport(true)
    } catch {
      if (request.isCurrent()) setBanner('unavailable')
    } finally {
      request.finish()
    }
  }

  async function handlePlan() {
    if (!api || !planTitle.trim()) return
    const request = requestTracker.begin('plan', workspaceId)
    if (!request) return
    const submitted = { title: planTitle, at: planAt }
    const scheduledAt = submitted.at ? new Date(submitted.at).getTime() : undefined
    setPlanningPending(true)
    try {
      const m = await api.create({ title: submitted.title.trim(), workspaceId, scheduledAt: Number.isFinite(scheduledAt) ? scheduledAt : undefined })
      if (!request.isCurrent()) return
      upsert(m)
      selectMeeting(m.id)
      // A successful old submission may clear only its own unchanged fields.
      if (planDraftRef.current.title === submitted.title && planDraftRef.current.at === submitted.at) setPlanning(false)
      setPlanTitle(current => current === submitted.title ? '' : current)
      setPlanAt(current => current === submitted.at ? '' : current)
    } catch {
      if (request.isCurrent()) setBanner('unavailable')
    } finally {
      if (request.finish()) setPlanningPending(false)
    }
  }

  const groupTitle = (group: LocalGroup) => {
    switch (group.kind) {
      case 'now': return t('meetings.screen.groupNow')
      case 'planned': return t('meetings.screen.groupPlanned')
      case 'today': return t('meetings.screen.groupToday')
      case 'yesterday': return t('meetings.screen.groupYesterday')
      default: return dayFmt.format(group.day ?? 0)
    }
  }

  const bucketTitle: Record<LocalBucket, string> = {
    all: t('meetings.screen.all'),
    today: t('meetings.screen.today'),
    upcoming: t('meetings.screen.upcoming'),
    past: t('meetings.screen.past'),
    live: t('meetings.screen.live'),
    needsAction: t('meetings.local.needsAction'),
  }

  const navigator = (
    <MeetingsSidebar bucket={bucket} counts={counts} engine={engine} onBucketSelect={setBucket} onConnectCalendar={() => navigate(routes.view.connections())} />
  )

  const bannerNode = banner ? (
    <div role="alert" data-testid="meetings-error" className="mx-3 mt-2 flex items-start gap-2 rounded-[var(--radius-card)] bg-destructive/10 px-2 py-1 text-[12px] text-destructive">
      <span className="min-w-0 flex-1">{t(ERROR_KEYS[banner] ?? 'meetings.local.err.generic', { code: banner })}</span>
      <button type="button" aria-label={t('common.close')} className="shrink-0 hover:underline" onClick={() => setBanner(null)}>×</button>
    </div>
  ) : null

  const busyRecording = rec.status !== 'idle'
  const listPanel = (
    <div
      className={cn('flex min-h-0 flex-1 flex-col', dropActive && 'bg-accent/[0.05] ring-1 ring-inset ring-accent')}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropActive(true) } }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropActive(false)
        const file = e.dataTransfer.files[0]
        const path = file ? window.electronAPI.getFilePath?.(file) : null
        if (path) void handleImport(path)
      }}
    >
      <ListHeader
        title={bucketTitle[bucket]}
        subtitle={dayFmt.format(now)}
        actions={(
          <>
            <Button variant="ghost" data-testid="meetings-plan" aria-label={t('meetings.local.plan')} title={t('meetings.local.plan')} onClick={() => setPlanning((v) => !v)}>+</Button>
            <Button data-testid="meetings-import" disabled={!api || !!importRequestId} onClick={() => void handleImport()}>{t('meetings.screen.importAudio')}</Button>
            {importRequestId ? (
              <Button data-testid="meetings-cancel-import" disabled={cancelingImport} onClick={() => void cancelImport()}>
                {t(cancelingImport ? 'meetings.local.importCanceling' : 'meetings.local.importCancel')}
              </Button>
            ) : null}
            <Button variant="primary" data-testid="meetings-start" disabled={!api || busyRecording} onClick={() => void handleRecord()}>
              <span aria-hidden className={cn('size-1.5 rounded-full bg-current', busyRecording && 'animate-pulse')} />
              {busyRecording ? t('meetings.local.recordingNow', { time: formatDuration(recordedMs(rec)) }) : t('meetings.screen.startRecording')}
            </Button>
          </>
        )}
      />
      {planning ? (
        <form className="mx-3 mt-1 flex items-center gap-2" data-testid="meetings-plan-form" onSubmit={(e) => { e.preventDefault(); void handlePlan() }}>
          <input autoFocus value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} placeholder={t('meetings.local.planTitle')} aria-label={t('meetings.local.planTitle')} className="h-7 min-w-0 flex-1 rounded-[var(--radius-control)] bg-foreground/[0.05] px-2 text-[13px] outline-none placeholder:text-text-muted" />
          <input type="datetime-local" value={planAt} onChange={(e) => setPlanAt(e.target.value)} aria-label={t('meetings.local.planAt')} className="h-7 rounded-[var(--radius-control)] bg-foreground/[0.05] px-2 text-[12px] outline-none" />
          <Button type="submit" disabled={!planTitle.trim() || planningPending}>{t('meetings.screen.add')}</Button>
        </form>
      ) : null}
      <div className="mx-3 mt-1 flex items-center gap-2 rounded-[var(--radius-control)] bg-foreground/[0.05] px-2" data-testid="meetings-search">
        <span aria-hidden className="text-text-muted">⌕</span>
        <input
          ref={searchRef}
          data-testid="meetings-search-query"
          value={query}
          placeholder={t('meetings.local.searchPlaceholder')}
          aria-label={t('meetings.local.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }}
          className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-muted"
        />
        {query ? <button type="button" className="text-[11px] text-text-muted hover:text-foreground" onClick={() => setQuery('')}>{t('meetings.screen.clearSearch')}</button> : <span className="text-[11px] text-text-muted">{formatHotkeyDisplay('mod+f')}</span>}
      </div>
      {bannerNode}
      <div ref={listTarget} role="listbox" aria-label={t('meetings.title')} className="min-h-0 flex-1 overflow-y-auto pb-3" onKeyDown={onListKeys} data-testid="meetings-list">
        {loadState === 'loading' && meetings.length === 0 ? (
          <EmptyState title={t('common.loading')} />
        ) : loadState === 'error' ? (
          <EmptyState title={t('meetings.local.err.unavailable')} action={api ? <Button onClick={() => setReload((n) => n + 1)}>{t('common.retry')}</Button> : undefined} />
        ) : meetings.length === 0 ? (
          <EmptyState testId="meetings-empty" title={t('meetings.empty')} body={t('meetings.local.emptyBody')} />
        ) : visible.length === 0 ? (
          <EmptyState
            testId={terms.length ? 'meetings-search-empty' : 'meetings-bucket-empty'}
            title={terms.length ? t('meetings.local.noMatches') : bucket === 'today' ? t('meetings.screen.freeDay') : t('meetings.screen.bucketEmpty')}
            body={bucket === 'upcoming' && !terms.length ? t('meetings.local.upcomingBody') : undefined}
          />
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <GroupLabel>{groupTitle(group)}</GroupLabel>
              {group.items.map((m) => {
                const tr = transcriptTone(m)
                const live = isLiveMeeting(m)
                return (
                  <ListRow key={m.id} testId={`meeting-row-${m.id}`} selected={m.id === selectedId} onClick={() => selectMeeting(m.id)}>
                    <span className="w-10 shrink-0 pt-px text-[12px] tabular-nums text-text-muted">{timeFmt.format(meetingTime(m))}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.title}</span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {live
                          ? (rec.meetingId === m.id ? formatDuration(recordedMs(rec)) : t('meetings.local.recShort'))
                          : m.durationMs ? formatDuration(m.durationMs) : m.status === 'planned' ? `${t('meetings.badge.planned')} · ${dayFmt.format(meetingTime(m))}` : '—'}
                        {m.participants.length ? ` · ${m.participants.slice(0, 3).join(', ')}` : ''}
                        {m.documents.length ? ` · ${t('meetings.local.docsCount', { count: m.documents.length })}` : ''}
                      </span>
                    </span>
                    {live ? <Badge tone="danger">● {t('meetings.local.recShort')}</Badge> : m.audio || m.transcript.status !== 'none' ? <Badge tone={tr.tone}>{t(tr.key, { progress: m.transcript.progress })}</Badge> : null}
                  </ListRow>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )

  const detailPanel = selected ? (
    <div ref={artifactTour.ref} className="min-h-full">
    <LocalMeetingDetail
      key={selected.id}
      meeting={selected}
      workspaceId={workspaceId}
      engine={engine}
      tab={tab}
      onTab={(nextTab) => { artifactTour.open(nextTab); setTab(nextTab) }}
      onChanged={upsert}
      onBanner={setBanner}
      onTrashed={() => { setMeetings((current) => current.filter((x) => x.id !== selected.id)); selectMeeting(null) }}
    />
    </div>
  ) : selectedMissing ? (
    <EmptyState
      testId="meetings-selection-status"
      title={t('meetings.meetingNotFound')}
      action={<Button data-testid="meetings-back-to-list" onClick={() => selectMeeting(null)}>{t('common.backToList')}</Button>}
    />
  ) : selectedId ? (
    <EmptyState testId="meetings-selection-status" title={t('common.loading')} />
  ) : (
    // Nothing selected: one short hint, no repeated headline or buttons.
    <div className="flex h-full items-center justify-center px-6" data-testid="meetings-selection-status">
      <p className="max-w-[320px] text-center text-[12px] text-text-muted">
        {meetings.length ? t('meetings.local.selectHint') : t('meetings.local.firstHint')}
      </p>
    </div>
  )

  return <ModeScreenLayout testId="meetings-page" navigator={navigator} list={listPanel} detail={detailPanel} />
}

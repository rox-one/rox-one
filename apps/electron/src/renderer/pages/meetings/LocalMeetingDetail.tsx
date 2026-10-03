/**
 * Встречи — detail of one local meeting: Обзор · Запись · Транскрипт ·
 * Решения · Задачи · Документы. Audio plays from the meeting folder; the
 * transcript comes from the local whisper.cpp run; decisions live in the
 * shared «Решения» log (source = this meeting); action items become tasks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Play } from 'lucide-react'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { Badge, Button, EmptyState, SectionLabel, Tabs, type Tone } from '@/components/mode-screen/ModeScreen'
import { extractJsonBlock, readAgentRun, startAgentRun } from '@/lib/extra-screens/agent-run'
import { newLocalId, subscribeWorkspaceJson } from '@/lib/extra-screens/storage'
import { createPersonalTask } from '@/lib/extra-screens/personal-task-bridge'
import {
  DECISIONS_NS,
  loadDecisions,
  removeDecisionLessons,
  saveDecisions,
  syncDecisionLessons,
} from '../extra-screens/decisions/decisions-store'
import { candidateToDecision, type Decision, type DecisionCandidate, type DecisionsData } from '../extra-screens/decisions/decisions-model'
import {
  pauseRecording,
  recordedMs,
  resumeRecording,
  startRecording,
  stopRecording,
  useRecorder,
  meetingsApi,
} from '@/lib/meetings/recorder'
import { formatRecClock } from '@/components/meetings/MeetingRecordingIndicator'
import { MEETING_SOURCE_SEEK_SESSION_KEY } from '../../../shared/meetings-local'
import { MEETING_PROFILE_IDS, type MeetingProfileId } from '@rox/shared/meeting-agents'
import type { LocalAsrEngine, LocalMeeting, LocalMeetingAction, LocalTranscript, LocalTranscriptSegmentPatch } from '../../../shared/meetings-local'
import {
  activeSegmentIndex,
  buildSummaryPrompt,
  filterSegments,
  formatBytes,
  formatDuration,
  meetingTime,
  openActionCount,
  parseSummaryExtraction,
} from './local-meetings-model'

export type DetailTab = 'overview' | 'recording' | 'transcript' | 'decisions' | 'actions' | 'documents'

const input = 'h-7 min-w-0 rounded-[6px] bg-foreground/[0.05] px-2 text-[13px] outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]'

export function transcriptTone(m: LocalMeeting): { tone: Tone; key: string } {
  switch (m.transcript.status) {
    case 'done': return { tone: 'success', key: 'meetings.local.tr.done' }
    case 'running': return { tone: 'info', key: 'meetings.local.tr.running' }
    case 'queued': return { tone: 'info', key: 'meetings.local.tr.queued' }
    case 'partial': return { tone: 'warning', key: 'meetings.local.tr.partial' }
    case 'cancelled': return { tone: 'muted', key: 'meetings.local.tr.cancelled' }
    case 'failed': return { tone: 'danger', key: 'meetings.local.tr.failed' }
    case 'unavailable': return { tone: 'warning', key: 'meetings.local.tr.unavailable' }
    default: return { tone: 'muted', key: m.audio ? 'meetings.local.tr.none' : 'meetings.local.tr.noAudio' }
  }
}

function useDecisionsData(workspaceId: string | null): [DecisionsData, (next: DecisionsData) => void] {
  const [data, setData] = useState<DecisionsData>(() => loadDecisions(workspaceId))
  useEffect(() => {
    setData(loadDecisions(workspaceId))
    return subscribeWorkspaceJson(DECISIONS_NS, workspaceId, () => setData(loadDecisions(workspaceId)))
  }, [workspaceId])
  const save = useCallback((next: DecisionsData) => {
    setData(next)
    saveDecisions(workspaceId, next)
  }, [workspaceId])
  return [data, save]
}

export function LocalMeetingDetail(props: {
  meeting: LocalMeeting
  workspaceId: string | null
  engine: LocalAsrEngine | null
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  onChanged: (meeting: LocalMeeting) => void
  onBanner: (code: string | null) => void
  onTrashed: () => void
}) {
  const { meeting: m, workspaceId, engine, tab, onTab, onChanged, onBanner } = props
  const { t, i18n } = useTranslation()
  const api = meetingsApi()
  const rec = useRecorder()
  const currentMeetingId = useRef(m.id)
  currentMeetingId.current = m.id
  const locale = i18n.resolvedLanguage || i18n.language
  const language: 'ru' | 'en' = locale.startsWith('ru') ? 'ru' : 'en'
  const [recipeSlash, setRecipeSlash] = useState('')
  useEffect(() => { setRecipeSlash('') }, [m.id])
  const recordingThis = rec.meetingId === m.id && rec.status !== 'idle'
  const [, tick] = useState(0)
  useEffect(() => {
    if (!recordingThis || rec.status !== 'recording') return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [recordingThis, rec.status])

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }), [locale])
  const shortFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), [locale])

  const update = useCallback(async (patch: Parameters<NonNullable<typeof api>['update']>[1]) => {
    if (!api) return null
    const next = await api.update(m.id, patch)
    if (next) onChanged(next)
    return next
  }, [api, m.id, onChanged])

  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playMs, setPlayMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [mediaMs, setMediaMs] = useState(0)
  const [segmentEdits, setSegmentEdits] = useState<Record<string, { speakerId: string; start: string; end: string }>>({})
  const [segmentEditError, setSegmentEditError] = useState<string | null>(null)
  const [cancelingTranscript, setCancelingTranscript] = useState(false)
  const [importRequestId, setImportRequestId] = useState<string | null>(null)
  const [cancelingImport, setCancelingImport] = useState(false)
  const importRequestRef = useRef<string | null>(null)
  // MediaRecorder webm has no duration header (Infinity) — fall back to the stored duration.
  const totalMs = mediaMs || m.durationMs
  const audioKey = m.audio ? `${m.id}:${m.audio.file}:${m.audio.bytes}` : null
  useEffect(() => {
    setAudioUrl(null)
    setPlayMs(0)
    setPlaying(false)
    setMediaMs(0)
    if (!api || !audioKey) return
    let cancelled = false
    let url: string | null = null
    void api.readAudio(m.id).then((res) => {
      if (cancelled) return
      if (!res) {
        onBanner('unavailable')
        return
      }
      url = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: res.mimeType }))
      setAudioUrl(url)
    }).catch(() => {
      if (!cancelled) onBanner('unavailable')
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [api, audioKey, m.id, onBanner])

  const seek = useCallback((ms: number) => {
    const el = audioRef.current
    if (!el) return
    try {
      const duration = Number.isFinite(el.duration) ? el.duration * 1000 : totalMs
      el.currentTime = Math.min(Math.max(ms, 0), duration || Math.max(ms, 0)) / 1000
      void el.play().catch(() => onBanner('unavailable'))
    } catch {
      onBanner('unavailable')
    }
  }, [onBanner, totalMs])

  // ── Transcript ──
  const [transcript, setTranscript] = useState<LocalTranscript | null>(null)
  const [revisionPreview, setRevisionPreview] = useState<{ revision: number; transcript: LocalTranscript } | null>(null)
  const [loadingRevision, setLoadingRevision] = useState<number | null>(null)
  const [restoringRevision, setRestoringRevision] = useState(false)
  const [query, setQuery] = useState('')
  const trKey = ['done', 'partial', 'cancelled', 'failed'].includes(m.transcript.status)
    ? `${m.id}:${m.transcript.finishedAt ?? 0}:${m.transcript.generation ?? 0}`
    : null
  useEffect(() => {
    setTranscript(null)
    setSegmentEdits({})
    setSegmentEditError(null)
    setRevisionPreview(null)
    setLoadingRevision(null)
    setRestoringRevision(false)
    if (!api || !trKey) return
    let cancelled = false
    void api.readTranscript(m.id).then((res) => { if (!cancelled) setTranscript(res) }).catch(() => {
      if (!cancelled) onBanner('unavailable')
    })
    return () => { cancelled = true }
  }, [api, trKey, m.id, onBanner])

  const saveSegmentEdit = useCallback(async (segmentId: string, base: { startMs: number; endMs: number; speakerId?: string | null }) => {
    if (!api || !transcript) return
    const edit = segmentEdits[segmentId]
    if (!edit) return
    const startSeconds = edit.start.trim() === '' ? base.startMs / 1000 : Number(edit.start)
    const endSeconds = edit.end.trim() === '' ? base.endMs / 1000 : Number(edit.end)
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds < startSeconds) {
      setSegmentEditError('invalid-timecode')
      return
    }
    const speakerId = edit.speakerId.trim() || null
    const patch: LocalTranscriptSegmentPatch = {}
    const startMs = Math.round(startSeconds * 1000)
    const endMs = Math.round(endSeconds * 1000)
    if (startMs !== base.startMs) patch.startMs = startMs
    if (endMs !== base.endMs) patch.endMs = endMs
    if ((base.speakerId ?? null) !== speakerId) patch.speakerId = speakerId
    if (Object.keys(patch).length === 0) {
      setSegmentEdits((current) => { const next = { ...current }; delete next[segmentId]; return next })
      return
    }
    const result = await api.updateTranscriptSegment(m.id, { expectedRevision: transcript.revision, segmentId, patch }).catch(() => null)
    if (!result || !result.ok) {
      setSegmentEditError(result?.code === 'revision-conflict' ? 'revision-conflict' : result?.code ?? 'unavailable')
      return
    }
    setTranscript(result.value)
    setSegmentEdits((current) => { const next = { ...current }; delete next[segmentId]; return next })
    setSegmentEditError(null)
  }, [api, m.id, segmentEdits, transcript])
  const viewTranscriptRevision = async (revision: number) => {
    if (!api) return
    const meetingId = m.id
    setLoadingRevision(revision)
    try {
      const previous = await api.readTranscriptRevision(meetingId, revision)
      if (currentMeetingId.current !== meetingId) return
      if (previous) setRevisionPreview({ revision, transcript: previous })
      else onBanner('unavailable')
    } catch {
      if (currentMeetingId.current === meetingId) onBanner('unavailable')
    } finally {
      if (currentMeetingId.current === meetingId) setLoadingRevision(null)
    }
  }
  const restoreTranscriptRevision = async () => {
    if (!api || !transcript || !revisionPreview || restoringRevision) return
    const meetingId = m.id
    setRestoringRevision(true)
    const result = await api.restoreTranscriptRevision(meetingId, {
      expectedRevision: transcript.revision,
      restoreRevision: revisionPreview.revision,
    }).catch(() => null)
    if (currentMeetingId.current !== meetingId) return
    setRestoringRevision(false)
    if (!result || !result.ok) {
      setSegmentEditError(result?.code === 'revision-conflict' ? 'revision-conflict' : result?.code ?? 'unavailable')
      return
    }
    setTranscript(result.value)
    setRevisionPreview(null)
    setSegmentEdits({})
    setSegmentEditError(null)
    const updatedMeeting = await api.get(meetingId).catch(() => null)
    if (updatedMeeting) onChanged(updatedMeeting)
  }

  const cancelTranscription = async () => {
    if (!api || cancelingTranscript) return
    setCancelingTranscript(true)
    const result = await api.cancelTranscription(m.id).catch(() => null)
    setCancelingTranscript(false)
    if (result?.ok) onChanged(result.value)
    else onBanner(result?.code ?? 'unavailable')
  }

  const segments = useMemo(() => filterSegments(transcript?.segments ?? [], query), [transcript, query])
  const transcriptById = useMemo(() => new Map((transcript?.segments ?? []).map((segment) => [segment.id, segment])), [transcript])
  const renderSourceLinks = (ids?: readonly string[]) => {
    const sourceSegments = [...new Set(ids ?? [])].flatMap((id) => {
      const segment = transcriptById.get(id)
      return segment ? [segment] : []
    })
    if (sourceSegments.length === 0) return null
    return (
      <div className="flex flex-wrap gap-1" aria-label={t('meetings.local.analysisSource')}>
        {sourceSegments.map((segment) => (
          <Button key={segment.id} variant="ghost" onClick={() => seek(segment.startMs)} disabled={!audioUrl}>
            {formatRecClock(segment.startMs)}
          </Button>
        ))}
      </div>
    )
  }
  const activeIdx = useMemo(() => activeSegmentIndex(transcript?.segments ?? [], playMs), [transcript, playMs])
  const activeId = activeIdx >= 0 ? transcript?.segments[activeIdx]?.id : undefined
  useEffect(() => {
    if (!audioUrl) return
    try {
      const value = sessionStorage.getItem(MEETING_SOURCE_SEEK_SESSION_KEY)
      if (!value) return
      const anchor = JSON.parse(value) as { meetingId?: unknown; segmentId?: unknown; startMs?: unknown }
      if (anchor.meetingId !== m.id) return
      sessionStorage.removeItem(MEETING_SOURCE_SEEK_SESSION_KEY)
      if (typeof anchor.startMs !== 'number' || !Number.isFinite(anchor.startMs) || anchor.startMs < 0) return
      const segment = typeof anchor.segmentId === 'string' ? transcriptById.get(anchor.segmentId) : undefined
      seek(segment?.startMs ?? anchor.startMs)
    } catch {
      try {
        sessionStorage.removeItem(MEETING_SOURCE_SEEK_SESSION_KEY)
      } catch {
        // Storage may be unavailable; playback remains usable without cross-page seeking.
      }
    }
  }, [audioUrl, m.id, transcriptById, seek])

  // ── Decisions (shared «Решения» log, source = this meeting) ──
  const [decisionsData, saveDecisionsData] = useDecisionsData(workspaceId)
  const isThis = (source: { kind: string; id?: string }) => source.kind === 'meeting' && source.id === m.id
  const decisions = decisionsData.decisions.filter((d) => isThis(d.source))
  const candidates = decisionsData.candidates.filter((c) => isThis(c.source))
  const commitDecision = useCallback(async (decision: Decision) => {
    const current = loadDecisions(workspaceId)
    const exists = current.decisions.some((d) => d.id === decision.id)
    const updated = { ...decision, updatedAt: Date.now() }
    saveDecisionsData({ ...current, decisions: exists ? current.decisions.map((d) => (d.id === decision.id ? updated : d)) : [updated, ...current.decisions] })
    if (!workspaceId) return
    const syncedRules = await syncDecisionLessons(workspaceId, updated)
    const after = loadDecisions(workspaceId)
    saveDecisionsData({ ...after, decisions: after.decisions.map((d) => (d.id === decision.id ? { ...d, syncedRules } : d)) })
  }, [saveDecisionsData, workspaceId])

  // ── Generated summary via the app's agent (explicit, read-only session) ──
  const runId = m.summaryRun?.sessionId
  useEffect(() => {
    if (!runId || !api) return
    let cancelled = false
    const poll = async () => {
      const run = await readAgentRun(runId)
      if (cancelled || (run.exists && (run.processing || !run.text))) return
      const fresh = await api.get(m.id)
      if (!fresh || fresh.summaryRun?.sessionId !== runId) return
      const sourceTranscript = await api.readTranscript(m.id)
      if (!sourceTranscript || sourceTranscript.revision !== fresh.summaryRun.transcriptRevision || sourceTranscript.revision !== m.summaryRun?.transcriptRevision) {
        await api.update(m.id, { summaryRun: undefined })
        onBanner('summary-failed')
        return
      }
      const allowedIds = new Set(sourceTranscript.segments.map((segment) => segment.id))
      const parsed = run.exists ? parseSummaryExtraction(extractJsonBlock(run.text), [...allowedIds]) : null
      const validIds = (ids: readonly string[]) => [...new Set(ids)].filter((id) => allowedIds.has(id))
      if (!parsed) {
        await api.update(m.id, { summaryRun: undefined })
        onBanner('summary-failed')
        return
      }
      const now = Date.now()
      const known = new Set(fresh.actions.map((a) => a.text.trim().toLocaleLowerCase()))
      const newActions: LocalMeetingAction[] = parsed.actions.flatMap((action) => {
        const sourceSegmentIds = validIds(action.sourceSegmentIds)
        const key = action.text.trim().toLocaleLowerCase()
        if (!action.text.trim() || !sourceSegmentIds.length || known.has(key)) return []
        known.add(key)
        return [{ id: newLocalId('act'), text: action.text.trim(), done: false, generated: true, sourceSegmentIds, sourceTranscriptRevision: sourceTranscript.revision, createdAt: now }]
      })
      const summarySourceSegmentIds = validIds(parsed.summarySourceSegmentIds)
      const questions = parsed.questions.flatMap((question) => {
        const sourceSegmentIds = validIds(question.sourceSegmentIds)
        return question.text.trim() && sourceSegmentIds.length
          ? [{ id: newLocalId('question'), text: question.text.trim(), sourceSegmentIds, createdAt: now }]
          : []
      })
      await api.update(m.id, {
        summaryRun: undefined,
        summary: parsed.summary && summarySourceSegmentIds.length
          ? { text: parsed.summary, generated: true, sessionId: runId, sourceSegmentIds: summarySourceSegmentIds, sourceTranscriptRevision: sourceTranscript.revision, questions, updatedAt: now }
          : fresh.summary,
        actions: [...fresh.actions, ...newActions],
      })
      if (parsed.decisions.length) {
        const current = loadDecisions(workspaceId)
        const extractionId = `mtg-${m.id}`
        const next: DecisionCandidate[] = parsed.decisions.flatMap((d, i) => {
          const sourceSegmentIds = validIds(d.sourceSegmentIds)
          const sourceSegment = sourceTranscript.segments.find((segment) => segment.id === sourceSegmentIds[0])
          if (!sourceSegment) return []
          const source = { kind: 'meeting' as const, id: m.id, label: fresh.title, segmentId: sourceSegment.id, startMs: sourceSegment.startMs }
          return [{ id: `${extractionId}-${i}`, title: d.title, why: d.why, who: d.who, rejected: [], source, extractionId }]
        })
        const previousGenerated = (candidate: DecisionCandidate) => candidate.source.kind === 'meeting' && candidate.source.id === m.id && candidate.extractionId.startsWith('mtg-')
        saveDecisionsData({ ...current, candidates: [...next, ...current.candidates.filter((candidate) => !previousGenerated(candidate))] })
      }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 4000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [runId, api, m, update, onBanner, workspaceId, saveDecisionsData])

  const generateSummary = async () => {
    if (!workspaceId || !transcript?.segments.length) return
    onBanner(null)
    try {
      const prompt = buildSummaryPrompt({
        title: m.title,
        participants: m.participants,
        segments: transcript.segments.map(({ id, startMs, endMs, text }) => ({ id, startMs, endMs, text })),
        language,
        recipeId: m.recipeId ?? 'standup',
        ...(recipeSlash.trim() ? { slash: recipeSlash } : {}),
      })
      const sessionId = await startAgentRun({ workspaceId, name: t('meetings.local.summaryRunName', { title: m.title }), prompt })
      await update({ summaryRun: { sessionId, startedAt: Date.now(), transcriptRevision: transcript.revision } })
    } catch {
      onBanner('summary-failed')
    }
  }

  // ── Tabs ──
  const tabs: Array<{ id: DetailTab; label: string; count?: number }> = [
    { id: 'overview', label: t('meetings.local.tab.overview') },
    { id: 'recording', label: t('meetings.local.tab.recording') },
    { id: 'transcript', label: t('meetings.local.tab.transcript'), count: m.transcript.status === 'done' ? m.transcript.segments : undefined },
    { id: 'decisions', label: t('meetings.local.tab.decisions'), count: decisions.length + candidates.length || undefined },
    { id: 'actions', label: t('meetings.local.tab.actions'), count: openActionCount(m) || undefined },
    { id: 'documents', label: t('meetings.local.tab.documents'), count: m.documents.length || undefined },
  ]

  const tr = transcriptTone(m)
  const sourceLabel = m.source === 'import' ? t('meetings.local.source.import') : m.source === 'microphone' ? t('meetings.local.source.mic') : t('meetings.local.source.none')

  const header = (
    <header className="px-5 pt-4">
      <div className="flex items-center gap-2">
        <input
          key={`${m.id}:${m.title}`}
          data-testid="meeting-title"
          defaultValue={m.title}
          aria-label={t('meetings.local.titleLabel')}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.title) void update({ title: v }) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="min-w-0 flex-1 truncate rounded-[6px] bg-transparent px-1 -mx-1 text-[17px] font-semibold outline-none hover:bg-foreground/[0.04] focus:bg-foreground/[0.06]"
        />
        {recordingThis
          ? <Badge tone="danger">● {t('meetings.local.recShort')}</Badge>
          : <Badge tone={tr.tone}>{t(tr.key, { progress: m.transcript.progress })}</Badge>}
      </div>
      <p className="pt-1 text-[12px] text-text-muted" data-testid="meeting-meta">
        {m.status === 'planned' && m.scheduledAt ? `${t('meetings.local.plannedFor')} ${dateFmt.format(m.scheduledAt)}` : dateFmt.format(meetingTime(m))}
        {m.durationMs > 0 || recordingThis ? ` · ${formatDuration(recordingThis ? recordedMs(rec) : m.durationMs)}` : ''}
        {` · ${sourceLabel}`}
        {m.participants.length ? ` · ${t('meetings.local.participantsCount', { count: m.participants.length })}` : ''}
      </p>
      {audioUrl ? (
        <div className="mt-2 flex h-7 items-center gap-2" data-testid="meeting-player">
          <audio
            ref={audioRef}
            data-testid="meeting-audio"
            src={audioUrl}
            preload="metadata"
            onTimeUpdate={(e) => setPlayMs(Math.round(e.currentTarget.currentTime * 1000))}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setMediaMs(Math.round(d * 1000)) }}
            className="hidden"
          />
          <button
            type="button"
            data-testid="meeting-play"
            aria-label={playing ? t('meetings.local.pausePlayback') : t('meetings.local.play')}
            onClick={() => { const el = audioRef.current; if (!el) return; if (el.paused) void el.play().catch(() => {}); else el.pause() }}
            className="grid size-7 shrink-0 place-items-center rounded-[6px] bg-foreground/[0.06] text-foreground outline-none hover:bg-foreground/[0.1] focus-visible:bg-foreground/[0.1]"
          >
            {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          </button>
          <span className="shrink-0 text-[12px] tabular-nums text-text-muted">
            {formatDuration(playMs)} / {formatDuration(totalMs)}
          </span>
          <input
            type="range"
            aria-label={t('meetings.local.seek')}
            min={0}
            max={Math.max(totalMs, 1)}
            step={100}
            value={Math.min(playMs, Math.max(totalMs, 1))}
            onChange={(e) => { const el = audioRef.current; const v = Number(e.target.value); if (el) el.currentTime = v / 1000; setPlayMs(v) }}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-accent"
          />
        </div>
      ) : null}
      <div className="-mx-1 overflow-x-auto px-1 pt-2 [scrollbar-width:none] [&>[role=tablist]]:w-max">
        <Tabs tabs={tabs} value={tab} onChange={onTab} label={t('meetings.title')} />
      </div>
    </header>
  )

  // Overview
  const [participantDraft, setParticipantDraft] = useState('')
  const overview = (
    <div className="flex flex-col gap-1">
      <SectionLabel>{t('meetings.local.summary')}</SectionLabel>
      {m.summaryRun ? (
        <p className="text-[12px] text-text-secondary" role="status">{t('meetings.local.summaryRunning')}</p>
      ) : null}
      <textarea
        key={`${m.id}:${m.summary?.updatedAt ?? 0}`}
        data-testid="meeting-summary"
        defaultValue={m.summary?.text ?? ''}
        placeholder={t('meetings.local.summaryPlaceholder')}
        onBlur={(e) => {
          const text = e.target.value
          if (text === (m.summary?.text ?? '')) return
          void update({ summary: text.trim() ? { text, generated: false, updatedAt: Date.now() } : null })
        }}
        rows={m.summary ? 5 : 3}
        className="w-full resize-y rounded-[6px] bg-foreground/[0.05] px-2 py-1 text-[13px] leading-5 outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]"
      />
      {m.summary?.generated && transcript && m.summary.sourceTranscriptRevision !== transcript.revision ? (
        <p role="status" className="text-[11px] text-text-muted">{t('meetings.local.analysisStale')}</p>
      ) : null}
      {m.summary?.generated && m.summary.sourceTranscriptRevision === transcript?.revision ? renderSourceLinks(m.summary.sourceSegmentIds) : null}
      {m.summary?.questions?.length ? (
        <>
          <SectionLabel>{t('meetings.local.openQuestions')}</SectionLabel>
          {m.summary.questions.map((question) => (
            <div key={question.id} className="rounded-[6px] bg-foreground/[0.04] px-2 py-1">
              <p className="text-[13px]">{question.text}</p>
              {m.summary?.sourceTranscriptRevision === transcript?.revision ? renderSourceLinks(question.sourceSegmentIds) : null}
            </div>
          ))}
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12px] text-text-secondary">
          {t('meetings.local.analysisProfile')}
          <select
            data-testid="meeting-analysis-profile"
            aria-label={t('meetings.local.analysisProfile')}
            value={m.recipeId ?? 'standup'}
            disabled={!!m.summaryRun}
            onChange={(event) => void update({ recipeId: event.target.value as MeetingProfileId })}
            className="h-7 rounded-[6px] bg-foreground/[0.05] px-2 text-[12px]"
          >
            {MEETING_PROFILE_IDS.map(id => <option key={id} value={id}>{t(`meetings.local.profile.${id}`)}</option>)}
          </select>
        </label>
        <input
          data-testid="meeting-analysis-slash"
          aria-label={t('meetings.skillCommand')}
          placeholder={t('meetings.skillCommand')}
          value={recipeSlash}
          disabled={!!m.summaryRun}
          onChange={(event) => setRecipeSlash(event.target.value)}
          className="h-7 min-w-0 rounded-[6px] bg-foreground/[0.05] px-2 text-[12px]"
        />
        {m.summary?.generated ? <span className="text-[11px] text-text-muted">{t('meetings.local.generatedLabel')}</span> : null}
        <Button
          data-testid="meeting-generate-summary"
          disabled={!workspaceId || !transcript?.segments.length || !!m.summaryRun}
          title={!transcript?.segments.length ? t('meetings.local.summaryNeedsTranscript') : t('meetings.local.summaryAgentHint')}
          onClick={() => void generateSummary()}
        >
          {m.summary?.generated ? t('meetings.local.regenerateSummary') : t('meetings.local.generateSummary')}
        </Button>
      </div>

      <SectionLabel>{t('meetings.local.participants')}</SectionLabel>
      <div className="flex flex-wrap items-center gap-1">
        {m.participants.map((p) => (
          <span key={p} className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-foreground/[0.06] pl-2 pr-1 text-[12px]">
            {p}
            <button type="button" aria-label={t('meetings.local.removeParticipant', { name: p })} className="rounded-[4px] px-1 text-text-muted hover:text-foreground" onClick={() => void update({ participants: m.participants.filter((x) => x !== p) })}>×</button>
          </span>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); const v = participantDraft.trim(); if (!v) return; void update({ participants: [...m.participants, v] }); setParticipantDraft('') }}>
          <input value={participantDraft} onChange={(e) => setParticipantDraft(e.target.value)} placeholder={t('meetings.local.addParticipant')} aria-label={t('meetings.local.addParticipant')} className={cn(input, 'w-44')} />
        </form>
      </div>

      <SectionLabel>{t('meetings.local.notes')}</SectionLabel>
      <textarea
        key={`${m.id}:notes`}
        data-testid="meeting-notes"
        defaultValue={m.notes}
        placeholder={t('meetings.local.notesPlaceholder')}
        onBlur={(e) => { if (e.target.value !== m.notes) void update({ notes: e.target.value }) }}
        rows={4}
        className="w-full resize-y rounded-[6px] bg-foreground/[0.05] px-2 py-1 text-[13px] leading-5 outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]"
      />

      <SectionLabel>{t('meetings.local.details')}</SectionLabel>
      <dl className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1 text-[12px]">
        <dt className="text-text-muted">{t('meetings.local.started')}</dt>
        <dd>{m.startedAt ? shortFmt.format(m.startedAt) : '—'}</dd>
        <dt className="text-text-muted">{t('meetings.local.ended')}</dt>
        <dd>{m.endedAt ? shortFmt.format(m.endedAt) : '—'}</dd>
        <dt className="text-text-muted">{t('meetings.local.duration')}</dt>
        <dd className="tabular-nums">{recordingThis ? formatDuration(recordedMs(rec)) : m.durationMs ? formatDuration(m.durationMs) : '—'}</dd>
        <dt className="text-text-muted">{t('meetings.local.transcriptEngine')}</dt>
        <dd>{m.transcript.engine ? `${m.transcript.engine} · ${m.transcript.model ?? ''}${m.transcript.language ? ` · ${m.transcript.language}` : ''}` : '—'}</dd>
      </dl>
    </div>
  )

  // Recording
  const importAudioHere = async () => {
    if (!api || importRequestRef.current) return
    const requestId = newLocalId('import')
    importRequestRef.current = requestId
    setImportRequestId(requestId)
    setCancelingImport(false)
    try {
      const result = await api.importAudio({ requestId, meetingId: m.id, workspaceId })
      if (result && !result.ok) onBanner(result.code)
      else if (result?.ok) onChanged(result.value)
    } catch {
      onBanner('unavailable')
    } finally {
      if (importRequestRef.current === requestId) {
        importRequestRef.current = null
        setImportRequestId(null)
        setCancelingImport(false)
      }
    }
  }
  const cancelAudioImport = async () => {
    if (!api || !importRequestId) return
    try {
      if (await api.cancelImport(importRequestId)) setCancelingImport(true)
    } catch {
      onBanner('unavailable')
    }
  }
  const recordingTab = recordingThis ? (
    <RecordingPanel />
  ) : m.audio ? (
    <div className="flex flex-col gap-1 text-[12px]">
      <SectionLabel>{t('meetings.local.file')}</SectionLabel>
      <dl className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1">
        <dt className="text-text-muted">{t('meetings.local.fileName')}</dt>
        <dd className="truncate">{m.audio.originalName ? `${m.audio.file} ← ${m.audio.originalName}` : m.audio.file}</dd>
        <dt className="text-text-muted">{t('meetings.local.fileSize')}</dt>
        <dd>{formatBytes(m.audio.bytes)} · {m.audio.mimeType}</dd>
        <dt className="text-text-muted">{t('meetings.local.duration')}</dt>
        <dd className="tabular-nums">{formatDuration(m.durationMs)}</dd>
      </dl>
      {m.audio.recovered ? <p className="pt-1 text-text-secondary">{t('meetings.local.recoveredNote')}</p> : null}
      <p className="pt-1 text-text-muted">{t('meetings.local.storedLocally')}</p>
      <div className="flex gap-2 pt-2">
        <Button data-testid="meeting-reveal" onClick={() => void api?.reveal(m.id)}>{t('meetings.local.revealInFinder')}</Button>
      </div>
    </div>
  ) : (
    <EmptyState
      title={t('meetings.local.noAudioTitle')}
      body={t('meetings.local.noAudioBody')}
      action={(
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" data-testid="meeting-record-here" disabled={rec.status !== 'idle' || !!importRequestId} onClick={() => void startRecording({ meetingId: m.id, title: m.title, workspaceId }).then((r) => { if (!r.ok) onBanner(r.code) })}>
            ● {t('meetings.local.recordHere')}
          </Button>
          {importRequestId ? (
            <Button data-testid="meeting-cancel-import" disabled={cancelingImport} onClick={() => void cancelAudioImport()}>
              {t(cancelingImport ? 'meetings.local.importCanceling' : 'meetings.local.importCancel')}
            </Button>
          ) : (
            <Button data-testid="meeting-import-here" disabled={!api} onClick={() => void importAudioHere()}>
              {t('meetings.local.importHere')}
            </Button>
          )}
        </div>
      )}
    />
  )

  // Transcript
  const transcriptTab = (
    <div className="flex flex-col gap-2">
      {m.transcript.status === 'running' || m.transcript.status === 'queued' ? (
        <div role="status" data-testid="meeting-transcript-progress" className="flex flex-col gap-1">
          <div className="text-[12px] text-text-secondary">{t(m.transcript.status === 'queued' ? 'meetings.local.tr.queuedBody' : 'meetings.local.tr.runningBody', { progress: m.transcript.progress, model: m.transcript.model ?? engine?.model ?? '' })}</div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/[0.08]">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${m.transcript.progress}%` }} />
          </div>
          <Button disabled={cancelingTranscript} onClick={() => void cancelTranscription()}>{t(cancelingTranscript ? 'meetings.local.tr.cancelConfirm' : 'meetings.local.tr.cancel')}</Button>
        </div>
      ) : null}
      {m.transcript.status === 'partial' || m.transcript.status === 'cancelled'
        ? <p role="status" className="text-[12px] text-text-secondary">{t(m.transcript.status === 'partial' ? 'meetings.local.tr.partial' : 'meetings.local.tr.cancelled')}</p>
        : null}
      {!transcript?.segments.length && m.transcript.status === 'failed' ? (
        <EmptyState title={t('meetings.local.tr.failedTitle')} body={m.transcript.error} action={<Button onClick={() => void api?.transcribe(m.id).then((r) => { if (r.ok) onChanged(r.value); else onBanner(r.code) })}>{t('meetings.local.retranscribe')}</Button>} />
      ) : !transcript?.segments.length && m.transcript.status === 'unavailable' ? (
        <EmptyState title={t('meetings.local.tr.unavailableTitle')} body={t('meetings.local.tr.unavailableBody')} action={<Button onClick={() => void api?.transcribe(m.id).then((r) => { if (r.ok) onChanged(r.value); else onBanner(r.code) })}>{t('meetings.local.retranscribe')}</Button>} />
      ) : !m.audio ? (
        <EmptyState title={t('meetings.local.tr.noAudioTitle')} body={t('meetings.local.tr.noAudioBody')} />
      ) : m.transcript.status === 'none' ? (
        <EmptyState title={t('meetings.local.tr.noneTitle')} action={<Button onClick={() => void api?.transcribe(m.id).then((r) => { if (r.ok) onChanged(r.value); else onBanner(r.code) })}>{t('meetings.local.transcribe')}</Button>} />
      ) : !transcript && (m.transcript.status === 'cancelled' || m.transcript.status === 'partial') ? (
        <EmptyState title={t(m.transcript.status === 'partial' ? 'meetings.local.tr.partial' : 'meetings.local.tr.cancelled')} action={<Button onClick={() => void api?.transcribe(m.id).then((r) => { if (r.ok) onChanged(r.value); else onBanner(r.code) })}>{t('meetings.local.retranscribe')}</Button>} />
      ) : transcript && transcript.segments.length === 0 ? (
        <EmptyState title={t('meetings.local.tr.emptyTitle')} body={t('meetings.local.tr.emptyBody')} action={<Button onClick={() => void api?.transcribe(m.id).then((r) => { if (r.ok) onChanged(r.value); else onBanner(r.code) })}>{t('meetings.local.retranscribe')}</Button>} />
      ) : transcript ? (
        <>
          <div className="flex items-center gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('meetings.local.searchTranscript')} aria-label={t('meetings.local.searchTranscript')} data-testid="meeting-transcript-search" className={cn(input, 'flex-1')} />
            <span className="shrink-0 text-[11px] text-text-muted">
              {t('meetings.local.tr.meta', { engine: transcript.engine, model: transcript.model, language: transcript.language ?? 'auto', seconds: Math.round(transcript.elapsedMs / 1000) })}
              {' · '}{transcript.provenance?.sourceKind ?? m.source}
              {transcript.provenance?.sourceHash ? ` · ${transcript.provenance.sourceHash.slice(0, 12)}` : ''}
            </span>
          </div>
          {transcript.history?.some((version) => version.revision < transcript.revision) ? (
            <section className="flex flex-col gap-1 rounded-[6px] bg-foreground/[0.03] p-2" aria-label={t('meetings.local.tr.history')}>
              <SectionLabel>{t('meetings.local.tr.history')}</SectionLabel>
              {transcript.history
                .filter((version) => version.revision < transcript.revision)
                .slice()
                .sort((a, b) => b.revision - a.revision)
                .map((version) => (
                  <div key={version.revision} className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 text-text-secondary">
                      {new Date(version.createdAt).toLocaleString()}
                      {' · '}{t(`meetings.local.tr.revision.${version.reason}`)}
                    </span>
                    <Button variant="ghost" disabled={loadingRevision != null || restoringRevision} onClick={() => void viewTranscriptRevision(version.revision)}>
                      {t('meetings.local.tr.viewRevision', { revision: version.revision })}
                    </Button>
                  </div>
                ))}
              {revisionPreview ? (
                <div className="flex flex-col gap-1 border-t border-foreground/10 pt-2" data-testid="meeting-transcript-revision-preview">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-[12px] text-text-secondary">{t('meetings.local.tr.revisionPreview', { revision: revisionPreview.revision })}</span>
                    <Button disabled={restoringRevision} onClick={() => void restoreTranscriptRevision()}>{t('meetings.local.tr.restoreRevision')}</Button>
                  </div>
                  <ol className="flex max-h-48 flex-col overflow-y-auto">
                    {revisionPreview.transcript.segments.map((segment) => (
                      <li key={segment.id} className="flex items-start gap-2 px-2 py-1 text-[12px]">
                        <span className="w-12 shrink-0 font-mono tabular-nums text-text-muted">{formatRecClock(segment.startMs)}</span>
                        <span>{segment.speakerId ? `${segment.speakerId}: ` : ''}{segment.text}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </section>
          ) : null}
          {segmentEditError ? (
            <div role="alert" className="flex items-center gap-2 text-[12px] text-destructive">
              <span className="flex-1">{t(segmentEditError === 'revision-conflict' ? 'meetings.local.revisionConflict' : segmentEditError === 'invalid-timecode' ? 'meetings.local.invalidTimecode' : 'meetings.local.err.generic')}</span>
              {segmentEditError === 'revision-conflict' ? <Button variant="ghost" onClick={() => void api?.readTranscript(m.id).then((current) => { setTranscript(current); setSegmentEdits({}); setSegmentEditError(null) }).catch(() => onBanner('unavailable'))}>{t('common.retry')}</Button> : null}
            </div>
          ) : null}
          <ol className="flex flex-col" data-testid="meeting-transcript">
            {segments.map((s) => {
              const edit = segmentEdits[s.id] ?? {
                speakerId: s.speakerId ?? '',
                start: String(s.startMs / 1000),
                end: String(s.endMs / 1000),
              }
              const hasEdit = !!segmentEdits[s.id]
              return (
                <li key={s.id} className="rounded-[6px]">
                  <button
                    type="button"
                    onClick={() => seek(s.startMs)}
                    disabled={!audioUrl}
                    className={cn('flex w-full items-start gap-2 rounded-[6px] px-2 py-1 text-left hover:bg-foreground/[0.04]', s.id === activeId && 'bg-accent/10 shadow-[inset_2px_0_0_var(--accent)]')}
                  >
                    <span className="w-12 shrink-0 pt-px font-mono text-[11px] tabular-nums text-text-muted">{formatRecClock(s.startMs)}</span>
                    <span className="min-w-0 flex-1 text-[13px] leading-5">{s.speakerId ? `${s.speakerId}: ` : ''}{s.text}</span>
                  </button>
                  <div className="flex flex-wrap items-center gap-1 px-2 pb-1">
                    <label className="sr-only" htmlFor={`speaker-${m.id}-${s.id}`}>{t('meetings.local.speakerLabel')}</label>
                    <input id={`speaker-${m.id}-${s.id}`} value={edit.speakerId} placeholder={t('meetings.local.speakerPlaceholder')} aria-label={t('meetings.local.speakerLabel')} onChange={(e) => setSegmentEdits((current) => ({ ...current, [s.id]: { ...edit, speakerId: e.target.value } }))} className={cn(input, 'w-28')} />
                    <label className="sr-only" htmlFor={`segment-start-${m.id}-${s.id}`}>{t('meetings.local.seekStart')}</label>
                    <input id={`segment-start-${m.id}-${s.id}`} type="number" min="0" step="0.1" value={edit.start} aria-label={t('meetings.local.seekStart')} onChange={(e) => setSegmentEdits((current) => ({ ...current, [s.id]: { ...edit, start: e.target.value } }))} className={cn(input, 'w-20')} />
                    <label className="sr-only" htmlFor={`segment-end-${m.id}-${s.id}`}>{t('meetings.local.seekEnd')}</label>
                    <input id={`segment-end-${m.id}-${s.id}`} type="number" min="0" step="0.1" value={edit.end} aria-label={t('meetings.local.seekEnd')} onChange={(e) => setSegmentEdits((current) => ({ ...current, [s.id]: { ...edit, end: e.target.value } }))} className={cn(input, 'w-20')} />
                    <Button disabled={!hasEdit} onClick={() => void saveSegmentEdit(s.id, s)}>{t('meetings.local.saveSegment')}</Button>
                  </div>
                </li>
              )
            })}
            {segments.length === 0 ? <li className="px-2 py-2 text-[12px] text-text-muted">{t('meetings.local.noMatches')}</li> : null}
          </ol>
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={() => void api?.transcribe(m.id).then((r) => { if (r.ok) onChanged(r.value); else onBanner(r.code) })}>{t('meetings.local.retranscribe')}</Button>
          </div>
        </>
      ) : (
        <EmptyState title={t('common.loading')} />
      )}
    </div>
  )

  // Decisions
  const [decisionDraft, setDecisionDraft] = useState('')
  const [decisionWhy, setDecisionWhy] = useState('')
  const [editingDecision, setEditingDecision] = useState<string | null>(null)
  const addDecision = async () => {
    const title = decisionDraft.trim()
    if (!title) return
    const why = decisionWhy.trim()
    // Clear the form first: the lesson sync below can take a while.
    setDecisionDraft('')
    setDecisionWhy('')
    const now = Date.now()
    await commitDecision({
      id: newLocalId('dec'),
      title,
      why,
      who: m.participants,
      decidedAt: m.startedAt ?? now,
      status: 'accepted',
      rejected: [],
      source: { kind: 'meeting', id: m.id, label: m.title },
      tags: [],
      exposeToAgents: true,
      syncedRules: [],
      createdAt: now,
      updatedAt: now,
    })
  }
  const decisionsTab = (
    <div className="flex flex-col gap-1">
      {candidates.length ? (
        <>
          <SectionLabel>{t('meetings.local.decisionCandidates')}</SectionLabel>
          {candidates.map((c) => (
            <div key={c.id} className="flex items-start gap-2 rounded-[6px] bg-accent/[0.06] px-2 py-1">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{c.title}</span>
                {c.why ? <span className="block text-[12px] text-text-secondary">{c.why}</span> : null}
                {renderSourceLinks(c.source.segmentId ? [c.source.segmentId] : undefined)}
                <span className="block text-[11px] text-text-muted">{t('meetings.local.generatedLabel')}</span>
              </span>
              <Button onClick={() => {
                const current = loadDecisions(workspaceId)
                saveDecisionsData({ ...current, candidates: current.candidates.filter((x) => x.id !== c.id) })
                const duplicate = current.decisions.some((d) =>
                  d.source.kind === 'meeting'
                  && d.source.id === m.id
                  && d.title.trim().toLocaleLowerCase() === c.title.trim().toLocaleLowerCase(),
                )
                if (!duplicate) void commitDecision(candidateToDecision(c, newLocalId('dec'), Date.now()))
              }}>{t('meetings.local.accept')}</Button>
              <Button variant="ghost" onClick={() => {
                const current = loadDecisions(workspaceId)
                saveDecisionsData({ ...current, candidates: current.candidates.filter((x) => x.id !== c.id) })
              }}>{t('meetings.local.dismiss')}</Button>
            </div>
          ))}
        </>
      ) : null}
      {decisions.length === 0 && candidates.length === 0 ? (
        <EmptyState title={t('meetings.local.decisionsEmptyTitle')} body={t('meetings.local.decisionsEmptyBody')} />
      ) : null}
      {decisions.length ? <SectionLabel>{t('meetings.local.decisionsMade')}</SectionLabel> : null}
      <ul className="flex flex-col" data-testid="meeting-decisions">
        {decisions.map((d) => (
          <li key={d.id} className="group flex items-start gap-2 rounded-[6px] px-2 py-1 hover:bg-foreground/[0.04]">
            <span aria-hidden className={cn('mt-2 size-1.5 shrink-0 rounded-full', d.status === 'accepted' ? 'bg-success' : 'bg-text-muted')} />
            <span className="min-w-0 flex-1">
              {editingDecision === d.id ? (
                <input
                  autoFocus
                  defaultValue={d.title}
                  aria-label={t('meetings.local.decisionTitle')}
                  onBlur={(e) => { const v = e.target.value.trim(); setEditingDecision(null); if (v && v !== d.title) void commitDecision({ ...d, title: v }) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingDecision(null) }}
                  className={cn(input, 'w-full')}
                />
              ) : (
                <button type="button" className="block text-left text-[13px]" onClick={() => setEditingDecision(d.id)}>{d.title}</button>
              )}
              {d.why ? <span className="block text-[12px] text-text-secondary">{d.why}</span> : null}
              {renderSourceLinks(d.source.segmentId ? [d.source.segmentId] : undefined)}
              {d.status !== 'accepted' ? <span className="block text-[11px] text-text-muted">{t(`extraScreens.decisions.status.${d.status}`, { defaultValue: d.status })}</span> : null}
            </span>
            <span className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              <Button variant="ghost" onClick={() => navigate(routes.view.screen('decisions', d.id))}>{t('meetings.local.openInDecisions')}</Button>
              <Button variant="ghost" aria-label={t('meetings.local.remove')} onClick={() => {
                if (workspaceId) void removeDecisionLessons(workspaceId, d)
                const current = loadDecisions(workspaceId)
                saveDecisionsData({ ...current, decisions: current.decisions.filter((x) => x.id !== d.id) })
              }}>×</Button>
            </span>
          </li>
        ))}
      </ul>
      <form className="flex flex-col gap-1 pt-2" onSubmit={(e) => { e.preventDefault(); void addDecision() }}>
        <div className="flex gap-2">
          <input data-testid="meeting-decision-input" value={decisionDraft} onChange={(e) => setDecisionDraft(e.target.value)} placeholder={t('meetings.local.decisionPlaceholder')} aria-label={t('meetings.local.decisionPlaceholder')} className={cn(input, 'flex-1')} />
          <Button type="submit" data-testid="meeting-decision-add" disabled={!decisionDraft.trim()}>{t('meetings.screen.add')}</Button>
        </div>
        {decisionDraft.trim() ? (
          <input value={decisionWhy} onChange={(e) => setDecisionWhy(e.target.value)} placeholder={t('meetings.local.decisionWhy')} aria-label={t('meetings.local.decisionWhy')} className={cn(input, 'w-full')} />
        ) : null}
        <p className="text-[11px] text-text-muted">{t('meetings.local.decisionsSyncNote')}</p>
      </form>
    </div>
  )

  // Actions
  const [actionDraft, setActionDraft] = useState('')
  const saveActions = (actions: LocalMeetingAction[]) => void update({ actions })
  const actionsTab = (
    <div className="flex flex-col gap-1">
      {m.actions.length === 0 ? <EmptyState title={t('meetings.local.actionsEmptyTitle')} body={t('meetings.local.actionsEmptyBody')} /> : null}
      <ul className="flex flex-col" data-testid="meeting-actions">
        {m.actions.map((a) => (
          <li key={a.id} className="group flex flex-wrap items-center gap-2 rounded-[6px] px-2 py-1 hover:bg-foreground/[0.04]">
            <input type="checkbox" className="accent-[var(--accent)]" checked={a.done} aria-label={a.text} onChange={(e) => saveActions(m.actions.map((x) => (x.id === a.id ? { ...x, done: e.target.checked } : x)))} />
            <span className={cn('min-w-0 flex-1 text-[13px]', a.done && 'text-text-muted line-through')}>
              {a.text}
              {a.generated ? <span className="pl-2 text-[11px] text-text-muted">{t('meetings.local.generatedShort')}</span> : null}
            </span>
            {a.sourceTranscriptRevision === transcript?.revision ? renderSourceLinks(a.sourceSegmentIds) : null}
            {a.taskId ? (
              <Button variant="ghost" onClick={() => navigate(routes.view.tasks(a.taskId))}>{t('meetings.local.openTask')}</Button>
            ) : (
              <Button data-testid="meeting-action-to-task" onClick={() => {
                const task = createPersonalTask({ title: a.text, notes: t('meetings.local.taskNotes', { title: m.title }) })
                saveActions(m.actions.map((x) => (x.id === a.id ? { ...x, taskId: task.id } : x)))
              }}>{t('meetings.local.toTask')}</Button>
            )}
            <Button variant="ghost" aria-label={t('meetings.local.remove')} className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => saveActions(m.actions.filter((x) => x.id !== a.id))}>×</Button>
          </li>
        ))}
      </ul>
      <form className="flex gap-2 pt-2" onSubmit={(e) => {
        e.preventDefault()
        const text = actionDraft.trim()
        if (!text) return
        saveActions([...m.actions, { id: newLocalId('act'), text, done: false, createdAt: Date.now() }])
        setActionDraft('')
      }}>
        <input data-testid="meeting-action-input" value={actionDraft} onChange={(e) => setActionDraft(e.target.value)} placeholder={t('meetings.screen.actionPlaceholder')} aria-label={t('meetings.screen.actionPlaceholder')} className={cn(input, 'flex-1')} />
        <Button type="submit" disabled={!actionDraft.trim()}>{t('meetings.screen.add')}</Button>
      </form>
    </div>
  )

  // Documents
  const [dragOver, setDragOver] = useState(false)
  const attachPaths = async (paths?: string[]) => {
    if (!api) return
    const next = await api.attach(m.id, paths)
    if (next) onChanged(next)
  }
  const documentsTab = (
    <div
      className={cn('flex min-h-[160px] flex-col gap-1 rounded-[8px]', dragOver && 'bg-accent/[0.06] shadow-[inset_0_0_0_1px_var(--accent)]')}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const paths = Array.from(e.dataTransfer.files).map((f) => window.electronAPI.getFilePath?.(f)).filter((p): p is string => !!p)
        if (paths.length) void attachPaths(paths)
      }}
      data-testid="meeting-documents"
    >
      <div className="flex items-center gap-2">
        <Button data-testid="meeting-attach" onClick={() => void attachPaths()}>{t('meetings.local.attachFiles')}</Button>
        <span className="text-[11px] text-text-muted">{t('meetings.local.dropHint')}</span>
      </div>
      {m.documents.length === 0 ? (
        <EmptyState title={t('meetings.local.documentsEmptyTitle')} body={t('meetings.local.documentsEmptyBody')} />
      ) : (
        <ul className="flex flex-col pt-1">
          {m.documents.map((d) => (
            <li key={d.id} className="group flex items-center gap-2 rounded-[6px] px-2 py-1 hover:bg-foreground/[0.04]">
              <button type="button" className="min-w-0 flex-1 truncate text-left text-[13px]" onClick={() => void api?.openDocument(m.id, d.id)} title={t('meetings.local.open')}>{d.name}</button>
              <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{formatBytes(d.bytes)} · {shortFmt.format(d.addedAt)}</span>
              <span className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <Button variant="ghost" onClick={() => void api?.reveal(m.id, d.id)}>{t('meetings.local.revealInFinder')}</Button>
                <Button variant="ghost" aria-label={t('meetings.local.remove')} onClick={() => void api?.removeDocument(m.id, d.id).then((next) => { if (next) onChanged(next) })}>×</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="pt-1 text-[11px] text-text-muted">{t('meetings.local.documentsNote')}</p>
    </div>
  )

  const [confirmTrash, setConfirmTrash] = useState(false)
  useEffect(() => { setConfirmTrash(false) }, [m.id])

  return (
    <div className="flex min-h-full flex-col" data-testid="meeting-detail" data-meeting-id={m.id}>
      {header}
      <div className="flex-1 px-5 pb-4 pt-2">
        {tab === 'overview' ? overview
          : tab === 'recording' ? recordingTab
          : tab === 'transcript' ? transcriptTab
          : tab === 'decisions' ? decisionsTab
          : tab === 'actions' ? actionsTab
          : documentsTab}
      </div>
      {recordingThis && tab !== 'recording' ? <div className="px-5 pb-3"><RecordingPanel compact /></div> : null}
      {!recordingThis ? (
        <footer className="flex items-center gap-2 px-5 pb-3 text-[11px] text-text-muted">
          <button type="button" className="hover:text-foreground" onClick={() => void api?.reveal(m.id)}>{t('meetings.local.openFolder')}</button>
          <span aria-hidden>·</span>
          {confirmTrash ? (
            <>
              <span>{t('meetings.local.trashConfirm')}</span>
              <button type="button" data-testid="meeting-trash-confirm" className="text-destructive hover:underline" onClick={() => void api?.trash(m.id).then((ok) => { if (ok) props.onTrashed(); else onBanner('trash-failed') })}>{t('meetings.local.trashYes')}</button>
              <button type="button" className="hover:text-foreground" onClick={() => setConfirmTrash(false)}>{t('common.cancel')}</button>
            </>
          ) : (
            <button type="button" data-testid="meeting-trash" className="hover:text-destructive" onClick={() => setConfirmTrash(true)}>{t('meetings.local.trash')}</button>
          )}
        </footer>
      ) : null}
    </div>
  )
}

/** Live controls for the meeting being recorded: timer, level, pause/resume, stop. */
export function RecordingPanel({ compact }: { compact?: boolean }) {
  const { t } = useTranslation()
  const rec = useRecorder()
  const [, tick] = useState(0)
  useEffect(() => {
    if (rec.status !== 'recording') return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [rec.status])
  if (rec.status === 'idle') return null
  const bars = 24
  const lit = Math.round(rec.level * bars)
  return (
    <div data-testid="meeting-recording-panel" className={cn('flex items-center gap-3 rounded-[8px] bg-destructive/[0.06] px-3', compact ? 'py-2' : 'py-3')}>
      <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full bg-destructive', rec.status === 'recording' && 'animate-pulse')} />
      <span className={cn('shrink-0 font-semibold tabular-nums', compact ? 'text-[15px]' : 'text-[22px]')} data-testid="meeting-rec-timer">{formatRecClock(recordedMs(rec))}</span>
      <span className="flex h-4 min-w-0 flex-1 items-end gap-[2px]" aria-label={t('meetings.local.level')} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(rec.level * 100)}>
        {Array.from({ length: bars }, (_, i) => (
          <span key={i} className={cn('w-1 rounded-full', i < lit ? (i > bars * 0.85 ? 'bg-destructive' : 'bg-success') : 'bg-foreground/[0.1]')} style={{ height: `${30 + (i / bars) * 70}%` }} />
        ))}
      </span>
      <span className="shrink-0 text-[11px] text-text-muted">{rec.status === 'stopping' ? t('meetings.local.saving') : rec.status === 'paused' ? t('meetings.local.paused') : t('meetings.local.micOnly')}</span>
      {rec.status === 'recording' ? (
        <Button data-testid="meeting-rec-pause" onClick={pauseRecording}>❚❚ {t('meetings.screen.pause')}</Button>
      ) : rec.status === 'paused' ? (
        <Button data-testid="meeting-rec-resume" onClick={resumeRecording}>▶ {t('meetings.screen.resume')}</Button>
      ) : null}
      <Button variant="primary" data-testid="meeting-rec-stop" disabled={rec.status === 'stopping'} onClick={() => void stopRecording()}>■ {t('meetings.local.stop')}</Button>
    </div>
  )
}

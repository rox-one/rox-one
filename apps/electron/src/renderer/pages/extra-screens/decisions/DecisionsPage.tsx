/**
 * «Решения» — decision log (what / why / who / when / source) with search and
 * filters. Candidates are extracted from a session or meeting by a read-only
 * agent run and approved by hand. Accepted decisions are exposed to agents via
 * workspace memory lessons (rejected options become MUST NOT rules).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { newLocalId, subscribeWorkspaceJson } from '@/lib/extra-screens/storage'
import { sessionTitle, useMeetings, useWorkspaceSessions } from '@/lib/extra-screens/use-rox-sources'
import { MEETING_SOURCE_SEEK_SESSION_KEY } from '../../../../shared/meetings-local'
import { cn } from '@/lib/utils'
import {
  Card,
  CardTitle,
  Chip,
  EmptyState,
  GroupLabel,
  ListRow,
  ScreenButton,
  ScreenColumn,
  ScreenDetail,
  ScreenHeader,
  ScreenRoot,
  SectionLabel,
  TextArea,
  TextField,
} from '../ui'
import {
  candidateToDecision,
  filterDecisions,
  lessonRulesFor,
  type Decision,
  type DecisionCandidate,
  type DecisionFilter,
  type DecisionSource,
  type DecisionStatus,
  type DecisionsData,
  type RejectedOption,
} from './decisions-model'
import {
  DECISIONS_NS,
  listWorkspaceLessonRules,
  loadDecisions,
  memoryApiAvailable,
  removeDecisionLessons,
  saveDecisions,
  startExtraction,
  syncDecisionLessons,
  syncExtraction,
} from './decisions-store'

const STATUSES: DecisionStatus[] = ['accepted', 'superseded', 'reverted']
const PERIODS: (number | null)[] = [7, 30, 90, null]

function openSource(source: DecisionSource) {
  if (source.kind === 'session' && source.id) navigate(routes.view.allSessions(source.id))
  else if (source.kind === 'meeting' && source.id) {
    try {
      if (source.segmentId && typeof source.startMs === 'number') {
        sessionStorage.setItem(MEETING_SOURCE_SEEK_SESSION_KEY, JSON.stringify({ meetingId: source.id, segmentId: source.segmentId, startMs: source.startMs }))
      } else {
        sessionStorage.removeItem(MEETING_SOURCE_SEEK_SESSION_KEY)
      }
    } catch {
      // The meeting remains navigable when storage is unavailable.
    }
    navigate(routes.view.meetings(source.id))
  }
}

export default function DecisionsPage({ itemId }: { itemId: string | null }) {
  const { t, i18n } = useTranslation()
  const language: 'ru' | 'en' = i18n.language.startsWith('ru') ? 'ru' : 'en'
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [data, setData] = useState<DecisionsData>(() => loadDecisions(workspaceId))
  const [filter, setFilter] = useState<DecisionFilter>({ query: '', status: 'all', source: 'all', periodDays: null })
  const [memoryRules, setMemoryRules] = useState<Set<string> | null>(null)
  const [memoryTick, setMemoryTick] = useState(0)

  useEffect(() => {
    setData(loadDecisions(workspaceId))
    return subscribeWorkspaceJson(DECISIONS_NS, workspaceId, () => setData(loadDecisions(workspaceId)))
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false
    if (!workspaceId) return
    void listWorkspaceLessonRules(workspaceId).then((rules) => { if (!cancelled) setMemoryRules(rules) })
    return () => { cancelled = true }
  }, [workspaceId, memoryTick])

  // Poll running extractions.
  const pending = data.extractions.filter((e) => !e.parsedAt)
  const pendingKey = pending.map((e) => e.id).join(',')
  useEffect(() => {
    if (!workspaceId || !pendingKey) return
    const ids = pendingKey.split(',')
    const tick = () => { for (const id of ids) void syncExtraction(workspaceId, id) }
    tick()
    const timer = window.setInterval(tick, 5000)
    return () => window.clearInterval(timer)
  }, [workspaceId, pendingKey])

  const save = useCallback((next: DecisionsData) => {
    setData(next)
    saveDecisions(workspaceId, next)
  }, [workspaceId])

  /** Save a decision, then bring agent memory in line and store the synced rules. */
  const commit = useCallback(async (decision: Decision) => {
    const current = loadDecisions(workspaceId)
    const exists = current.decisions.some((d) => d.id === decision.id)
    const updated = { ...decision, updatedAt: Date.now() }
    save({ ...current, decisions: exists ? current.decisions.map((d) => (d.id === decision.id ? updated : d)) : [updated, ...current.decisions] })
    if (!workspaceId) return
    const syncedRules = await syncDecisionLessons(workspaceId, updated)
    const after = loadDecisions(workspaceId)
    save({ ...after, decisions: after.decisions.map((d) => (d.id === decision.id ? { ...d, syncedRules } : d)) })
    setMemoryTick((n) => n + 1)
  }, [save, workspaceId])

  const now = Date.now()
  const rows = useMemo(() => filterDecisions(data.decisions, filter, now), [data.decisions, filter, now])
  const select = useCallback((id: string | null) => navigate(routes.view.screen('decisions', id ?? undefined)), [])

  const selectedCandidate = itemId?.startsWith('cand:') ? data.candidates.find((c) => `cand:${c.id}` === itemId) ?? null : null
  const selected = itemId && !itemId.includes(':') && itemId !== 'new' && itemId !== 'extract' ? data.decisions.find((d) => d.id === itemId) ?? null : null

  const monthLabel = (ts: number) => new Date(ts).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })
  let lastMonth = ''

  return (
    <ScreenRoot>
      <ScreenColumn width={400}>
        <ScreenHeader
          title={t('extraScreens.decisions.title')}
          subtitle={data.decisions.length || undefined}
          actions={
            <>
              <ScreenButton onClick={() => select('extract')}>{t('extraScreens.decisions.extract')}</ScreenButton>
              <ScreenButton variant="primary" onClick={() => select('new')}>＋ {t('extraScreens.decisions.add')}</ScreenButton>
            </>
          }
        />
        <div className="px-3 pb-1.5">
          <TextField value={filter.query} onChange={(query) => setFilter({ ...filter, query })} placeholder={t('extraScreens.decisions.searchPlaceholder')} />
        </div>
        <div className="flex flex-wrap gap-1 px-3 pb-1">
          <Chip active={filter.status === 'all'} onClick={() => setFilter({ ...filter, status: 'all' })}>{t('extraScreens.common.all')}</Chip>
          {STATUSES.map((status) => (
            <Chip key={status} active={filter.status === status} onClick={() => setFilter({ ...filter, status })}>{t(`extraScreens.decisions.status.${status}`)}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 px-3 pb-1">
          {(['all', 'session', 'meeting', 'manual'] as const).map((source) => (
            <Chip key={source} active={filter.source === source} onClick={() => setFilter({ ...filter, source })}>
              {source === 'all' ? t('extraScreens.decisions.anySource') : t(`extraScreens.decisions.source.${source}`)}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 px-3 pb-1">
          {PERIODS.map((days) => (
            <Chip key={String(days)} active={filter.periodDays === days} onClick={() => setFilter({ ...filter, periodDays: days })}>
              {days == null ? t('extraScreens.decisions.allTime') : t('extraScreens.decisions.lastDays', { n: days })}
            </Chip>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          {pending.length > 0 && (
            <div className="px-4 py-2 text-[12px] text-muted-foreground" role="status">{t('extraScreens.decisions.extracting', { n: pending.length })}</div>
          )}
          {data.candidates.length > 0 && (
            <>
              <GroupLabel>{t('extraScreens.decisions.candidates')} · {data.candidates.length}</GroupLabel>
              {data.candidates.map((candidate) => (
                <ListRow key={candidate.id} active={itemId === `cand:${candidate.id}`} onClick={() => select(`cand:${candidate.id}`)}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{candidate.title}</div>
                    <div className="truncate text-[12px] text-muted-foreground">{candidate.source.label ?? t(`extraScreens.decisions.source.${candidate.source.kind}`)}</div>
                  </div>
                  <Chip tone="warn">{t('extraScreens.decisions.candidate')}</Chip>
                </ListRow>
              ))}
            </>
          )}
          {rows.map((decision) => {
            const month = monthLabel(decision.decidedAt)
            const header = month !== lastMonth ? <GroupLabel>{month}</GroupLabel> : null
            lastMonth = month
            return (
              <div key={decision.id}>
                {header}
                <ListRow active={decision.id === itemId} onClick={() => select(decision.id)}>
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate', decision.status !== 'accepted' && 'text-muted-foreground line-through')}>{decision.title}</div>
                    <div className="truncate text-[12px] text-muted-foreground">
                      {[new Date(decision.decidedAt).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' }), decision.who.join(', '), decision.rejected.length ? t('extraScreens.decisions.rejectedCount', { n: decision.rejected.length }) : null]
                        .filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {decision.status === 'accepted' && decision.exposeToAgents && decision.syncedRules.length > 0 && (
                    <Chip tone="ok">{t('extraScreens.decisions.forAgents')}</Chip>
                  )}
                </ListRow>
              </div>
            )
          })}
          {data.decisions.length > 0 && rows.length === 0 && (
            <div className="px-4 py-6 text-muted-foreground">{t('extraScreens.common.nothingFound')}</div>
          )}
        </div>
      </ScreenColumn>
      <ScreenDetail>
        {itemId === 'new' ? (
          <DecisionEditor
            key="new"
            decision={null}
            memoryRules={memoryRules}
            onCommit={async (decision) => { await commit(decision); select(decision.id) }}
          />
        ) : itemId === 'extract' ? (
          <ExtractPanel workspaceId={workspaceId} language={language} data={data} />
        ) : selectedCandidate ? (
          <CandidateView
            candidate={selectedCandidate}
            onAccept={async () => {
              const decision = candidateToDecision(selectedCandidate, newLocalId('dec'), Date.now())
              const current = loadDecisions(workspaceId)
              save({ ...current, candidates: current.candidates.filter((c) => c.id !== selectedCandidate.id) })
              await commit(decision)
              select(decision.id)
            }}
            onReject={() => {
              save({ ...data, candidates: data.candidates.filter((c) => c.id !== selectedCandidate.id) })
              select(null)
            }}
          />
        ) : selected ? (
          <DecisionEditor
            key={selected.id}
            decision={selected}
            memoryRules={memoryRules}
            onCommit={commit}
            onDelete={async () => {
              if (!window.confirm(t('extraScreens.decisions.deleteConfirm'))) return
              if (workspaceId) await removeDecisionLessons(workspaceId, selected)
              const current = loadDecisions(workspaceId)
              save({ ...current, decisions: current.decisions.filter((d) => d.id !== selected.id) })
              setMemoryTick((n) => n + 1)
              select(null)
            }}
          />
        ) : data.decisions.length === 0 && data.candidates.length === 0 ? (
          <EmptyState
            title={t('extraScreens.decisions.emptyTitle')}
            body={t('extraScreens.decisions.emptyBody')}
            action={
              <div className="flex gap-1.5">
                <ScreenButton variant="primary" onClick={() => select('new')}>＋ {t('extraScreens.decisions.add')}</ScreenButton>
                <ScreenButton onClick={() => select('extract')}>{t('extraScreens.decisions.extract')}</ScreenButton>
              </div>
            }
          />
        ) : (
          <EmptyState title={t('extraScreens.decisions.pickTitle')} body={t('extraScreens.decisions.pickBody')} />
        )}
      </ScreenDetail>
    </ScreenRoot>
  )
}

function CandidateView({ candidate, onAccept, onReject }: { candidate: DecisionCandidate; onAccept: () => void; onReject: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="max-w-[760px]">
      <div className="text-[12px] text-muted-foreground">{t('extraScreens.decisions.candidateFrom', { source: candidate.source.label ?? '' })}</div>
      <h2 className="mt-1 text-[19px] font-bold leading-tight">{candidate.title}</h2>
      {candidate.why && <p className="mt-2">{candidate.why}</p>}
      {candidate.who.length > 0 && <div className="mt-2 text-muted-foreground">{t('extraScreens.decisions.who')}: {candidate.who.join(', ')}</div>}
      {candidate.rejected.length > 0 && (
        <Card>
          <CardTitle>{t('extraScreens.decisions.rejected')}</CardTitle>
          {candidate.rejected.map((option) => (
            <div key={option.id} className="mt-1">✕ {option.text}{option.reason ? <span className="text-muted-foreground"> — {option.reason}</span> : null}</div>
          ))}
        </Card>
      )}
      {candidate.quote && <blockquote className="mt-3 rounded-[6px] bg-foreground/[0.04] px-3 py-2 italic text-foreground/80">«{candidate.quote}»</blockquote>}
      <div className="mt-4 flex gap-1.5">
        <ScreenButton variant="primary" onClick={onAccept}>{t('extraScreens.decisions.accept')}</ScreenButton>
        <ScreenButton onClick={onReject}>{t('extraScreens.decisions.discard')}</ScreenButton>
        {candidate.source.id && <ScreenButton variant="ghost" onClick={() => openSource(candidate.source)}>{t('extraScreens.decisions.openSource')}</ScreenButton>}
      </div>
    </div>
  )
}

function DecisionEditor({
  decision,
  memoryRules,
  onCommit,
  onDelete,
}: {
  decision: Decision | null
  memoryRules: Set<string> | null
  onCommit: (decision: Decision) => void | Promise<void>
  onDelete?: () => void
}) {
  const { t, i18n } = useTranslation()
  const [title, setTitle] = useState(decision?.title ?? '')
  const [why, setWhy] = useState(decision?.why ?? '')
  const [who, setWho] = useState(decision?.who.join(', ') ?? '')
  const [rejected, setRejected] = useState<RejectedOption[]>(decision?.rejected ?? [])
  const [optionDraft, setOptionDraft] = useState('')
  const [reasonDraft, setReasonDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const build = (patch: Partial<Decision> = {}): Decision => {
    const ts = Date.now()
    return {
      id: decision?.id ?? newLocalId('dec'),
      title: title.trim(),
      why: why.trim(),
      who: who.split(',').map((w) => w.trim()).filter(Boolean),
      decidedAt: decision?.decidedAt ?? ts,
      status: decision?.status ?? 'accepted',
      rejected,
      source: decision?.source ?? { kind: 'manual' },
      tags: decision?.tags ?? [],
      exposeToAgents: decision?.exposeToAgents ?? true,
      syncedRules: decision?.syncedRules ?? [],
      createdAt: decision?.createdAt ?? ts,
      updatedAt: ts,
      ...patch,
    }
  }
  const submit = async (patch: Partial<Decision> = {}) => {
    if (!title.trim()) return
    setSaving(true)
    try { await onCommit(build(patch)) } finally { setSaving(false) }
  }
  const addOption = () => {
    if (!optionDraft.trim()) return
    setRejected([...rejected, { id: newLocalId('opt'), text: optionDraft.trim(), reason: reasonDraft.trim() || undefined }])
    setOptionDraft('')
    setReasonDraft('')
  }

  const wanted = decision ? lessonRulesFor(decision) : []
  const inMemory = memoryRules ? wanted.filter((rule) => memoryRules.has(rule.rule)).length : null
  const dirty = !decision || title.trim() !== decision.title || why.trim() !== decision.why || who !== decision.who.join(', ') || JSON.stringify(rejected) !== JSON.stringify(decision.rejected)

  return (
    <div className="max-w-[820px]">
      {decision && (
        <div className="text-[12px] text-muted-foreground">
          {new Date(decision.decidedAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' })}
          {' · '}
          {decision.source.kind === 'manual'
            ? t('extraScreens.decisions.source.manual')
            : <button type="button" className="text-accent" onClick={() => openSource(decision.source)}>{decision.source.label ?? t(`extraScreens.decisions.source.${decision.source.kind}`)}</button>}
        </div>
      )}
      <SectionLabel>{t('extraScreens.decisions.what')}</SectionLabel>
      <TextField autoFocus={!decision} value={title} onChange={setTitle} placeholder={t('extraScreens.decisions.whatPlaceholder')} />
      <div className="mt-3"><SectionLabel>{t('extraScreens.decisions.why')}</SectionLabel></div>
      <TextArea value={why} onChange={setWhy} rows={3} placeholder={t('extraScreens.decisions.whyPlaceholder')} />
      <div className="mt-3"><SectionLabel>{t('extraScreens.decisions.who')}</SectionLabel></div>
      <TextField value={who} onChange={setWho} placeholder={t('extraScreens.decisions.whoPlaceholder')} />
      <div className="mt-3"><SectionLabel>{t('extraScreens.decisions.rejected')}</SectionLabel></div>
      {rejected.map((option) => (
        <div key={option.id} className="flex items-center gap-2 py-0.5">
          <span aria-hidden className="text-muted-foreground">✕</span>
          <span className="min-w-0 flex-1 truncate">{option.text}{option.reason ? <span className="text-muted-foreground"> — {option.reason}</span> : null}</span>
          <ScreenButton variant="ghost" onClick={() => setRejected(rejected.filter((o) => o.id !== option.id))}>×</ScreenButton>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-1.5">
        <TextField value={optionDraft} onChange={setOptionDraft} onEnter={addOption} placeholder={t('extraScreens.decisions.optionPlaceholder')} />
        <TextField value={reasonDraft} onChange={setReasonDraft} onEnter={addOption} placeholder={t('extraScreens.decisions.reasonPlaceholder')} />
        <ScreenButton onClick={addOption} disabled={!optionDraft.trim()}>{t('extraScreens.common.add')}</ScreenButton>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <ScreenButton variant="primary" disabled={!title.trim() || saving || !dirty} onClick={() => { void submit() }}>
          {saving ? t('extraScreens.decisions.saving') : t('extraScreens.common.save')}
        </ScreenButton>
        {decision && STATUSES.map((status) => (
          <Chip key={status} active={decision.status === status} onClick={() => { void submit({ status }) }}>{t(`extraScreens.decisions.status.${status}`)}</Chip>
        ))}
        <span className="flex-1" />
        {onDelete && <ScreenButton variant="danger" onClick={onDelete}>{t('extraScreens.common.delete')}</ScreenButton>}
      </div>

      {decision && (
        <Card accent>
          <div className="flex items-center gap-2">
            <CardTitle>{t('extraScreens.decisions.agentsTitle')}</CardTitle>
            <span className="flex-1" />
            <label className="flex items-center gap-1.5 text-[12px]">
              <input
                type="checkbox"
                checked={decision.exposeToAgents}
                onChange={() => { void submit({ exposeToAgents: !decision.exposeToAgents }) }}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              {t('extraScreens.decisions.expose')}
            </label>
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {!memoryApiAvailable()
              ? t('extraScreens.decisions.memoryUnavailable')
              : wanted.length === 0
                ? t('extraScreens.decisions.noRules')
                : inMemory == null
                  ? t('extraScreens.decisions.memoryUnknown')
                  : t('extraScreens.decisions.inMemory', { n: inMemory, total: wanted.length })}
          </div>
          {wanted.map((rule) => (
            <div key={rule.rule} className="mt-1 text-[12px]">
              <span className={cn('font-bold', rule.negative ? 'text-destructive' : 'text-foreground')}>{rule.negative ? 'MUST NOT: ' : '• '}</span>
              {rule.rule}
            </div>
          ))}
          {wanted.length > 0 && inMemory != null && inMemory < wanted.length && (
            <ScreenButton className="mt-2" onClick={() => { void submit() }}>{t('extraScreens.decisions.resync')}</ScreenButton>
          )}
        </Card>
      )}
    </div>
  )
}

function ExtractPanel({ workspaceId, language, data }: { workspaceId: string | null; language: 'ru' | 'en'; data: DecisionsData }) {
  const { t, i18n } = useTranslation()
  const sessions = useWorkspaceSessions(workspaceId)
  const { meetings, available } = useMeetings(workspaceId)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runIds = new Set(data.extractions.map((e) => e.sessionId))
  const recentSessions = sessions
    .filter((s) => !runIds.has(s.id))
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
    .slice(0, 15)
  const recentMeetings = [...meetings].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 10)

  const run = async (source: DecisionSource) => {
    if (!workspaceId) return
    setBusy(`${source.kind}:${source.id}`)
    setError(null)
    try {
      const result = await startExtraction(workspaceId, source, language, t('extraScreens.decisions.extractSessionName', { source: source.label ?? '' }))
      if ('error' in result) setError(t('extraScreens.decisions.emptySource'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const when = (ts?: number) => (ts ? new Date(ts).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' }) : '')

  return (
    <div className="max-w-[760px]">
      <h2 className="text-[19px] font-bold">{t('extraScreens.decisions.extractTitle')}</h2>
      <p className="mt-1 text-muted-foreground">{t('extraScreens.decisions.extractBody')}</p>
      {error && <div className="mt-2 text-destructive">{error}</div>}
      <div className="mt-4"><SectionLabel>{t('extraScreens.decisions.source.session')}</SectionLabel></div>
      {recentSessions.length === 0 && <div className="text-muted-foreground">{t('extraScreens.decisions.noSessions')}</div>}
      {recentSessions.map((s) => {
        const source: DecisionSource = { kind: 'session', id: s.id, label: sessionTitle(s) }
        return (
          <div key={s.id} className="flex items-center gap-2 rounded-[6px] px-2 py-1 hover:bg-foreground/[0.04]">
            <span className="min-w-0 flex-1 truncate">{source.label}</span>
            <span className="text-[12px] text-muted-foreground">{when(s.lastMessageAt)}</span>
            <ScreenButton variant="ghost" disabled={busy != null} onClick={() => { void run(source) }}>
              {busy === `session:${s.id}` ? t('extraScreens.radar.starting') : t('extraScreens.decisions.extractOne')}
            </ScreenButton>
          </div>
        )
      })}
      <div className="mt-4"><SectionLabel>{t('extraScreens.decisions.source.meeting')}</SectionLabel></div>
      {!available && <div className="text-muted-foreground">{t('extraScreens.decisions.meetingsUnavailable')}</div>}
      {available && recentMeetings.length === 0 && <div className="text-muted-foreground">{t('extraScreens.decisions.noMeetings')}</div>}
      {recentMeetings.map((m) => {
        const source: DecisionSource = { kind: 'meeting', id: m.id, label: m.title }
        return (
          <div key={m.id} className="flex items-center gap-2 rounded-[6px] px-2 py-1 hover:bg-foreground/[0.04]">
            <span className="min-w-0 flex-1 truncate">{m.title}</span>
            <span className="text-[12px] text-muted-foreground">{when(m.at)}</span>
            <ScreenButton variant="ghost" disabled={busy != null} onClick={() => { void run(source) }}>
              {busy === `meeting:${m.id}` ? t('extraScreens.radar.starting') : t('extraScreens.decisions.extractOne')}
            </ScreenButton>
          </div>
        )
      })}
      {data.extractions.length > 0 && (
        <>
          <div className="mt-4"><SectionLabel>{t('extraScreens.decisions.extractHistory')}</SectionLabel></div>
          {data.extractions.slice(0, 10).map((e) => (
            <div key={e.id} className="flex items-center gap-2 py-0.5 text-[12px]">
              <span className="min-w-0 flex-1 truncate">{e.source.label}</span>
              <span className="text-muted-foreground">
                {!e.parsedAt ? t('extraScreens.common.agentWorking') : e.failed ? t('extraScreens.decisions.extractFailed') : t('extraScreens.decisions.extractFound', { n: e.found ?? 0 })}
              </span>
              <button type="button" className="text-accent" onClick={() => navigate(routes.view.allSessions(e.sessionId))}>{t('extraScreens.common.openSession')}</button>
            </div>
          ))}
        </>
      )}
      <div className="mt-4 text-[12px] text-muted-foreground">{t('extraScreens.common.agentReadOnly')}</div>
    </div>
  )
}

/**
 * «Радар» — user-defined topics / competitors / keywords, a daily read-only
 * agent sweep (background scheduler in ../background.ts) and the morning
 * digest: what changed, what matters, what needs a reaction. One click turns
 * an item into a personal task or a reply DRAFT (a pre-filled, unsent chat).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Radar, Search, Globe2, Clock3, Plus, RefreshCw, AlertCircle, Loader2, ChevronRight, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { useConfirmedTaskConversion } from '@/hooks/useConfirmedTaskConversion'
import { newLocalId, subscribeWorkspaceJson } from '@/lib/extra-screens/storage'
import { externalFeedItems, sessionTitle, useFeedItems, useMeetings, useWorkspaceSessions } from '@/lib/extra-screens/use-rox-sources'
import {
  Card,
  CardTitle,
  Chip,
  EmptyState,
  GroupLabel,
  ListRow,
  ScreenButton,
  ScreenRoot,
  SectionLabel,
  TextField,
} from '../ui'
import {
  buildReplyDraftInput,
  buildTaskFromItem,
  groupDigest,
  latestSweep,
  localDateKey,
  matchLocalSignals,
  type RadarBucket,
  type RadarData,
  type RadarItem,
  type RadarSweep,
  type RadarTopic,
  type RadarTopicKind,
} from './radar-model'
import { RADAR_NS, loadRadar, runRadarSweep, saveRadar, syncRadarSweep, type SweepSyncState } from './radar-store'

const BUCKETS: RadarBucket[] = ['reaction', 'important', 'changed']
const KINDS: RadarTopicKind[] = ['topic', 'competitor', 'keyword']

function openRef(ref: NonNullable<RadarItem['ref']>) {
  if (ref.kind === 'session') navigate(routes.view.allSessions(ref.id))
  else if (ref.kind === 'meeting') navigate(routes.view.meetings(ref.id))
  else if (ref.kind === 'note') navigate(routes.view.notes(ref.id))
  else if (ref.kind === 'feed') navigate(routes.view.feed(ref.id))
  else navigate(routes.view.tasks(ref.id))
}

export default function RadarPage({ itemId }: { itemId: string | null }) {
  const { t, i18n } = useTranslation()
  const language: 'ru' | 'en' = i18n.language.startsWith('ru') ? 'ru' : 'en'
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [ownedData, setOwnedData] = useState(() => ({ workspaceId, data: loadRadar(workspaceId) }))
  const data = ownedData.workspaceId === workspaceId ? ownedData.data : loadRadar(workspaceId)
  const setData = useCallback((next: RadarData) => setOwnedData({ workspaceId, data: next }), [workspaceId])
  const [viewSweepId, setViewSweepId] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<SweepSyncState | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<{ id: string; title: string; updatedAt?: number }[]>([])
  const [sources, setSources] = useState<{ slug: string; name: string; available: boolean }[]>([])
  const context = useRef({ workspaceId, generation: 0 })
  if (context.current.workspaceId !== workspaceId) context.current = { workspaceId, generation: context.current.generation + 1 }

  useEffect(() => {
    setData(loadRadar(workspaceId))
    setViewSweepId(null); setSyncState(null); setError(null); setStarting(false)
    return subscribeWorkspaceJson(RADAR_NS, workspaceId, () => setData(loadRadar(workspaceId)))
  }, [workspaceId, setData])

  const save = useCallback((next: RadarData) => {
    const fresh = { ...next, sweeps: loadRadar(workspaceId).sweeps }
    if (!saveRadar(workspaceId, fresh)) { setError('storage-unavailable'); return }
    setData(fresh)
  }, [workspaceId, setData])

  const sessions = useWorkspaceSessions(workspaceId)
  const { meetings } = useMeetings(workspaceId)
  const feed = useFeedItems(workspaceId)
  useEffect(() => {
    let cancelled = false
    setNotes([]); setSources([])
    const api = window.electronAPI
    if (!workspaceId) return
    if (typeof api?.listNotes === 'function') void api.listNotes(workspaceId)
      .then((list) => { if (!cancelled) setNotes(list.map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }))) })
      .catch(() => { if (!cancelled) setNotes([]) })
    if (typeof api.getSources === 'function') void api.getSources(workspaceId).then(list => {
      if (!cancelled) setSources(list.map(source => ({ slug: source.config.slug, name: source.config.name,
        available: source.config.enabled && !['needs_auth', 'failed', 'local_disabled'].includes(source.config.connectionStatus ?? '') })))
    }, () => { if (!cancelled) setSources([]) })
    return () => { cancelled = true }
  }, [workspaceId])

  const latest = latestSweep(data)
  const sweep: RadarSweep | undefined = (viewSweepId && data.sweeps.find((s) => s.id === viewSweepId)) || latest
  const isLatest = !!sweep && sweep.id === latest?.id

  // Poll the sweep session until the digest is parsed.
  const sweepMeta = sweep ? sessions.find((s) => s.id === sweep.sessionId) : undefined
  useEffect(() => {
    if (!workspaceId || !sweep) { setSyncState(null); return }
    if (sweep.parsedAt) { setSyncState(sweep.status === 'missing' ? 'missing' : sweep.parseFailed ? 'failed' : 'done'); return }
    let cancelled = false
    const generation = context.current.generation
    const current = () => !cancelled && context.current.generation === generation && context.current.workspaceId === workspaceId
    const tick = () => syncRadarSweep(workspaceId, sweep.id, { isCurrent: current }).then((state) => { if (current()) setSyncState(state) }, () => { if (current()) setSyncState('failed') })
    void tick()
    const timer = window.setInterval(() => { void tick() }, 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the sweep's identity/state, not the object
  }, [workspaceId, sweep?.id, sweep?.parsedAt, sweep?.parseFailed, sweepMeta?.lastMessageAt])

  const sweepSessionIds = useMemo(() => new Set(data.sweeps.map((s) => s.sessionId)), [data.sweeps])
  const localSignals = useMemo(() => matchLocalSignals(data.topics, {
    sessions: sessions.filter((s) => !sweepSessionIds.has(s.id)).map((s) => ({ id: s.id, name: sessionTitle(s), lastMessageAt: s.lastMessageAt })),
    meetings: meetings.map((m) => ({ id: m.id, title: m.title, at: m.at })),
    notes,
    feed: externalFeedItems(feed.items),
  }, Date.now()), [data.topics, sessions, meetings, notes, sweepSessionIds, feed.items])

  const items = useMemo(
    () => [...(sweep?.items ?? []), ...(isLatest || !sweep ? localSignals : [])],
    [isLatest, sweep, localSignals],
  )
  const groups = useMemo(() => groupDigest(items, data.dismissed), [items, data.dismissed])
  const visibleCount = BUCKETS.reduce((sum, b) => sum + groups[b].length, 0)

  const selectedTopicId = itemId?.startsWith('topic:') ? itemId.slice(6) : null
  const selectedItem = itemId && !selectedTopicId ? items.find((item) => item.id === itemId) ?? null : null
  const select = useCallback((id: string | null) => navigate(routes.view.screen('radar', id ?? undefined)), [])

  const runNow = async () => {
    if (!workspaceId) return
    setStarting(true)
    setError(null)
    const generation = context.current.generation
    const isCurrent = () => context.current.workspaceId === workspaceId && context.current.generation === generation
    try {
      const created = await runRadarSweep(workspaceId, 'manual', language, `${t('extraScreens.radar.title')} · ${localDateKey(Date.now())}`, { isCurrent })
      if (!isCurrent()) return
      setViewSweepId(created.id)
      setData(loadRadar(workspaceId))
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : 'start-failed')
    } finally {
      if (isCurrent()) setStarting(false)
    }
  }

  const addTopic = () => {
    const topic: RadarTopic = { id: newLocalId('top'), label: t('extraScreens.radar.newTopic'), kind: 'topic', keywords: [], createdAt: Date.now() }
    save({ ...data, topics: [...data.topics, topic] })
    select(`topic:${topic.id}`)
  }

  const updateTopic = (id: string, patch: Partial<RadarTopic>) =>
    save({ ...data, topics: data.topics.map((topic) => (topic.id === id ? { ...topic, ...patch } : topic)) })

  const dismiss = (id: string) => {
    save({ ...data, dismissed: [...data.dismissed.filter((d) => d !== id), id].slice(-500) })
    select(null)
  }

  const relTime = (ts: number | undefined) =>
    ts ? new Date(ts).toLocaleString(i18n.language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

  const selectedTopic = selectedTopicId ? data.topics.find((topic) => topic.id === selectedTopicId) ?? null : null

  const busy = starting || !!latest && !latest.parsedAt && latest.status !== 'failed' && latest.status !== 'missing'
  const availableSources = sources.filter(source => source.available)
  return (
    <ScreenRoot className="flex-col overflow-y-auto p-3 sm:p-5" >
      <header className="flex flex-wrap items-center gap-3 pb-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-500"><Radar className="h-6 w-6" /></div>
        <div className="min-w-0 flex-1"><h1 className="text-xl font-semibold">{t('extraScreens.radar.title')}</h1><p className="text-xs text-muted-foreground">{t('extraScreens.radar.digestHint')}</p></div>
        <ScreenButton variant="primary" disabled={busy || !data.topics.length || !workspaceId} onClick={() => { void runNow() }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{t(busy ? 'extraScreens.radar.starting' : 'extraScreens.radar.runNow')}
        </ScreenButton>
      </header>
      <section data-testid="radar-setup" className="mb-4 rounded-2xl bg-foreground/[0.035] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{t('extraScreens.radar.setupTitle')}</h2><p className="mt-1 text-xs text-muted-foreground">{t('extraScreens.radar.setupHint')}</p></div><ScreenButton onClick={addTopic}><Plus className="h-4 w-4" />{t('extraScreens.radar.addTopic')}</ScreenButton></div>
        <div className="my-3 flex flex-wrap gap-2">
          {data.topics.map(topic => <button key={topic.id} type="button" aria-pressed={topic.id === selectedTopicId} onClick={() => select('topic:' + topic.id)} className="flex max-w-full items-center gap-2 rounded-xl bg-foreground/[0.06] px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <Search className="h-4 w-4 shrink-0 text-violet-500" /><span className="break-words">{topic.label}</span><ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>)}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Globe2 className="h-4 w-4 text-sky-500" />{t('extraScreens.radar.sourceScopeCount', { count: availableSources.length })}</span>
          <button type="button" role="switch" aria-checked={data.daily} aria-label={t('extraScreens.radar.scheduleLabel')} onClick={() => save({ ...data, daily: !data.daily })} className="flex items-center gap-2 rounded-lg px-1 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <span className={'relative h-5 w-9 shrink-0 rounded-full ' + (data.daily ? 'bg-accent' : 'bg-foreground/20')}><span className={'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ' + (data.daily ? 'translate-x-4' : 'translate-x-0')} /></span>{t('extraScreens.radar.scheduleLabel')}
          </button>
          <label className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-amber-500" /><select aria-label={t('extraScreens.radar.scheduleHour')} value={data.dailyHour} disabled={!data.daily} onChange={event => save({ ...data, dailyHour: Number(event.target.value) })} className="rounded-lg bg-background px-2 py-1 text-foreground">
            {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
          </select></label>
          <span>{t('extraScreens.radar.timezone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('extraScreens.radar.scheduleHint')}</p>
        {selectedTopic && <div className="mt-4 rounded-xl bg-background/70 p-3"><TopicEditor key={selectedTopic.id} topic={selectedTopic} sources={sources} onUpdate={patch => updateTopic(selectedTopic.id, patch)} onDelete={() => { save({ ...data, topics: data.topics.filter(topic => topic.id !== selectedTopic.id) }); select(null) }} /></div>}
      </section>
      {error && <div role="alert" className="mb-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{t('extraScreens.radar.error.' + error, { defaultValue: t('extraScreens.radar.error.start-failed') })}</div>}
      <div className={'grid min-w-0 gap-4 ' + (selectedItem ? 'lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]' : '')}>
        <section data-testid="radar-digest" className="min-w-0 rounded-2xl bg-foreground/[0.025] pb-3">
          <div className="flex flex-wrap items-center gap-2 p-4"><h2 className="min-w-0 flex-1 font-semibold">{t('extraScreens.radar.digest')}</h2>
            {!!data.sweeps.length && <select aria-label={t('extraScreens.radar.history')} value={viewSweepId ?? ''} onChange={event => { setViewSweepId(event.target.value || null); select(null) }} className="max-w-full rounded-lg bg-background px-2 py-1 text-xs">
              <option value="">{t('extraScreens.radar.latest')}</option>{data.sweeps.slice(0, 10).map(history => <option key={history.id} value={history.id}>{relTime(history.startedAt)}</option>)}
            </select>}
          </div>
          {!data.topics.length ? <EmptyState title={t('extraScreens.radar.noTopicsTitle')} body={t('extraScreens.radar.noTopicsBody')} action={<ScreenButton onClick={addTopic}><Plus className="h-4 w-4" />{t('extraScreens.radar.addTopic')}</ScreenButton>} /> : <>
            {!sweep && <p className="px-4 pb-3 text-sm text-muted-foreground">{t('extraScreens.radar.noSweepYet', { hour: String(data.dailyHour).padStart(2, '0') })}</p>}
            {sweep && <p className="px-4 pb-3 text-xs text-muted-foreground">{t('extraScreens.radar.checkedAt', { when: relTime(sweep.startedAt) })}</p>}
            {sweep && (syncState === 'running' || sweep.status === 'starting') && <div role="status" className="mx-4 mb-3 flex items-center gap-2 rounded-xl bg-accent/10 p-3"><Loader2 className="h-4 w-4 animate-spin" />{t('extraScreens.radar.sweepRunning')}</div>}
            {sweep && (syncState === 'failed' || syncState === 'missing') && <div role="alert" className="mx-4 mb-3 rounded-xl bg-amber-500/10 p-3"><p className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />{t('extraScreens.radar.error.' + (sweep.error ?? 'invalid-output'))}</p><div className="mt-2 flex flex-wrap gap-2"><ScreenButton disabled={busy} onClick={() => { void runNow() }}><RefreshCw className="h-3.5 w-3.5" />{t('extraScreens.radar.retry')}</ScreenButton>{sweep.sessionId && <ScreenButton variant="ghost" onClick={() => navigate(routes.view.allSessions(sweep.sessionId))}>{t('extraScreens.common.openSession')}</ScreenButton>}</div></div>}
            {sweep?.notes && <p className="mx-4 mb-3 rounded-xl bg-foreground/[0.04] p-3 text-xs text-muted-foreground">{t('extraScreens.radar.agentNotes')}: {sweep.notes}</p>}
            {sweep?.error === 'unsupported-items' && <p className="px-4 pb-3 text-xs text-muted-foreground">{t('extraScreens.radar.error.unsupported-items')}</p>}
            {BUCKETS.map(bucket => groups[bucket].length > 0 && <div key={bucket} data-radar-bucket={bucket}><GroupLabel><span className="inline-flex items-center gap-2"><Sparkles className={'h-3.5 w-3.5 ' + (bucket === 'reaction' ? 'text-amber-500' : bucket === 'important' ? 'text-violet-500' : 'text-sky-500')} />{t('extraScreens.radar.bucket.' + bucket)} · {groups[bucket].length}</span></GroupLabel>{groups[bucket].map(item => <ListRow key={item.id} active={item.id === itemId} onClick={() => select(item.id)} className="py-3"><div className="min-w-0 flex-1"><div className="break-words font-medium">{item.title}</div>{item.summary && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.summary}</p>}<div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground"><span>{item.origin === 'local' ? t('extraScreens.radar.local.' + (item.ref?.kind ?? 'session')) : item.source}</span>{item.topic && <span>· {item.topic}</span>}{item.at && <span>· {relTime(item.at)}</span>}</div></div><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></ListRow>)}</div>)}
            {visibleCount === 0 && (syncState === 'done' || !sweep) && <EmptyState title={t('extraScreens.radar.nothingNew', { n: data.topics.length })} body={t('extraScreens.radar.emptyHint')} />}
          </>}
        </section>
        {selectedItem && <section className="min-w-0 rounded-2xl bg-foreground/[0.035] p-4"><ItemDetail key={`${workspaceId}:${selectedItem.id}`} workspaceId={workspaceId} item={selectedItem} language={language} onDismiss={() => dismiss(selectedItem.id)} /></section>}
      </div>
    </ScreenRoot>
  )
}

export function ItemDetail({ item, language, onDismiss, workspaceId }: { item: RadarItem; language: 'ru' | 'en'; onDismiss: () => void; workspaceId: string | null }) {
  const { t } = useTranslation()
  const taskConversion = useConfirmedTaskConversion({ sourceKey: JSON.stringify([workspaceId, item.id]), source: item, workspaceId, input: buildTaskFromItem(item) })
  const taskId = taskConversion.taskId
  return (
    <div className="max-w-[760px]">
      <div className="text-[12px] text-muted-foreground">
        {[t(`extraScreens.radar.bucket.${item.bucket}`), item.origin === 'local' ? t('extraScreens.radar.inRox') : item.source, item.topic].filter(Boolean).join(' · ')}
      </div>
      <h2 className="mt-1 text-[19px] font-bold leading-tight">{item.title}</h2>
      {item.at && <p data-testid="radar-item-date" className="mt-2 text-xs text-muted-foreground">{t('extraScreens.radar.publishedAt', { when: new Date(item.at).toLocaleString() })}</p>}
      {item.summary && <p className="mt-2 text-foreground/90">{item.summary}</p>}
      {item.why && (
        <Card className="mt-3">
          <CardTitle>{t('extraScreens.radar.why')}</CardTitle>
          <div className="mt-1">{item.why}</div>
        </Card>
      )}
      {item.reaction && (
        <Card accent className="mt-3">
          <CardTitle>{t('extraScreens.radar.reaction')}</CardTitle>
          <div className="mt-1">{item.reaction}</div>
        </Card>
      )}
      {item.url && (
        <button type="button" className="mt-3 block max-w-full truncate text-left text-accent" onClick={() => { void window.electronAPI.openUrl(item.url!) }}>
          {item.url}
        </button>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {item.ref && <ScreenButton onClick={() => openRef(item.ref!)}>{t('extraScreens.radar.open')}</ScreenButton>}
        <ScreenButton
          variant="primary"
          onClick={() => navigate(routes.action.newSession({
            input: buildReplyDraftInput(item, language),
            name: t('extraScreens.radar.draftSessionName', { title: item.title.slice(0, 60) }),
          }))}
        >
          {t('extraScreens.radar.draftReply')}
        </ScreenButton>
        <ScreenButton disabled={taskConversion.busy || !!taskId} onClick={() => { void taskConversion.convert() }}>
          {t('extraScreens.common.toTask')}
        </ScreenButton>
        <ScreenButton variant="ghost" onClick={onDismiss}>{t('extraScreens.radar.dismiss')}</ScreenButton>
      </div>
      {taskConversion.failed ? <p role="alert" data-testid="radar-task-error" className="text-xs text-destructive">{t('tasks.toastCreateFailed')}</p> : null}
      {taskId && (
        <button type="button" className="mt-2 text-[12px] text-accent" onClick={() => navigate(routes.view.tasks(taskId))}>
          {t('extraScreens.common.taskCreated')}
        </button>
      )}
      <div className="mt-4 text-[12px] text-muted-foreground">{t('extraScreens.radar.draftOnly')}</div>
    </div>
  )
}

function TopicEditor({ topic, sources, onUpdate, onDelete }: { topic: RadarTopic; sources: { slug: string; name: string; available: boolean }[]; onUpdate: (patch: Partial<RadarTopic>) => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const [label, setLabel] = useState(topic.label)
  const [keyword, setKeyword] = useState('')
  const addKeyword = () => {
    const k = keyword.trim()
    if (!k || topic.keywords.includes(k)) return
    onUpdate({ keywords: [...topic.keywords, k] })
    setKeyword('')
  }
  return (
    <div className="max-w-[640px]">
      <SectionLabel>{t('extraScreens.radar.topicName')}</SectionLabel>
      <TextField
        autoFocus
        value={label}
        onChange={setLabel}
        onEnter={() => label.trim() && onUpdate({ label: label.trim() })}
        onBlur={() => label.trim() && label.trim() !== topic.label && onUpdate({ label: label.trim() })}
        placeholder={t('extraScreens.radar.topicName')}
        ariaLabel={t('extraScreens.radar.topicName')}
      />
      <div className="mt-3 flex flex-wrap gap-1">
        {KINDS.map((kind) => (
          <Chip key={kind} active={topic.kind === kind} onClick={() => onUpdate({ kind })}>{t(`extraScreens.radar.kind.${kind}`)}</Chip>
        ))}
      </div>
      <div className="mt-4"><SectionLabel>{t('extraScreens.radar.keywords')}</SectionLabel></div>
      <div className="flex flex-wrap items-center gap-1">
        {topic.keywords.map((k) => (
          <Chip key={k} onClick={() => onUpdate({ keywords: topic.keywords.filter((x) => x !== k) })}>{k} <span aria-hidden>×</span></Chip>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <TextField value={keyword} onChange={setKeyword} onEnter={addKeyword} placeholder={t('extraScreens.radar.keywordPlaceholder')} ariaLabel={t('extraScreens.radar.keywordPlaceholder')} />
        <ScreenButton onClick={addKeyword} disabled={!keyword.trim()}>{t('extraScreens.common.add')}</ScreenButton>
      </div>
      <div className="mt-3 text-[12px] text-muted-foreground">{t('extraScreens.radar.topicHint')}</div>
      <div className="mt-4"><SectionLabel>{t('extraScreens.radar.sourceHeading')}</SectionLabel></div>
      <label className="mb-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={topic.sourceSlugs === undefined} onChange={event => onUpdate({ sourceSlugs: event.target.checked ? undefined : [] })} />{t('extraScreens.radar.sourceAll')}</label>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map(source => <label key={source.slug} className={'flex min-w-0 items-start gap-2 rounded-xl bg-foreground/[0.04] p-3 text-sm ' + (!source.available ? 'opacity-50' : '')}>
          <input type="checkbox" aria-label={source.name} className="mt-1 accent-[var(--accent)]" disabled={!source.available} checked={(topic.sourceSlugs ?? sources.filter(item => item.available).map(item => item.slug)).includes(source.slug)} onChange={event => {
            const selected = topic.sourceSlugs ?? sources.filter(item => item.available).map(item => item.slug)
            onUpdate({ sourceSlugs: event.target.checked ? [...new Set([...selected, source.slug])] : selected.filter(slug => slug !== source.slug) })
          }} /><div className="min-w-0"><span className="break-words">{source.name}</span>{!source.available && <p className="text-xs text-muted-foreground">{t('extraScreens.radar.sourceUnavailable')}</p>}</div>
        </label>)}
      </div>
      {!sources.length && <p className="text-xs text-muted-foreground">{t('extraScreens.radar.sourcesEmpty')}</p>}
      <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={topic.includeWorkspace !== false} onChange={event => onUpdate({ includeWorkspace: event.target.checked })} />{t('extraScreens.radar.workspaceSignals')}</label>
      <ScreenButton className="mt-3" onClick={() => navigate(routes.view.sources())}>{t('extraScreens.radar.sourcesManage')}</ScreenButton>
      <div className="mt-6"><ScreenButton variant="danger" onClick={onDelete}>{t('extraScreens.common.delete')}</ScreenButton></div>
    </div>
  )
}

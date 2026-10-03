/**
 * «Радар» — user-defined topics / competitors / keywords, a daily read-only
 * agent sweep (background scheduler in ../background.ts) and the morning
 * digest: what changed, what matters, what needs a reaction. One click turns
 * an item into a personal task or a reply DRAFT (a pre-filled, unsent chat).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExtraScreenItemUnavailable } from '../ExtraScreenItemUnavailable'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { createPersonalTask } from '@/lib/extra-screens/personal-task-bridge'
import { newLocalId, subscribeWorkspaceJson } from '@/lib/extra-screens/storage'
import { externalFeedItems, sessionTitle, useFeedItems, useMeetings, useWorkspaceSessions } from '@/lib/extra-screens/use-rox-sources'
import {
  Card,
  CardTitle,
  Chip,
  Counter,
  EmptyState,
  GroupLabel,
  ListRow,
  ScreenButton,
  ScreenColumn,
  ScreenDetail,
  ScreenHeader,
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
  topicItemCount,
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
  const [data, setData] = useState<RadarData>(() => loadRadar(workspaceId))
  const [viewSweepId, setViewSweepId] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<SweepSyncState | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<{ id: string; title: string; updatedAt?: number }[]>([])

  useEffect(() => {
    setData(loadRadar(workspaceId))
    return subscribeWorkspaceJson(RADAR_NS, workspaceId, () => setData(loadRadar(workspaceId)))
  }, [workspaceId])

  const save = useCallback((next: RadarData) => {
    setData(next)
    saveRadar(workspaceId, next)
  }, [workspaceId])

  const sessions = useWorkspaceSessions(workspaceId)
  const { meetings } = useMeetings(workspaceId)
  const feed = useFeedItems(workspaceId)
  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI
    if (!workspaceId || typeof api?.listNotes !== 'function') return
    api.listNotes(workspaceId)
      .then((list) => { if (!cancelled) setNotes(list.map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }))) })
      .catch(() => { if (!cancelled) setNotes([]) })
    return () => { cancelled = true }
  }, [workspaceId])

  const latest = latestSweep(data)
  const sweep: RadarSweep | undefined = (viewSweepId && data.sweeps.find((s) => s.id === viewSweepId)) || latest
  const isLatest = !!sweep && sweep.id === latest?.id

  // Poll the sweep session until the digest is parsed.
  const sweepMeta = sweep ? sessions.find((s) => s.id === sweep.sessionId) : undefined
  useEffect(() => {
    if (!workspaceId || !sweep) { setSyncState(null); return }
    if (sweep.parsedAt) { setSyncState(sweep.parseFailed ? 'failed' : 'done'); return }
    let cancelled = false
    const tick = () => syncRadarSweep(workspaceId, sweep.id).then((state) => { if (!cancelled) setSyncState(state) })
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
    try {
      const created = await runRadarSweep(workspaceId, 'manual', language, `${t('extraScreens.radar.title')} · ${localDateKey(Date.now())}`)
      setViewSweepId(created.id)
      setData(loadRadar(workspaceId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
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

  return (
    <ScreenRoot>
      <ScreenColumn width={240}>
        <ScreenHeader title={t('extraScreens.radar.title')} />
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          <ListRow active={isLatest && !viewSweepId ? !selectedTopicId : false} onClick={() => { setViewSweepId(null); select(null) }}>
            <span className="flex-1">{t('extraScreens.radar.digest')}</span>
            {visibleCount > 0 && isLatest && <Counter>{visibleCount}</Counter>}
          </ListRow>
          <GroupLabel>{t('extraScreens.radar.topics')}</GroupLabel>
          {data.topics.map((topic) => (
            <ListRow key={topic.id} active={topic.id === selectedTopicId} onClick={() => select(`topic:${topic.id}`)}>
              <span className="min-w-0 flex-1 truncate">{topic.label}</span>
              <span className="text-[12px] text-muted-foreground">{topicItemCount(topic, items) || ''}</span>
            </ListRow>
          ))}
          <ListRow onClick={addTopic}><span className="text-muted-foreground">＋ {t('extraScreens.radar.addTopic')}</span></ListRow>
          {data.sweeps.length > 0 && <GroupLabel>{t('extraScreens.radar.history')}</GroupLabel>}
          {data.sweeps.slice(0, 10).map((s) => (
            <ListRow key={s.id} active={s.id === sweep?.id && !!viewSweepId} onClick={() => { setViewSweepId(s.id); select(null) }}>
              <span className="flex-1">{relTime(s.startedAt)}</span>
              <span className="text-[12px] text-muted-foreground">
                {s.parsedAt ? (s.parseFailed ? '!' : s.items?.length ?? 0) : '…'}
              </span>
            </ListRow>
          ))}
          <div className="px-4 pt-4">
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <input
                type="checkbox"
                checked={data.daily}
                onChange={() => save({ ...data, daily: !data.daily })}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              {t('extraScreens.radar.dailyAt', { hour: String(data.dailyHour).padStart(2, '0') })}
            </label>
          </div>
        </div>
      </ScreenColumn>

      <ScreenColumn width={400} className="bg-foreground/[0.015]">
        <ScreenHeader
          title={sweep ? t('extraScreens.radar.digestOf', { when: relTime(sweep.startedAt) }) : t('extraScreens.radar.digest')}
          actions={
            <ScreenButton variant="primary" disabled={starting || data.topics.length === 0 || !workspaceId} onClick={() => { void runNow() }}>
              {starting ? t('extraScreens.radar.starting') : t('extraScreens.radar.runNow')}
            </ScreenButton>
          }
        />
        {error && <div className="px-4 pb-2 text-[12px] text-destructive">{error}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          {data.topics.length === 0 ? (
            <EmptyState
              title={t('extraScreens.radar.noTopicsTitle')}
              body={t('extraScreens.radar.noTopicsBody')}
              action={<ScreenButton variant="primary" onClick={addTopic}>＋ {t('extraScreens.radar.addTopic')}</ScreenButton>}
            />
          ) : (
            <>
              {feed.loaded && !feed.available && (
                <div className="px-4 pt-2 text-[12px] text-muted-foreground">{t('extraScreens.radar.feedUnavailable')}</div>
              )}
              {feed.loaded && feed.available && feed.sourceCount === 0 && !feed.xConnected && (
                <div className="px-4 pt-2 text-[12px] text-muted-foreground">
                  {t('extraScreens.radar.feedNoSources')}{' '}
                  <button type="button" className="text-accent" onClick={() => navigate(routes.view.feed())}>{t('extraScreens.radar.openFeed')}</button>
                </div>
              )}
              {!sweep && (
                <div className="px-4 py-3 text-muted-foreground">{t('extraScreens.radar.noSweepYet', { hour: String(data.dailyHour).padStart(2, '0') })}</div>
              )}
              {sweep && syncState === 'running' && (
                <div className="px-4 py-3 text-muted-foreground" role="status">{t('extraScreens.radar.sweepRunning')}</div>
              )}
              {sweep && syncState === 'missing' && (
                <div className="px-4 py-3 text-muted-foreground">{t('extraScreens.radar.sweepMissing')}</div>
              )}
              {sweep && syncState === 'failed' && (
                <div className="px-4 py-3 text-muted-foreground">
                  {t('extraScreens.radar.sweepUnparsed')}{' '}
                  <button type="button" className="text-accent" onClick={() => navigate(routes.view.allSessions(sweep.sessionId))}>{t('extraScreens.common.openSession')}</button>
                </div>
              )}
              {sweep?.notes && syncState === 'done' && (
                <div className="px-4 py-2 text-[12px] text-muted-foreground">{t('extraScreens.radar.agentNotes')}: {sweep.notes}</div>
              )}
              {BUCKETS.map((bucket) => groups[bucket].length > 0 && (
                <div key={bucket}>
                  <GroupLabel>{t(`extraScreens.radar.bucket.${bucket}`)} · {groups[bucket].length}</GroupLabel>
                  {groups[bucket].map((item) => (
                    <ListRow key={item.id} active={item.id === itemId} onClick={() => select(item.id)}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{item.title}</div>
                        <div className="truncate text-[12px] text-muted-foreground">
                          {[item.origin === 'local' ? t(`extraScreens.radar.local.${item.ref?.kind ?? 'session'}`) : item.source, item.topic, item.reaction]
                            .filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {item.origin === 'local' && <Chip>{t('extraScreens.radar.inRox')}</Chip>}
                    </ListRow>
                  ))}
                </div>
              ))}
              {visibleCount === 0 && (syncState === 'done' || !sweep) && (
                <div className="px-4 py-3 text-muted-foreground">{t('extraScreens.radar.nothingNew', { n: data.topics.length })}</div>
              )}
            </>
          )}
        </div>
      </ScreenColumn>

      <ScreenDetail>
        {selectedTopic ? (
          <TopicEditor
            key={selectedTopic.id}
            topic={selectedTopic}
            onUpdate={(patch) => updateTopic(selectedTopic.id, patch)}
            onDelete={() => { save({ ...data, topics: data.topics.filter((topic) => topic.id !== selectedTopic.id) }); select(null) }}
          />
        ) : selectedItem ? (
          <ItemDetail key={selectedItem.id} item={selectedItem} language={language} onDismiss={() => dismiss(selectedItem.id)} />
        ) : itemId ? (
          <ExtraScreenItemUnavailable screen="radar" itemId={itemId} />
        ) : (
          <EmptyState title={t('extraScreens.radar.pickTitle')} body={t('extraScreens.radar.pickBody')} />
        )}
      </ScreenDetail>
    </ScreenRoot>
  )
}

function ItemDetail({ item, language, onDismiss }: { item: RadarItem; language: 'ru' | 'en'; onDismiss: () => void }) {
  const { t } = useTranslation()
  const [taskId, setTaskId] = useState<string | null>(null)
  return (
    <div className="max-w-[760px]">
      <div className="text-[12px] text-muted-foreground">
        {[t(`extraScreens.radar.bucket.${item.bucket}`), item.origin === 'local' ? t('extraScreens.radar.inRox') : item.source, item.topic].filter(Boolean).join(' · ')}
      </div>
      <h2 className="mt-1 text-[19px] font-bold leading-tight">{item.title}</h2>
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
        <ScreenButton onClick={() => { const task = buildTaskFromItem(item); setTaskId(createPersonalTask(task).id) }}>
          {t('extraScreens.common.toTask')}
        </ScreenButton>
        <ScreenButton variant="ghost" onClick={onDismiss}>{t('extraScreens.radar.dismiss')}</ScreenButton>
      </div>
      {taskId && (
        <button type="button" className="mt-2 text-[12px] text-accent" onClick={() => navigate(routes.view.tasks(taskId))}>
          {t('extraScreens.common.taskCreated')}
        </button>
      )}
      <div className="mt-4 text-[12px] text-muted-foreground">{t('extraScreens.radar.draftOnly')}</div>
    </div>
  )
}

function TopicEditor({ topic, onUpdate, onDelete }: { topic: RadarTopic; onUpdate: (patch: Partial<RadarTopic>) => void; onDelete: () => void }) {
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
      />
      <div className="mt-3 flex gap-1">
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
        <TextField value={keyword} onChange={setKeyword} onEnter={addKeyword} placeholder={t('extraScreens.radar.keywordPlaceholder')} />
        <ScreenButton onClick={addKeyword} disabled={!keyword.trim()}>{t('extraScreens.common.add')}</ScreenButton>
      </div>
      <div className="mt-3 text-[12px] text-muted-foreground">{t('extraScreens.radar.topicHint')}</div>
      <div className="mt-6"><ScreenButton variant="danger" onClick={onDelete}>{t('extraScreens.common.delete')}</ScreenButton></div>
    </div>
  )
}

/**
 * «Досье» — cards for the people/companies Mark works with. List + detail
 * «перед созвоном» summary (who / what was promised / what is pending),
 * touches aggregated from sessions (incl. messenger-bound), meetings,
 * personal tasks and notes, and an agent-generated brief (local read-only
 * session). Nothing is sent anywhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { readAgentRun, startAgentRun, type AgentRunSnapshot } from '@/lib/extra-screens/agent-run'
import { createPersonalTask, isTaskOpen } from '@/lib/extra-screens/personal-task-bridge'
import { loadWorkspaceJson, newLocalId, saveWorkspaceJson, subscribeWorkspaceJson } from '@/lib/extra-screens/storage'
import {
  sessionTitle,
  useMeetings,
  externalFeedItems,
  useFeedItems,
  useMessengerBindings,
  usePersonalTasks,
  useWorkspaceSessions,
} from '@/lib/extra-screens/use-rox-sources'
import { cn } from '@/lib/utils'
import {
  AgentOutput,
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
  buildBriefPrompt,
  buildDossierSummary,
  filterEntities,
  initials,
  lastTouchFor,
  normalizeDossierData,
  sortEntitiesByLastTouch,
  suggestContacts,
  type DossierData,
  type DossierEntity,
  type DossierKind,
  type DossierSources,
  type DossierTouch,
  type NoteSource,
} from './dossier-model'
import { getSessionTitle } from '@/utils/session'
import { ExtraScreenItemUnavailable } from '../ExtraScreenItemUnavailable'

const NS = 'dossier'
const AVATAR_TONES = ['bg-accent/25', 'bg-info/25', 'bg-success/25', 'bg-warning/25', 'bg-foreground/15']

function toneFor(id: string): string {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}

function Avatar({ entity, size = 28 }: { entity: Pick<DossierEntity, 'id' | 'name'>; size?: number }) {
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-full font-bold text-foreground', toneFor(entity.id))}
      style={{ width: size, height: size, fontSize: size > 30 ? 15 : 12 }}
    >
      {initials(entity.name)}
    </span>
  )
}

function useRelativeDate() {
  const { t, i18n } = useTranslation()
  return useCallback((ts: number | null | undefined) => {
    if (ts == null) return '—'
    const d = new Date(ts)
    const today = new Date()
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    if (ts >= startToday) return t('extraScreens.common.today')
    if (ts >= startToday - 86400000) return t('extraScreens.common.yesterday')
    return d.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' })
  }, [i18n.language, t])
}

export default function DossierPage({ itemId }: { itemId: string | null }) {
  const { t, i18n } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [data, setData] = useState<DossierData>(() => loadWorkspaceJson(NS, workspaceId, normalizeDossierData))
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<DossierKind | 'all'>('all')
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftKind, setDraftKind] = useState<DossierKind>('person')
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setData(loadWorkspaceJson(NS, workspaceId, normalizeDossierData))
    return subscribeWorkspaceJson(NS, workspaceId, () => setData(loadWorkspaceJson(NS, workspaceId, normalizeDossierData)))
  }, [workspaceId])

  const save = useCallback((next: DossierData) => {
    setData(next)
    saveWorkspaceJson(NS, workspaceId, next)
  }, [workspaceId])

  const updateEntity = useCallback((id: string, patch: Partial<DossierEntity>) => {
    save({
      entities: data.entities.map((entity) => (entity.id === id ? { ...entity, ...patch, updatedAt: Date.now() } : entity)),
    })
  }, [data.entities, save])

  const sessions = useWorkspaceSessions(workspaceId)
  const tasks = usePersonalTasks()
  const { meetings } = useMeetings(workspaceId)
  const bindings = useMessengerBindings()
  const feed = useFeedItems(workspaceId)
  const now = Date.now()

  const messengerBySession = useMemo(() => {
    const map = new Map<string, string>()
    for (const binding of bindings) map.set(binding.sessionId, binding.platform)
    return map
  }, [bindings])

  const sources = useMemo<Omit<DossierSources, 'notes'>>(() => ({
    sessions: sessions.map((meta) => ({
      id: meta.id,
      name: sessionTitle(meta),
      lastMessageAt: meta.lastMessageAt,
      hasUnread: meta.hasUnread,
      messenger: messengerBySession.get(meta.id),
    })),
    meetings: meetings.map((meeting) => ({ id: meeting.id, title: meeting.title, at: meeting.at })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      notes: task.notes,
      open: isTaskOpen(task),
      dueAt: task.dueAt,
      createdAt: task.createdAt,
    })),
    feed: feed.available
      ? externalFeedItems(feed.items).map((item) => ({ id: item.id, title: item.title, at: item.at, summary: item.summary, author: item.author, sourceTitle: item.sourceTitle }))
      : null,
  }), [sessions, meetings, tasks, messengerBySession, feed])

  const rows = useMemo(() => {
    const filtered = filterEntities(data.entities, query, kindFilter)
    return sortEntitiesByLastTouch(filtered.map((entity) => ({ entity, ...lastTouchFor(entity, sources, now) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.entities, query, kindFilter, sources])

  const suggestions = useMemo(
    () => suggestContacts(bindings.filter((binding) => binding.enabled), data.entities).slice(0, 5),
    [bindings, data.entities],
  )

  const selected = itemId ? data.entities.find((entity) => entity.id === itemId) ?? null : null
  const select = useCallback((id: string | null) => navigate(routes.view.screen('dossier', id ?? undefined)), [])

  const addEntity = useCallback((name: string, kind: DossierKind) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const ts = Date.now()
    const entity: DossierEntity = {
      id: newLocalId('dos'),
      name: trimmed,
      kind,
      aliases: [],
      notes: '',
      promises: [],
      createdAt: ts,
      updatedAt: ts,
    }
    save({ entities: [entity, ...data.entities] })
    setDraftName('')
    setAdding(false)
    select(entity.id)
  }, [data.entities, save, select])

  // Keyboard: J/K move, / search, N new (ignored while typing).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'j' || event.key === 'k') {
        if (rows.length === 0) return
        const index = rows.findIndex((row) => row.entity.id === itemId)
        const next = event.key === 'j' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1)
        select(rows[next].entity.id)
        event.preventDefault()
      } else if (event.key === '/') {
        searchRef.current?.querySelector('input')?.focus()
        event.preventDefault()
      } else if (event.key === 'n') {
        setAdding(true)
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, itemId, select])

  const relDate = useRelativeDate()

  return (
    <ScreenRoot>
      <ScreenColumn width={380}>
        <ScreenHeader
          title={t('extraScreens.dossier.title')}
          subtitle={data.entities.length || undefined}
          actions={data.entities.length > 0 || adding ? <ScreenButton variant="primary" onClick={() => setAdding((v) => !v)}>＋ {t('extraScreens.dossier.add')}</ScreenButton> : undefined}
        />
        {adding && (
          <div className="flex flex-col gap-1.5 px-3 pb-2">
            <TextField
              autoFocus
              value={draftName}
              onChange={setDraftName}
              onEnter={() => addEntity(draftName, draftKind)}
              placeholder={t('extraScreens.dossier.namePlaceholder')}
            />
            <div className="flex items-center gap-1">
              <Chip active={draftKind === 'person'} onClick={() => setDraftKind('person')}>{t('extraScreens.dossier.person')}</Chip>
              <Chip active={draftKind === 'company'} onClick={() => setDraftKind('company')}>{t('extraScreens.dossier.company')}</Chip>
              <span className="flex-1" />
              <ScreenButton variant="primary" disabled={!draftName.trim()} onClick={() => addEntity(draftName, draftKind)}>
                {t('extraScreens.common.save')}
              </ScreenButton>
            </div>
          </div>
        )}
        <div ref={searchRef} className="px-3 pb-1.5">
          <TextField value={query} onChange={setQuery} placeholder={t('extraScreens.dossier.searchPlaceholder')} />
        </div>
        <div className="flex gap-1 px-3 pb-1">
          <Chip active={kindFilter === 'all'} onClick={() => setKindFilter('all')}>{t('extraScreens.common.all')}</Chip>
          <Chip active={kindFilter === 'person'} onClick={() => setKindFilter('person')}>{t('extraScreens.dossier.people')}</Chip>
          <Chip active={kindFilter === 'company'} onClick={() => setKindFilter('company')}>{t('extraScreens.dossier.companies')}</Chip>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          {rows.length > 0 && <GroupLabel>{t('extraScreens.dossier.recentTouches')}</GroupLabel>}
          {rows.map(({ entity, last, count30d }) => {
            const open = entity.promises.filter((p) => !p.done).length
            return (
              <ListRow key={entity.id} active={entity.id === itemId} onClick={() => select(entity.id)}>
                <Avatar entity={entity} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{entity.name}</div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {[entity.org, t('extraScreens.dossier.touches30d', { count: count30d }), open ? t('extraScreens.dossier.openPromises', { count: open }) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <span className="shrink-0 text-[12px] text-muted-foreground">{last ? relDate(last) : ''}</span>
              </ListRow>
            )
          })}
          {rows.length === 0 && data.entities.length > 0 && (
            <div className="px-4 py-6 text-muted-foreground">{t('extraScreens.common.nothingFound')}</div>
          )}
          {suggestions.length > 0 && (
            <>
              <GroupLabel>{t('extraScreens.dossier.suggestions')}</GroupLabel>
              {suggestions.map((suggestion) => (
                <div key={suggestion.name} className="mx-1.5 flex items-center gap-2.5 rounded-[6px] px-2.5 py-1.5">
                  <Chip>{suggestion.platform}</Chip>
                  <span className="min-w-0 flex-1 truncate">{suggestion.name}</span>
                  <ScreenButton variant="ghost" title={t('extraScreens.dossier.add')} onClick={() => addEntity(suggestion.name, 'person')}>＋</ScreenButton>
                </div>
              ))}
            </>
          )}
        </div>
      </ScreenColumn>
      <ScreenDetail>
        {itemId && !selected ? (
          <ExtraScreenItemUnavailable screen="dossier" itemId={itemId} />
        ) : data.entities.length === 0 ? (
          <EmptyState
            title={t('extraScreens.dossier.emptyTitle')}
            body={t('extraScreens.dossier.emptyBody')}
            action={<ScreenButton variant="primary" onClick={() => setAdding(true)}>＋ {t('extraScreens.dossier.add')}</ScreenButton>}
          />
        ) : selected ? (
          <DossierDetail
            key={selected.id}
            entity={selected}
            sources={sources}
            workspaceId={workspaceId}
            language={i18n.language.startsWith('ru') ? 'ru' : 'en'}
            onUpdate={(patch) => updateEntity(selected.id, patch)}
            onDelete={() => {
              if (!window.confirm(t('extraScreens.dossier.deleteConfirm', { name: selected.name }))) return
              save({ entities: data.entities.filter((entity) => entity.id !== selected.id) })
              select(null)
            }}
          />
        ) : (
          <EmptyState title={t('extraScreens.dossier.pickTitle')} body={t('extraScreens.dossier.pickBody')} />
        )}
      </ScreenDetail>
    </ScreenRoot>
  )
}

function touchIcon(kind: DossierTouch['kind']): string {
  switch (kind) {
    case 'messenger': return '✆'
    case 'session': return '◧'
    case 'meeting': return '◷'
    case 'task': return '☑'
    case 'note': return '✎'
    case 'feed': return '≋'
  }
}

function openTouch(touch: DossierTouch) {
  switch (touch.kind) {
    case 'session':
    case 'messenger':
      navigate(routes.view.allSessions(touch.id))
      return
    case 'meeting':
      navigate(routes.view.meetings(touch.id))
      return
    case 'task':
      navigate(routes.view.tasks(touch.id))
      return
    case 'note':
      navigate(routes.view.notes(touch.id))
      return
    case 'feed':
      navigate(routes.view.feed(touch.id))
      return
  }
}

function DossierDetail({
  entity,
  sources,
  workspaceId,
  language,
  onUpdate,
  onDelete,
}: {
  entity: DossierEntity
  sources: Omit<DossierSources, 'notes'>
  workspaceId: string | null
  language: 'ru' | 'en'
  onUpdate: (patch: Partial<DossierEntity>) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const relDate = useRelativeDate()
  const [notes, setNotes] = useState<NoteSource[]>([])
  const [aliasDraft, setAliasDraft] = useState('')
  const [promiseDraft, setPromiseDraft] = useState('')
  const [promiseDir, setPromiseDir] = useState<'mine' | 'theirs'>('mine')
  const [brief, setBrief] = useState<AgentRunSnapshot | null>(null)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [taskCreated, setTaskCreated] = useState<string | null>(null)

  // Notes: full-text search per term (name + up to 3 aliases).
  const termsKey = [entity.name, ...entity.aliases].join('|')
  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI
    if (!workspaceId || typeof api?.searchNotes !== 'function') {
      setNotes([])
      return
    }
    const terms = [entity.name, ...entity.aliases].filter((term) => term.trim().length >= 3).slice(0, 4)
    Promise.all(terms.map((term) => api.searchNotes(workspaceId, term).catch(() => [])))
      .then((results) => {
        if (cancelled) return
        const seen = new Map<string, NoteSource>()
        for (const list of results) for (const note of list) seen.set(note.id, { id: note.id, title: note.title, updatedAt: note.updatedAt })
        setNotes([...seen.values()])
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, termsKey])

  const summary = useMemo(
    () => buildDossierSummary(entity, { ...sources, notes }, Date.now()),
    [entity, sources, notes],
  )

  // Brief: re-read the brief session whenever its meta changes.
  const briefMeta = entity.briefSessionId ? sources.sessions.find((s) => s.id === entity.briefSessionId) : undefined
  useEffect(() => {
    let cancelled = false
    if (!entity.briefSessionId) {
      setBrief(null)
      return
    }
    const load = () => readAgentRun(entity.briefSessionId!).then((snapshot) => { if (!cancelled) setBrief(snapshot) })
    void load()
    const timer = window.setInterval(() => { void load() }, 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [entity.briefSessionId, briefMeta?.lastMessageAt])

  const generateBrief = async () => {
    if (!workspaceId) return
    setStarting(true)
    setBriefError(null)
    try {
      const sessionId = await startAgentRun({
        workspaceId,
        name: t('extraScreens.dossier.briefSessionName', { name: entity.name }),
        prompt: buildBriefPrompt(entity, summary, language),
      })
      onUpdate({ briefSessionId: sessionId })
    } catch (error) {
      setBriefError(error instanceof Error ? error.message : String(error))
    } finally {
      setStarting(false)
    }
  }

  const addAlias = () => {
    const alias = aliasDraft.trim()
    if (!alias || entity.aliases.includes(alias)) return
    onUpdate({ aliases: [...entity.aliases, alias] })
    setAliasDraft('')
  }

  const addPromise = () => {
    const text = promiseDraft.trim()
    if (!text) return
    onUpdate({ promises: [...entity.promises, { id: newLocalId('pr'), text, direction: promiseDir, done: false, createdAt: Date.now() }] })
    setPromiseDraft('')
  }

  const lastTouch = summary.touches.find((touch) => touch.at != null)

  return (
    <div className="max-w-[920px]">
      <div className="flex items-start gap-3">
        <Avatar entity={entity} size={40} />
        <div className="min-w-0 flex-1">
          <input
            aria-label={t('extraScreens.dossier.namePlaceholder')}
            defaultValue={entity.name}
            onBlur={(event) => { const v = event.target.value.trim(); if (v && v !== entity.name) onUpdate({ name: v }) }}
            className="w-full bg-transparent text-[19px] font-bold leading-tight outline-none focus-visible:rounded-[4px] focus-visible:bg-foreground/[0.05]"
          />
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
            <Chip active={entity.kind === 'person'} onClick={() => onUpdate({ kind: 'person' })}>{t('extraScreens.dossier.person')}</Chip>
            <Chip active={entity.kind === 'company'} onClick={() => onUpdate({ kind: 'company' })}>{t('extraScreens.dossier.company')}</Chip>
            <input
              aria-label={t('extraScreens.dossier.orgPlaceholder')}
              placeholder={t('extraScreens.dossier.orgPlaceholder')}
              defaultValue={entity.org ?? ''}
              onBlur={(event) => onUpdate({ org: event.target.value.trim() || undefined })}
              className="h-6 min-w-[160px] rounded-[6px] bg-transparent px-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:bg-foreground/[0.06]"
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[12px] text-muted-foreground">{t('extraScreens.dossier.aliases')}:</span>
            {entity.aliases.map((alias) => (
              <Chip key={alias} onClick={() => onUpdate({ aliases: entity.aliases.filter((a) => a !== alias) })}>
                {alias} <span aria-hidden>×</span>
              </Chip>
            ))}
            <input
              value={aliasDraft}
              onChange={(event) => setAliasDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addAlias() } }}
              placeholder={t('extraScreens.dossier.aliasPlaceholder')}
              aria-label={t('extraScreens.dossier.aliasPlaceholder')}
              className="h-6 w-[180px] rounded-[6px] bg-foreground/[0.05] px-1.5 text-[12px] outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <ScreenButton variant="danger" onClick={onDelete}>{t('extraScreens.common.delete')}</ScreenButton>
      </div>

      <Card accent>
        <CardTitle>{t('extraScreens.dossier.beforeCall')}</CardTitle>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div>
            <SectionLabel>{t('extraScreens.dossier.who')}</SectionLabel>
            <div className="text-foreground/90">
              {entity.org ? `${entity.org}. ` : ''}
              {lastTouch
                ? t('extraScreens.dossier.lastTouch', { when: relDate(lastTouch.at), where: lastTouch.title })
                : t('extraScreens.dossier.noTouches', { name: entity.name })}
            </div>
            <div className="mt-3"><SectionLabel>{t('extraScreens.dossier.pending')}</SectionLabel></div>
            {summary.openTasks.length === 0 && summary.unreadSessions.length === 0 && (
              <div className="text-muted-foreground">{t('extraScreens.dossier.nothingPending')}</div>
            )}
            {summary.openTasks.map((task) => (
              <button key={task.id} type="button" onClick={() => navigate(routes.view.tasks(task.id))} className="flex w-full items-center gap-2 py-0.5 text-left hover:text-accent">
                <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-[4px] bg-foreground/15" />
                <span className="truncate">{task.title}</span>
              </button>
            ))}
            {summary.unreadSessions.map((session) => (
              <button key={session.id} type="button" onClick={() => navigate(routes.view.allSessions(session.id))} className="flex w-full items-center gap-2 py-0.5 text-left hover:text-accent">
                <Chip tone="warn">{t('extraScreens.dossier.unread')}</Chip>
                <span className="truncate">{getSessionTitle(session)}</span>
              </button>
            ))}
          </div>
          <div>
            <SectionLabel>{t('extraScreens.dossier.promised')}</SectionLabel>
            {entity.promises.length === 0 && <div className="text-muted-foreground">{t('extraScreens.dossier.noPromises')}</div>}
            {[...summary.promisesMine, ...summary.promisesTheirs, ...summary.promisesDone].map((promise) => (
              <div key={promise.id} className="group flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={promise.done}
                  aria-label={promise.text}
                  onChange={() => onUpdate({ promises: entity.promises.map((p) => (p.id === promise.id ? { ...p, done: !p.done } : p)) })}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <Chip tone={promise.direction === 'mine' ? 'warn' : 'neutral'}>
                  {promise.direction === 'mine' ? t('extraScreens.dossier.iPromised') : t('extraScreens.dossier.theyPromised')}
                </Chip>
                <span className={cn('min-w-0 flex-1 truncate', promise.done && 'text-muted-foreground line-through')}>{promise.text}</span>
                {!promise.done && (
                  <ScreenButton
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => {
                      const task = createPersonalTask({ title: promise.text, notes: t('extraScreens.dossier.taskNote', { name: entity.name }) })
                      setTaskCreated(task.id)
                    }}
                  >
                    {t('extraScreens.common.toTask')}
                  </ScreenButton>
                )}
                <ScreenButton
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => onUpdate({ promises: entity.promises.filter((p) => p.id !== promise.id) })}
                >
                  ×
                </ScreenButton>
              </div>
            ))}
            <div className="mt-1.5 flex items-center gap-1">
              <Chip active={promiseDir === 'mine'} onClick={() => setPromiseDir('mine')}>{t('extraScreens.dossier.iPromised')}</Chip>
              <Chip active={promiseDir === 'theirs'} onClick={() => setPromiseDir('theirs')}>{t('extraScreens.dossier.theyPromised')}</Chip>
              <TextField value={promiseDraft} onChange={setPromiseDraft} onEnter={addPromise} placeholder={t('extraScreens.dossier.promisePlaceholder')} className="h-7" />
            </div>
            {taskCreated && (
              <button type="button" className="mt-1 text-[12px] text-accent" onClick={() => navigate(routes.view.tasks(taskCreated))}>
                {t('extraScreens.common.taskCreated')}
              </button>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>{t('extraScreens.dossier.briefTitle')}</CardTitle>
        <div className="mb-2 mt-0.5 text-[12px] text-muted-foreground">
          {!entity.briefSessionId
            ? t('extraScreens.dossier.briefNone')
            : brief?.processing
              ? t('extraScreens.common.agentWorking')
              : brief && !brief.exists
                ? t('extraScreens.common.agentSessionMissing')
                : brief?.text
                  ? t('extraScreens.dossier.briefReady', { when: brief.updatedAt ? new Date(brief.updatedAt).toLocaleString() : '' })
                  : t('extraScreens.common.agentWaiting')}
        </div>
        {brief?.text && <AgentOutput text={brief.text} />}
        {briefError && <div className="text-destructive">{briefError}</div>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ScreenButton variant={entity.briefSessionId ? 'default' : 'primary'} disabled={starting || !workspaceId || brief?.processing} onClick={() => void generateBrief()}>
            {entity.briefSessionId ? t('extraScreens.dossier.briefRefresh') : t('extraScreens.dossier.briefGenerate')}
          </ScreenButton>
          {entity.briefSessionId && (
            <ScreenButton onClick={() => navigate(routes.view.allSessions(entity.briefSessionId))}>{t('extraScreens.common.openSession')}</ScreenButton>
          )}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">{t('extraScreens.common.agentReadOnly')}</div>
      </Card>

      <div className="mt-5">
        <SectionLabel>{t('extraScreens.dossier.touchesTitle', { count: summary.touches.length })}</SectionLabel>
        {summary.touches.length === 0 && (
          <div className="text-muted-foreground">{t('extraScreens.dossier.noTouchesHint', { name: entity.name })}</div>
        )}
        {summary.touches.slice(0, 40).map((touch) => (
          <button
            key={`${touch.kind}:${touch.id}`}
            type="button"
            onClick={() => openTouch(touch)}
            className="flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left hover:bg-foreground/5"
          >
            <span aria-hidden className="w-4 shrink-0 text-center text-muted-foreground">{touchIcon(touch.kind)}</span>
            <span className="w-16 shrink-0 text-[12px] text-muted-foreground">{relDate(touch.at)}</span>
            <span className="text-[12px] text-muted-foreground">{t(`extraScreens.dossier.touchKind.${touch.kind}`)}{touch.hint && (touch.kind === 'messenger' || touch.kind === 'feed') ? ` · ${touch.hint}` : ''}</span>
            <span className="min-w-0 flex-1 truncate">{touch.title}</span>
          </button>
        ))}
        {!summary.feedAvailable && <div className="mt-1 text-[12px] text-muted-foreground">{t('extraScreens.dossier.feedUnavailable')}</div>}
      </div>

      <div className="mt-5">
        <SectionLabel>{t('extraScreens.dossier.notesTitle')}</SectionLabel>
        <TextArea
          value={entity.notes}
          onChange={(value) => onUpdate({ notes: value })}
          placeholder={t('extraScreens.dossier.notesPlaceholder')}
          rows={4}
        />
      </div>
    </div>
  )
}

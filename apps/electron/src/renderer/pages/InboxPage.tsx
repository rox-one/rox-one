/**
 * Входящие — one queue for everything waiting on me: agent permission and
 * credential requests, plans, knowledge (memory) proposals, skill candidates,
 * new messenger senders and unread agent replies. Every action goes through
 * the existing IPC for that source; done/snooze is renderer-only triage.
 * Mail (Rox Mail over JMAP, local Stalwart pilot) has its own «Почта»
 * section; unread inbox mail also surfaces in «Все». Meeting proposals have
 * no list RPC yet — stated, not faked.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtom } from 'jotai'
import { inboxPreferencesAtom } from '@/atoms/inbox'
import { decideRecipientRequest, selectInboxForUser } from '@craft-agent/shared/team'
import { TEAM_FLAG, dispatchTeam, readTeamState, teamActionContext, useTeamFlag, useTeamState } from '@/components/team/team-store'
import { useTeamRoster } from '@/components/team/use-team-roster'
import { useTranslation } from 'react-i18next'
import { navigate, routes } from '@/lib/navigate'
import { useInboxItems } from '@/hooks/useInboxItems'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  GroupLabel,
  ListHeader,
  ListRow,
  ModeScreenLayout,
  SectionLabel,
  useListKeys,
  type Tone,
} from '@/components/mode-screen/ModeScreen'
import {
  filterInbox,
  markDone,
  reopen,
  snooze,
  snoozeTargets,
  sortInbox,
  type CredentialLike,
  type InboxFilter,
  type InboxItem,
  type InboxKind,
  type MemoryProposalLike,
  type PendingSenderLike,
  type PendingSkillLike,
  type PermissionLike,
} from './inbox/inbox-model'
import type { MailFolder } from '../../shared/mail-local'
import { useMail } from './inbox/mail/useMail'
import { MailCompose, MailListPanel, MailReader, folderLabel, useComposeState } from './inbox/mail/MailPanels'
import { emailIdFromItem, mailItemId, mailToInboxItem, statusKey } from './inbox/mail/mail-view'
import type { TeamInboxItem } from '@craft-agent/shared/team'
import { InboxSidebar, InboxKindIcon, isMailFilter, type InboxPageFilter } from './inbox/InboxSidebar'

const KIND_TONE: Record<InboxKind, Tone> = {
  permission: 'warning',
  credential: 'warning',
  plan: 'accent',
  memory: 'info',
  skill: 'info',
  sender: 'muted',
  reply: 'muted',
  error: 'danger',
  mail: 'info',
  'team-recipient': 'info',
}

const KINDS: readonly InboxKind[] = ['permission', 'credential', 'plan', 'memory', 'skill', 'sender', 'reply', 'error', 'team-recipient']

export default function InboxPage({ selectedId }: { selectedId?: string | null }) {
  const { t, i18n } = useTranslation()
  const teamInboxEnabled = useTeamFlag(TEAM_FLAG.mentions)
  const teamState = useTeamState()
  const teamRoster = useTeamRoster()
  const teamInboxConnected = teamRoster.sync.state === 'connected'
  const trustedViewer = teamRoster.identityAuthority === 'native' && !!teamRoster.identityIssuer
  const teamInbox = useMemo(
    () => teamInboxEnabled && teamInboxConnected && trustedViewer && teamRoster.selfUserId &&
      teamRoster.members.some((member) => member.userId === teamRoster.selfUserId)
      ? selectInboxForUser(teamState, teamRoster.selfUserId)
      : [],
    [teamInboxEnabled, teamInboxConnected, trustedViewer, teamRoster.selfUserId, teamRoster.members, teamState],
  )
  const { items, state, setState, counts, now, errors, staleSources, reload, workspaceId, shell, sessions } = useInboxItems({ withRemote: true, teamInbox })
  const [preferences, setPreferences] = useAtom(inboxPreferencesAtom)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<InboxPageFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkAction, setBulkAction] = useState<'read' | 'archive' | null>(null)
  const [bulkFailures, setBulkFailures] = useState<Record<string, string>>({})
  const [bulkBusy, setBulkBusy] = useState(false)
  const mail = useMail({ active: true })
  const composeState = useComposeState(mail)
  const [mailSelected, setMailSelected] = useState<string | null>(null)
  const [pinnedMail, setPinnedMail] = useState<InboxItem | null>(null)
  const inMail = isMailFilter(filter)
  const [localSelected, setLocalSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [planPath, setPlanPath] = useState<string | null>(null)
  const routeBound = selectedId !== undefined
  const currentId = routeBound ? selectedId ?? null : localSelected
  const select = useCallback((id: string | null) => {
    if (routeBound) navigate(routes.view.inbox(id ?? undefined))
    else setLocalSelected(id)
  }, [routeBound])

  const locale = i18n.resolvedLanguage || i18n.language
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), [locale])
  const when = (at: number) => (new Date(at).toDateString() === new Date(now).toDateString() ? timeFmt.format(at) : dateFmt.format(at))

  // Unread inbox mail joins «Все»/«Сообщения»; the open one stays pinned after it is marked read.
  const noSubject = t('inbox.mail.noSubject')
  const mailReady = mail.status?.state === 'ready'
  const unreadMailIds = useMemo(() => new Set(mail.unread.map((m) => mailItemId(m.id))), [mail.unread])
  const mailItems = useMemo(() => {
    if (!mailReady) return []
    const list = mail.unread.map((m) => mailToInboxItem(m, noSubject))
    if (pinnedMail && !unreadMailIds.has(pinnedMail.id)) list.push(pinnedMail)
    return list
  }, [mailReady, mail.unread, noSubject, pinnedMail, unreadMailIds])
  const allItems = useMemo(() => {
    if (!mailItems.length) return items
    return sortInbox([...items, ...mailItems])
  }, [items, mailItems])
  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  const matchesQuery = useCallback((item: InboxItem) => {
    if (preferences.signalFilter === 'signal' && item.group !== 'decision') return false
    if (preferences.signalFilter === 'noise' && item.group !== 'message') return false
    const unread = item.kind === 'mail'
      ? unreadMailIds.has(item.id)
      : item.group === 'message' && state.done[item.id] === undefined
    if (preferences.unreadOnly && !unread) return false
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return true
    const sessionPreview = item.sessionId ? sessionById.get(item.sessionId)?.preview ?? '' : ''
    const recipientText = item.kind === 'team-recipient' ? (item.data as TeamInboxItem).text ?? '' : ''
    return `${item.id}\n${item.title}\n${item.source}\n${sessionPreview}\n${recipientText}`.toLocaleLowerCase().includes(needle)
  }, [preferences.signalFilter, preferences.unreadOnly, query, sessionById, state.done, unreadMailIds])
  const visible = useMemo(
    () => (isMailFilter(filter) ? [] : filterInbox(allItems, state, filter, now).filter(matchesQuery)),
    [allItems, state, filter, now, matchesQuery],
  )
  const selected = useMemo(() => (inMail ? null : visible.find((i) => i.id === currentId) ?? null), [visible, currentId, inMail])
  const selectedEmailId = selected?.kind === 'mail' ? emailIdFromItem(selected.id) : null
  const decisions = visible.filter((i) => i.group === 'decision')
  const messages = visible.filter((i) => i.group === 'message')
  const ordered = useMemo(() => [...decisions, ...messages], [decisions, messages])
  const visibleBlockingCount = visible.reduce((count, item) => count + (item.blocking ? 1 : 0), 0)
  const countFor = (view: InboxFilter) => filterInbox(allItems, state, view, now).filter(matchesQuery).length
  const filteredCounts = {
    all: countFor('all'),
    decisions: countFor('decisions'),
    messages: countFor('messages'),
    snoozed: countFor('snoozed'),
    done: countFor('done'),
    blocking: filterInbox(allItems, state, 'all', now).filter(matchesQuery).filter((item) => item.blocking).length,
    byKind: Object.fromEntries(KINDS.concat('mail').map((kind) => [kind, countFor({ kind })])) as typeof counts.byKind,
  }

  useEffect(() => {
    if (inMail) return
    if (selectedEmailId && selected) {
      setPinnedMail(selected)
      void mail.open(selectedEmailId)
    } else {
      setPinnedMail(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmailId, inMail])

  const selectMail = useCallback((id: string | null) => {
    setMailSelected(id)
    composeState.close()
    void mail.open(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mail.open])
  const openFolder = (f: MailFolder) => {
    setFilter({ mail: f.id })
    mail.setFolder({ folderId: f.id === 'inbox' ? null : f.id, role: f.role })
    selectMail(null)
  }
  const mailNext = (id: string) => {
    const idx = mail.items.findIndex((i) => i.id === id)
    return mail.items[idx + 1]?.id ?? mail.items[idx - 1]?.id ?? null
  }

  useEffect(() => {
    setActionError(null)
    setPlanPath(null)
    if (selected?.kind === 'plan' && selected.sessionId) {
      void window.electronAPI?.getPendingPlanExecution?.(selected.sessionId).then((p) => setPlanPath(p?.planPath ?? null)).catch(() => undefined)
    }
  }, [selected?.id, selected?.kind, selected?.sessionId])

  const nextAfter = (id: string) => {
    const idx = ordered.findIndex((i) => i.id === id)
    return ordered[idx + 1]?.id ?? ordered[idx - 1]?.id ?? null
  }

  const done = async (item: InboxItem) => {
    if (busy === item.id) return
    const next = nextAfter(item.id)
    setBusy(item.id)
    setActionError(null)
    try {
      if (item.kind === 'team-recipient') throw new Error('This team request needs its authorized recipient action')
      if (item.kind === 'mail') {
        const emailId = emailIdFromItem(item.id)
        if (!emailId) throw new Error('Mail item has no source ID')
        if (unreadMailIds.has(item.id)) await mail.act((a) => a.setFlags([emailId], { seen: true }))
        setPinnedMail(null)
        select(next)
        return
      }
      if ((item.kind === 'reply' || item.kind === 'error') && item.sessionId) {
        const markRead = window.electronAPI?.sessionCommand
        if (!markRead) throw new Error('Session read action is unavailable')
        await markRead(item.sessionId, { type: 'markRead' })
      }
      setState((s) => markDone(s, item.id, Date.now()))
      select(next)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const runBulk = async (action: 'read' | 'archive', ids: string[]) => {
    setBulkBusy(true)
    setBulkAction(action)
    setBulkFailures({})
    const failed: Record<string, string> = {}
    const succeeded = new Set<string>()
    for (const id of ids) {
      const item = allItems.find((candidate) => candidate.id === id)
      try {
        if (!item) throw new Error('Item is no longer available')
        if (item.kind === 'team-recipient') throw new Error('This team request needs its authorized recipient action')
        if (action === 'archive') {
          if (item.kind !== 'mail') throw new Error('Only mail messages can be archived')
          const emailId = emailIdFromItem(item.id)
          if (!emailId) throw new Error('Mail item has no source ID')
          await mail.act((a) => a.move([emailId], 'archive'))
        } else if (item.kind === 'mail') {
          const emailId = emailIdFromItem(item.id)
          if (!emailId) throw new Error('Mail item has no source ID')
          if (unreadMailIds.has(item.id)) await mail.act((a) => a.setFlags([emailId], { seen: true }))
          setPinnedMail((current) => current?.id === item.id ? null : current)
        } else if (item.kind === 'reply' || item.kind === 'error') {
          const markRead = window.electronAPI?.sessionCommand
          if (!item.sessionId || !markRead) throw new Error('Session read action is unavailable')
          await markRead(item.sessionId, { type: 'markRead' })
          setState((current) => markDone(current, item.id, Date.now()))
        } else {
          setState((current) => markDone(current, item.id, Date.now()))
        }
        succeeded.add(id)
      } catch (error) {
        failed[id] = error instanceof Error ? error.message : String(error)
      }
    }
    setBulkFailures(failed)
    setSelectedIds((current) => new Set([...current].filter((id) => !succeeded.has(id))))
    setBulkBusy(false)
  }
  const snoozeItem = (item: InboxItem, until: number) => {
    const next = nextAfter(item.id)
    setState((s) => snooze(s, item.id, until))
    select(next)
  }
  const openSession = (item: InboxItem) => {
    if (item.sessionId) navigate(routes.view.allSessions(item.sessionId))
  }

  const run = async (item: InboxItem, fn: () => Promise<unknown> | void, after?: () => void) => {
    setBusy(item.id)
    setActionError(null)
    try {
      await fn()
      after?.()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const decideTeamRequest = (item: InboxItem, decision: 'accepted' | 'rejected') => run(item, () => {
    if (!trustedViewer || !teamRoster.identityIssuer || !teamRoster.selfUserId) {
      throw new Error('A trusted recipient identity is required')
    }
    const request = item.data as TeamInboxItem
    if (!request.requestId) throw new Error('Team request has no stable ID')
    const previous = readTeamState()
    try {
      const persisted = dispatchTeam((current) => decideRecipientRequest(
        current,
        teamActionContext(teamRoster.selfUserId!),
        request.requestId!,
        decision,
      ))
      if (!persisted) {
        dispatchTeam(() => previous)
        throw new Error('The recipient decision could not be saved locally')
      }
    } catch (error) {
      if (readTeamState() !== previous) dispatchTeam(() => previous)
      throw error
    }
  })

  const onListKeys = useListKeys(ordered, selected && ordered.includes(selected) ? selected : null, (i) => select(i.id), openSession)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (target?.closest('[data-inbox-sidebar]')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (inMail) {
        const m = mail.message && mail.message.id === mailSelected ? mail.message : null
        if (!m || composeState.compose) return
        const next = mailNext(m.id)
        if (event.key === 'e') { event.preventDefault(); void mail.act((a) => a.move([m.id], 'archive')).then(() => selectMail(next), (e) => mail.setError(String(e))) }
        if (event.key === '#') { event.preventDefault(); void mail.act((a) => a.remove([m.id])).then(() => selectMail(next), (e) => mail.setError(String(e))) }
        if (event.key === 'r') { event.preventDefault(); composeState.start('reply', m) }
        if (event.key === 'Escape') selectMail(null)
        return
      }
      if (!selected) return
      if (event.key === 'e') { event.preventDefault(); done(selected) }
      if (event.key === 's' && selected.kind !== 'mail') { event.preventDefault(); snoozeItem(selected, snoozeTargets(Date.now()).tomorrow) }
      if (event.key === 'r' && selected.kind === 'mail' && mail.message) { event.preventDefault(); composeState.start('reply', mail.message) }
      if (event.key === 'Escape') select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const kindLabel = (kind: InboxKind) => t(`inbox.kind.${kind}`)

  const navigator = <InboxSidebar filter={filter} counts={filteredCounts} onSelect={setFilter} mail={mail} onSelectFolder={openFolder}
    onOpenMeetings={() => navigate(routes.view.meetings())} onConnectTeam={() => navigate(routes.view.settings('organizations'))}
    teamNeedsConnection={teamInboxEnabled && !teamInboxConnected} />

  const row = (item: InboxItem) => {
    const sourceKey = item.kind === 'memory' ? 'memory' : item.kind === 'skill' ? 'skills' : item.kind === 'sender' ? 'senders' : null
    const stale = sourceKey !== null && staleSources.includes(sourceKey)
    const unread = item.kind === 'mail' ? unreadMailIds.has(item.id) : item.group === 'message' && state.done[item.id] === undefined
    return (
      <ListRow
        key={item.id}
        testId={`inbox-row-${item.kind}`}
        selected={item.id === currentId}
        unread={unread}
        onClick={() => select(item.id)}
      >
        <input
          type="checkbox"
          aria-label={t('inbox.selectItem', { title: item.title, defaultValue: `Select ${item.title}` })}
          checked={selectedIds.has(item.id)}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => toggleSelected(item.id, event.currentTarget.checked)}
          className="mt-1 size-3.5 shrink-0 accent-[var(--accent)]"
        />
        <InboxKindIcon kind={item.kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-text-muted">{kindLabel(item.kind)} · {item.source}</span>
          <span className={`block truncate ${unread || item.blocking ? 'font-semibold' : ''}`}>{item.title}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-[11px] tabular-nums text-text-muted">{when(item.at)}</span>
          {item.blocking ? <Badge tone="warning">{t('inbox.blocking')}</Badge> : null}
          {stale ? <Badge tone="warning">{t('inbox.staleSource', { defaultValue: 'Stale' })}</Badge> : null}
        </span>
      </ListRow>
    )
  }

  const errorEntries = Object.entries(errors).filter(([, v]) => v)
  const mailFolder = inMail ? mail.folders.find((f) => f.id === filter.mail) : undefined
  const selectedVisibleIds = visible.filter((item) => selectedIds.has(item.id)).map((item) => item.id)
  const selectedMailIds = visible.filter((item) => selectedIds.has(item.id) && item.kind === 'mail').map((item) => item.id)
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selectedIds.has(item.id))
  const listPanel = inMail ? (
    <MailListPanel
      mail={mail}
      title={mailFolder ? folderLabel(t, mailFolder) : t('inbox.kind.mail')}
      selectedId={mailSelected}
      onSelect={selectMail}
      onCompose={() => composeState.start('new', null)}
    />
  ) : (
    <>
      <ListHeader
        title={typeof filter === 'object' ? kindLabel(filter.kind) : t(`inbox.view.${filter}`)}
        subtitle={visibleBlockingCount ? t('inbox.blockingCount', { count: visibleBlockingCount }) : undefined}
        actions={<Button variant="ghost" onClick={() => void reload()}>{t('inbox.refresh')}</Button>}
      />
      <div className="mx-3 flex flex-wrap items-center gap-1.5 border-b border-foreground/[0.08] py-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t('inbox.searchPlaceholder', { defaultValue: 'Search inbox' })}
          aria-label={t('inbox.searchPlaceholder', { defaultValue: 'Search inbox' })}
          className="min-w-[120px] flex-1 rounded-[5px] border border-foreground/10 bg-background px-2 py-1 text-[12px] outline-none focus:border-accent"
        />
        <Button variant={preferences.signalFilter === 'all' ? 'primary' : 'ghost'} onClick={() => setPreferences((p) => ({ ...p, signalFilter: 'all' }))}>{t('inbox.view.all')}</Button>
        <Button variant={preferences.signalFilter === 'signal' ? 'primary' : 'ghost'} onClick={() => setPreferences((p) => ({ ...p, signalFilter: 'signal' }))}>{t('inbox.signal', { defaultValue: 'Signal' })}</Button>
        <Button variant={preferences.signalFilter === 'noise' ? 'primary' : 'ghost'} onClick={() => setPreferences((p) => ({ ...p, signalFilter: 'noise' }))}>{t('inbox.noise', { defaultValue: 'Noise' })}</Button>
        <label className="flex items-center gap-1.5 px-1 text-[11px] text-text-secondary">
          <input
            type="checkbox"
            checked={preferences.unreadOnly}
            onChange={(event) => setPreferences((p) => ({ ...p, unreadOnly: event.currentTarget.checked }))}
            className="size-3.5 accent-[var(--accent)]"
          />
          {t('inbox.unreadOnly', { defaultValue: 'Unread only' })}
        </label>
      </div>
      <div className="mx-3 flex flex-wrap items-center gap-1.5 border-b border-foreground/[0.08] py-1.5 text-[11px]">
        <input
          type="checkbox"
          aria-label={t('inbox.selectAll', { defaultValue: 'Select all matching' })}
          checked={allVisibleSelected}
          onChange={(event) => {
            const checked = event.currentTarget.checked
            setSelectedIds((current) => {
              const next = new Set(current)
              for (const item of visible) checked ? next.add(item.id) : next.delete(item.id)
              return next
            })
          }}
          className="size-3.5 accent-[var(--accent)]"
        />
        <span>{t('inbox.selectedCount', { count: selectedVisibleIds.length, defaultValue: `${selectedVisibleIds.length} selected` })}</span>
        <Button variant="ghost" disabled={selectedIds.size === 0} onClick={() => setSelectedIds(new Set())}>{t('inbox.clearSelection', { defaultValue: 'Clear selection' })}</Button>
        <Button variant="ghost" disabled={bulkBusy || selectedVisibleIds.length === 0} onClick={() => void runBulk('read', selectedVisibleIds)}>{t('inbox.bulkMarkRead', { defaultValue: 'Mark selected done/read' })}</Button>
        <Button variant="ghost" disabled={bulkBusy || selectedMailIds.length === 0} onClick={() => void runBulk('archive', selectedMailIds)}>{t('inbox.bulkArchive', { defaultValue: 'Archive selected mail' })}</Button>
        {Object.keys(bulkFailures).length > 0 ? (
          <Button variant="ghost" disabled={bulkBusy || !bulkAction} onClick={() => bulkAction && void runBulk(bulkAction, Object.keys(bulkFailures))}>
            {t('inbox.retryFailed', { defaultValue: 'Retry failed items' })} ({Object.keys(bulkFailures).length})
          </Button>
        ) : null}
      </div>
      {Object.keys(bulkFailures).length > 0 ? (
        <div role="alert" className="mx-3 mt-1 rounded-[6px] bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
          {t('inbox.failedIds', { items: Object.keys(bulkFailures).join(', '), defaultValue: `Failed items: ${Object.keys(bulkFailures).join(', ')}` })}
          {Object.entries(bulkFailures).map(([id, error]) => <div key={id}>{id}: {error}</div>)}
        </div>
      ) : null}
      {errorEntries.length ? (
        <div role="alert" className="mx-3 mt-1 rounded-[6px] bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
          {t('inbox.sourceError', { sources: errorEntries.map(([k]) => t(`inbox.source.${k}`)).join(', ') })}
        </div>
      ) : null}
      <div role="listbox" aria-label={t('inbox.title')} className="min-h-0 flex-1 overflow-y-auto pb-3" onKeyDown={onListKeys} data-testid="inbox-list">
        {visible.length === 0 ? (
          <EmptyState
            testId="inbox-empty"
            title={query.trim() ? t('inbox.empty.search', { defaultValue: 'No matching items' }) : filter === 'done' ? t('inbox.empty.doneTitle') : filter === 'snoozed' ? t('inbox.empty.snoozedTitle') : t('inbox.empty.zeroTitle')}
            body={!query.trim() && (filter === 'all' || filter === 'decisions') ? t('inbox.empty.zeroBody') : undefined}
          />
        ) : (
          <>
            {decisions.length ? <GroupLabel>{t('inbox.group.decisions')}</GroupLabel> : null}
            {decisions.map(row)}
            {messages.length ? <GroupLabel>{t('inbox.group.messages')}</GroupLabel> : null}
            {messages.map(row)}
          </>
        )}
      </div>
    </>
  )

  const commonActions = (item: InboxItem) => {
    const targets = snoozeTargets(now)
    const isDone = state.done[item.id] !== undefined
    return (
      <div className="flex flex-wrap items-center gap-1.5 pt-4">
        {item.kind !== 'team-recipient' ? (isDone ? (
          <Button onClick={() => setState((s) => reopen(s, item.id))}>{t('inbox.reopen')}</Button>
        ) : (
          <Button disabled={busy === item.id} onClick={() => void done(item)} title="E">{t('inbox.done')}</Button>
        )) : null}
        <span className="pl-2 text-[11px] text-text-muted">{t('inbox.snooze')}:</span>
        <Button variant="ghost" onClick={() => snoozeItem(item, targets.laterToday)}>{t('inbox.snoozeLaterToday')}</Button>
        <Button variant="ghost" onClick={() => snoozeItem(item, targets.tomorrow)} title="S">{t('inbox.snoozeTomorrow')}</Button>
        <Button variant="ghost" onClick={() => snoozeItem(item, targets.nextWeek)}>{t('inbox.snoozeNextWeek')}</Button>
      </div>
    )
  }

  const detailBody = (item: InboxItem) => {
    const isBusy = busy === item.id
    switch (item.kind) {
      case 'permission': {
        const req = item.data as PermissionLike
        const respond = shell?.onRespondToPermission
        return (
          <>
            <p className="text-[13px] text-text-secondary">{req.reason || req.description}</p>
            {req.command ? <pre className="mt-2 overflow-x-auto rounded-[6px] bg-foreground/[0.05] p-2.5 font-mono text-[12px]">{req.command}</pre> : null}
            <p className="pt-2 text-[12px] text-text-muted">{t('inbox.permission.tool', { tool: req.toolName })}</p>
            <div className="flex flex-wrap gap-1.5 pt-3">
              <Button variant="primary" data-testid="inbox-allow" disabled={!respond || isBusy} onClick={() => void run(item, () => respond?.(item.sessionId!, req.requestId, true, false))}>{t('inbox.permission.allow')}</Button>
              <Button disabled={!respond || isBusy} onClick={() => void run(item, () => respond?.(item.sessionId!, req.requestId, true, true))}>{t('inbox.permission.allowAlways', { tool: req.toolName })}</Button>
              <Button variant="danger" data-testid="inbox-deny" disabled={!respond || isBusy} onClick={() => void run(item, () => respond?.(item.sessionId!, req.requestId, false, false))}>{t('inbox.permission.deny')}</Button>
              <Button variant="ghost" onClick={() => openSession(item)}>{t('inbox.replyToAgent')}</Button>
            </div>
          </>
        )
      }
      case 'credential': {
        const req = item.data as CredentialLike & { hint?: string }
        const respond = shell?.onRespondToCredential
        return (
          <>
            <p className="text-[13px] text-text-secondary">{req.description || t('inbox.credential.body', { source: req.sourceName || req.sourceSlug })}</p>
            {req.hint ? <p className="pt-1 text-[12px] text-text-muted">{req.hint}</p> : null}
            <p className="pt-2 text-[12px] text-text-muted">{t('inbox.credential.safety')}</p>
            <div className="flex flex-wrap gap-1.5 pt-3">
              <Button variant="primary" onClick={() => openSession(item)}>{t('inbox.credential.enter')}</Button>
              <Button variant="danger" disabled={!respond || isBusy} onClick={() => void run(item, () => respond?.(item.sessionId!, req.requestId, { type: 'credential', cancelled: true }))}>{t('inbox.credential.decline')}</Button>
            </div>
          </>
        )
      }
      case 'plan':
        return (
          <>
            <p className="text-[13px] text-text-secondary">{t('inbox.plan.body')}</p>
            {planPath ? <p className="pt-2 font-mono text-[12px] text-text-muted">{planPath}</p> : null}
            <div className="flex flex-wrap gap-1.5 pt-3">
              <Button variant="primary" onClick={() => openSession(item)}>{t('inbox.plan.open')}</Button>
            </div>
          </>
        )
      case 'memory': {
        const proposal = item.data as MemoryProposalLike & { conflicts?: Array<{ existingRule: string; relation: string }> }
        return (
          <>
            <Card><p className="whitespace-pre-wrap text-[13px]">{proposal.text}</p></Card>
            {proposal.conflicts?.length ? (
              <>
                <SectionLabel>{t('inbox.memory.conflicts')}</SectionLabel>
                {proposal.conflicts.map((c) => <p key={c.existingRule} className="text-[12px] text-text-secondary">{c.existingRule}</p>)}
              </>
            ) : null}
            <div className="flex flex-wrap gap-1.5 pt-3">
              <Button variant="primary" disabled={!workspaceId || isBusy} onClick={() => void run(item, () => window.electronAPI.approveMemoryProposal(workspaceId!, proposal.id, 'global'), () => void reload('memory'))}>{t('inbox.memory.approve')}</Button>
              <Button variant="danger" disabled={!workspaceId || isBusy} onClick={() => void run(item, () => window.electronAPI.rejectMemoryProposal(workspaceId!, proposal.id), () => void reload('memory'))}>{t('inbox.memory.reject')}</Button>
              {item.sessionId ? <Button variant="ghost" onClick={() => openSession(item)}>{t('inbox.openSession')}</Button> : null}
            </div>
          </>
        )
      }
      case 'skill': {
        const skill = item.data as PendingSkillLike
        return (
          <>
            <p className="text-[13px] text-text-secondary">{skill.description}</p>
            <div className="flex flex-wrap gap-1.5 pt-3">
              <Button variant="primary" disabled={!workspaceId || isBusy} onClick={() => void run(item, () => window.electronAPI.approvePendingSkill(workspaceId!, skill.slug), () => void reload('skills'))}>{t('inbox.skill.approve')}</Button>
              <Button variant="danger" disabled={!workspaceId || isBusy} onClick={() => void run(item, () => window.electronAPI.dismissPendingSkill(workspaceId!, skill.slug), () => void reload('skills'))}>{t('inbox.skill.dismiss')}</Button>
            </div>
          </>
        )
      }
      case 'sender': {
        const sender = item.data as PendingSenderLike
        const key = { reason: sender.reason as never, bindingId: sender.bindingId }
        return (
          <>
            <p className="text-[13px] text-text-secondary">{t('inbox.sender.body', { platform: sender.platform, count: sender.attemptCount })}</p>
            {sender.username ? <p className="pt-1 text-[12px] text-text-muted">@{sender.username} · {sender.userId}</p> : null}
            <div className="flex flex-wrap gap-1.5 pt-3">
              <Button variant="primary" disabled={isBusy} onClick={() => void run(item, () => window.electronAPI.allowMessagingPendingSender(sender.platform, sender.userId, key), () => void reload('senders'))}>{t('inbox.sender.allow')}</Button>
              <Button variant="danger" disabled={isBusy} onClick={() => void run(item, () => window.electronAPI.dismissMessagingPendingSender(sender.platform, sender.userId, key), () => void reload('senders'))}>{t('inbox.sender.dismiss')}</Button>
            </div>
          </>
        )
      }
      case 'team-recipient': {
        const request = item.data as TeamInboxItem
        const ref = item.sourceRef
        return (
          <>
            <Card>
              <p className="whitespace-pre-wrap text-[13px]">{request.text || request.target.title || ''}</p>
              <p className="pt-1 text-[11px] text-text-muted">{request.fromUserId}</p>
              {request.pendingAction ? (
                <p role="status" className="pt-2 text-[12px] text-text-secondary">
                  {t('inbox.recipientQueued', {
                    action: t(request.pendingAction === 'accepted' ? 'inbox.recipientAccept' : 'inbox.recipientReject'),
                    defaultValue: `Decision queued: ${request.pendingAction}; awaiting server acknowledgment.`,
                  })}
                </p>
              ) : null}
              {ref ? <p className="pt-2 font-mono text-[11px] text-text-muted">{ref.organizationId} · {ref.requestId} · {ref.targetKind}:{ref.targetId}@{ref.targetRevision}</p> : null}
            </Card>
            {!request.pendingAction ? (
              <div className="flex flex-wrap gap-1.5 pt-3">
                <Button variant="primary" disabled={!trustedViewer || isBusy || !request.requestId} onClick={() => void decideTeamRequest(item, 'accepted')}>{t('inbox.recipientAccept')}</Button>
                <Button variant="danger" disabled={!trustedViewer || isBusy || !request.requestId} onClick={() => void decideTeamRequest(item, 'rejected')}>{t('inbox.recipientReject')}</Button>
              </div>
            ) : null}
            <p role="status" className="pt-2 text-[12px] text-text-muted">
              {t('inbox.recipientActionUnavailable', { defaultValue: 'The server must acknowledge this recipient decision before access changes.' })}
            </p>
          </>
        )
      }
      case 'reply':
      case 'error':
        return (
          <>
            <p className="text-[13px] text-text-secondary">{item.kind === 'error' ? t('inbox.reply.errorBody') : t('inbox.reply.body')}</p>
            <div className="flex flex-wrap gap-1.5 pt-3">
              <Button variant="primary" onClick={() => openSession(item)}>{t('inbox.openSession')}</Button>
            </div>
          </>
        )
    }
  }

  const composeDetail = composeState.compose ? (
    <MailCompose key={composeState.compose.key} mail={mail} draft={composeState.compose.draft} source={composeState.compose.source} onClose={() => composeState.close()} />
  ) : null
  const openMessage = mail.message
  const detail = composeDetail ?? (inMail ? (
    openMessage && openMessage.id === mailSelected ? (
      <MailReader
        mail={mail}
        message={openMessage}
        onCompose={(mode) => composeState.start(mode, openMessage)}
        onEditDraft={composeState.edit}
        onAfterRemove={() => selectMail(mailNext(openMessage.id))}
      />
    ) : (
      <EmptyState title={t('inbox.selectTitle')} body={t('inbox.selectBody')} />
    )
  ) : selected?.kind === 'mail' ? (
    <div className="flex flex-col" data-testid="inbox-detail" data-kind="mail">
      {openMessage && openMessage.id === selectedEmailId ? (
        <MailReader
          compact
          mail={mail}
          message={openMessage}
          onCompose={(mode) => composeState.start(mode, openMessage)}
          onEditDraft={composeState.edit}
          onAfterRemove={() => { setPinnedMail(null); select(nextAfter(selected.id)) }}
        />
      ) : null}
      <div className="px-5 pb-4">
        <Button disabled={busy === selected.id} onClick={() => void done(selected)} title="E">{t('inbox.done')}</Button>
      </div>
    </div>
  ) : selected ? (
    <div className="flex flex-col px-5 py-4" data-testid="inbox-detail" data-kind={selected.kind}>
      <div className="flex items-center gap-2 text-[12px] text-text-muted">
        <Badge tone={KIND_TONE[selected.kind]}>{kindLabel(selected.kind)}</Badge>
        <span className="truncate">{selected.source}</span>
        <span className="ml-auto tabular-nums">{when(selected.at)}</span>
      </div>
      <h2 className="pt-2 text-[17px] font-semibold">{selected.title}</h2>
      <div className="pt-2">{detailBody(selected)}</div>
      {actionError ? <p role="alert" className="pt-2 text-[12px] text-destructive">{actionError}</p> : null}
      {commonActions(selected)}
    </div>
  ) : currentId ? (
    <EmptyState title={t('inbox.resolvedTitle')} body={t('inbox.resolvedBody')} action={<Button onClick={() => select(null)}>{t('common.backToList')}</Button>} />
  ) : (
    <EmptyState title={t('inbox.selectTitle')} body={t('inbox.selectBody')} />
  ))

  const status = (
    <>
      <span>{t('inbox.status.blocking', { count: counts.blocking })}</span>
      <span aria-hidden>·</span>
      <span data-testid="mail-status">{t(statusKey(mail.status), { address: mail.status?.address ?? '', url: mail.status?.serverUrl ?? '', error: mail.status?.error ?? '', flag: mail.status?.flag ?? '' })}</span>
    </>
  )

  return <ModeScreenLayout testId="inbox-page" navigator={navigator} list={listPanel} detail={detail} status={status} />
}

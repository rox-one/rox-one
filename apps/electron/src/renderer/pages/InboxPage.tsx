/**
 * Входящие — one queue for everything waiting on me: agent permission and
 * credential requests, plans, knowledge (memory) proposals, skill candidates,
 * new messenger senders and unread agent replies. Every action goes through
 * the existing IPC for that source; done/snooze is renderer-only triage.
 * Mail is not connected (no JMAP bridge) and meeting proposals have no
 * list RPC yet — both are stated, not faked.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTeamInboxNav } from '@/components/team/TeamInboxNavItem'
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
  NavItem,
  NavSection,
  NavTitle,
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
  type CredentialLike,
  type InboxFilter,
  type InboxItem,
  type InboxKind,
  type MemoryProposalLike,
  type PendingSenderLike,
  type PendingSkillLike,
  type PermissionLike,
} from './inbox/inbox-model'

const KIND_GLYPH: Record<InboxKind, string> = {
  permission: '⚿',
  credential: '⚷',
  plan: '☰',
  memory: '▤',
  skill: '✦',
  sender: '☺',
  reply: '◧',
  error: '!',
}

const KIND_TONE: Record<InboxKind, Tone> = {
  permission: 'warning',
  credential: 'warning',
  plan: 'accent',
  memory: 'info',
  skill: 'info',
  sender: 'muted',
  reply: 'muted',
  error: 'danger',
}

const KINDS: readonly InboxKind[] = ['permission', 'credential', 'plan', 'memory', 'skill', 'sender', 'reply', 'error']

function sameFilter(a: InboxFilter, b: InboxFilter): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b
  return a.kind === b.kind
}

export default function InboxPage({ selectedId }: { selectedId?: string | null }) {
  const teamInbox = useTeamInboxNav()
  const { t, i18n } = useTranslation()
  const { items, state, setState, counts, now, errors, reload, workspaceId, shell } = useInboxItems({ withRemote: true })
  const [filter, setFilter] = useState<InboxFilter>('all')
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

  const visible = useMemo(() => filterInbox(items, state, filter, now), [items, state, filter, now])
  const selected = useMemo(() => items.find((i) => i.id === currentId) ?? null, [items, currentId])
  const decisions = visible.filter((i) => i.group === 'decision')
  const messages = visible.filter((i) => i.group === 'message')
  const ordered = useMemo(() => [...decisions, ...messages], [decisions, messages])

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

  const done = (item: InboxItem) => {
    const next = nextAfter(item.id)
    setState((s) => markDone(s, item.id, Date.now()))
    if (item.kind === 'reply' || item.kind === 'error') {
      if (item.sessionId) void window.electronAPI?.sessionCommand?.(item.sessionId, { type: 'markRead' })
    }
    select(next)
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

  const onListKeys = useListKeys(ordered, selected && ordered.includes(selected) ? selected : null, (i) => select(i.id), openSession)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (event.metaKey || event.ctrlKey || event.altKey || !selected) return
      if (event.key === 'e') { event.preventDefault(); done(selected) }
      if (event.key === 's') { event.preventDefault(); snoozeItem(selected, snoozeTargets(Date.now()).tomorrow) }
      if (event.key === 'Escape') select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const kindLabel = (kind: InboxKind) => t(`inbox.kind.${kind}`)

  const navigator = (
    <>
      <NavTitle>{t('inbox.title')}</NavTitle>
      <NavItem label={t('inbox.view.all')} count={counts.all} active={sameFilter(filter, 'all')} onClick={() => setFilter('all')} testId="inbox-nav-all" />
      <NavItem label={t('inbox.view.decisions')} count={counts.decisions} dot={counts.blocking ? 'warning' : undefined} active={sameFilter(filter, 'decisions')} onClick={() => setFilter('decisions')} testId="inbox-nav-decisions" />
      <NavItem label={t('inbox.view.messages')} count={counts.messages} active={sameFilter(filter, 'messages')} onClick={() => setFilter('messages')} />
      <NavItem label={t('inbox.view.snoozed')} count={counts.snoozed} active={sameFilter(filter, 'snoozed')} onClick={() => setFilter('snoozed')} />
      <NavItem label={t('inbox.view.done')} count={counts.done} active={sameFilter(filter, 'done')} onClick={() => setFilter('done')} />
      <NavSection title={t('inbox.types')}>
        {KINDS.map((kind) => (
          <NavItem
            key={kind}
            label={kindLabel(kind)}
            count={counts.byKind[kind]}
            active={sameFilter(filter, { kind })}
            onClick={() => setFilter({ kind })}
          />
        ))}
      </NavSection>
      <NavSection title={t('inbox.notConnected')}>
        <NavItem label={t('inbox.kind.meetingProposals')} dot="muted" onClick={() => navigate(routes.view.meetings())} testId="inbox-nav-meetings" />
        <NavItem label={t('inbox.kind.mail')} dot="muted" disabled />
        {teamInbox.enabled && !teamInbox.connected ? (
          <NavItem label={t('teamCollab.inboxNav')} count={teamInbox.count || undefined} dot="muted" onClick={() => navigate(routes.view.settings('organizations'))} testId="inbox-nav-team" />
        ) : null}
      </NavSection>
    </>
  )

  const row = (item: InboxItem) => (
    <ListRow
      key={item.id}
      testId={`inbox-row-${item.kind}`}
      selected={item.id === currentId}
      unread={item.group === 'message' && state.done[item.id] === undefined}
      onClick={() => select(item.id)}
    >
      <span aria-hidden className="w-4 shrink-0 pt-px text-center text-text-muted">{KIND_GLYPH[item.kind]}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-text-muted">{kindLabel(item.kind)} · {item.source}</span>
        <span className={`block truncate ${item.group === 'message' || item.blocking ? 'font-semibold' : ''}`}>{item.title}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-[11px] tabular-nums text-text-muted">{when(item.at)}</span>
        {item.blocking ? <Badge tone="warning">{t('inbox.blocking')}</Badge> : null}
      </span>
    </ListRow>
  )

  const errorEntries = Object.entries(errors).filter(([, v]) => v)
  const listPanel = (
    <>
      <ListHeader
        title={typeof filter === 'object' ? kindLabel(filter.kind) : t(`inbox.view.${filter}`)}
        subtitle={counts.blocking ? t('inbox.blockingCount', { count: counts.blocking }) : undefined}
        actions={<Button variant="ghost" onClick={() => void reload()}>{t('inbox.refresh')}</Button>}
      />
      {errorEntries.length ? (
        <div role="alert" className="mx-3 mt-1 rounded-[6px] bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
          {t('inbox.sourceError', { sources: errorEntries.map(([k]) => t(`inbox.source.${k}`)).join(', ') })}
        </div>
      ) : null}
      <div role="listbox" aria-label={t('inbox.title')} className="min-h-0 flex-1 overflow-y-auto pb-3" onKeyDown={onListKeys} data-testid="inbox-list">
        {visible.length === 0 ? (
          <EmptyState
            testId="inbox-empty"
            title={filter === 'done' ? t('inbox.empty.doneTitle') : filter === 'snoozed' ? t('inbox.empty.snoozedTitle') : t('inbox.empty.zeroTitle')}
            body={filter === 'all' || filter === 'decisions' ? t('inbox.empty.zeroBody') : undefined}
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
        {isDone ? (
          <Button onClick={() => setState((s) => reopen(s, item.id))}>{t('inbox.reopen')}</Button>
        ) : (
          <Button onClick={() => done(item)} title="E">{t('inbox.done')}</Button>
        )}
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

  const detail = selected ? (
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
  )

  const status = (
    <>
      <span>{t('inbox.status.blocking', { count: counts.blocking })}</span>
      <span aria-hidden>·</span>
      <span>{t('inbox.status.mail')}</span>
    </>
  )

  return <ModeScreenLayout testId="inbox-page" navigator={navigator} list={listPanel} detail={detail} status={status} />
}

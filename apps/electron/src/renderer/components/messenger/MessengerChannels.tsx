/**
 * Team messenger — Slack-like channels and group chats (phase 1).
 *
 * Left: the org's shared default channel, public/private channels and group
 * chats the viewer can see, plus a create form. Right: the conversation with
 * join / leave / follow-in-Лента controls and a composer. All data comes from
 * teamChat:* (host store, org-membership checked server-side).
 */
import { onMessengerCreateRequest, takeMessengerCreateRequest } from '@/platform/messenger-create-request'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { Archive, Bell, BellOff, Hash, Lock, LogIn, LogOut, MessagesSquare, PanelRight, Phone, Plus, ScrollText, Search, Send, Sparkles, Users } from 'lucide-react'
import type { TeamChannelKind, TeamChannelMessage, TeamChannelView, TeamChannelVisibility } from '@rox/shared/team-chat'
import type { TeamMemberRef } from '@rox/shared/team'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { messengerStatusAtom } from '@/atoms/messenger-status'
import { teamChatErrorText, useTeamChannels, useTeamMessages, useTeamSearch } from './use-team-chat'
import { useTeamCall } from './use-team-call'
import { Avatar, ChannelInfoPanel, type Presence } from './ChannelInfoPanel'
import { CallStage } from './CallStage'
import { MessageBody } from './message-cards'

const NAME_MAX = 80
const MESSAGE_MAX = 4000

export interface MessengerChannelsProps {
  orgId: string
  selfUserId: string | null
  members: TeamMemberRef[]
  /** Org owner/admin may archive any non-default channel. */
  viewerOrgRole?: string
}

function ChannelIcon({ channel, className }: { channel: Pick<TeamChannelView, 'kind' | 'visibility'>; className?: string }) {
  const Icon = channel.kind === 'group' ? Users : channel.visibility === 'private' ? Lock : Hash
  return <Icon className={cn('size-3.5 shrink-0', className)} aria-hidden />
}

function channelLabel(channel: TeamChannelView, t: (k: string) => string): string {
  return channel.isDefault ? t('messenger.channels.general') : channel.name
}

export function MessengerChannels({ orgId, selfUserId, members, viewerOrgRole }: MessengerChannelsProps) {
  const { t, i18n } = useTranslation()
  const channels = useTeamChannels(orgId)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState<TeamChannelKind | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [infoOpen, setInfoOpen] = React.useState(true)
  const [query, setQuery] = React.useState('')
  const search = useTeamSearch(orgId, query)
  const selfName = React.useMemo(() => members.find(m => m.userId === selfUserId)?.displayName ?? t('teamCollab.you'), [members, selfUserId, t])
  const call = useTeamCall({ selfName })

  // Global «+» → group/channel: open the create form preset to that kind.
  React.useEffect(() => {
    const initial = takeMessengerCreateRequest()
    if (initial) setCreating(initial)
    return onMessengerCreateRequest(() => {
      const kind = takeMessengerCreateRequest()
      if (kind) setCreating(kind)
    })
  }, [])

  const selected = channels.channels.find(c => c.id === selectedId) ?? channels.channels[0] ?? null
  const messages = useTeamMessages(selected?.id ?? null)
  const nameOf = React.useMemo(() => {
    const map = new Map(members.map(m => [m.userId, m.displayName]))
    return (userId: string) => (userId === selfUserId ? t('teamCollab.you') : map.get(userId) ?? userId.slice(0, 8))
  }, [members, selfUserId, t])

  // Presence: in a live call (any channel) → «call»; this device → online; else offline.
  const inCallIds = React.useMemo(() => new Set(channels.channels.flatMap(c => c.activeCall?.participantIds ?? [])), [channels.channels])
  const presenceOf = React.useCallback((userId: string): Presence => inCallIds.has(userId) ? 'call' : userId === selfUserId ? 'online' : 'offline', [inCallIds, selfUserId])
  const onlineCount = selected ? selected.memberIds.filter(id => presenceOf(id) !== 'offline').length : 0
  const inThisCall = call.status === 'connected' && call.channelId === selected?.id
  const joining = call.status === 'connecting'

  // Status bar: open channel + unread total + live call.
  const setStatus = useSetAtom(messengerStatusAtom)
  const unreadTotal = channels.channels.reduce((n, c) => n + c.unreadCount, 0)
  React.useEffect(() => {
    setStatus(selected ? { channelLabel: channelLabel(selected, t), unreadTotal, callLive: !!selected.activeCall } : null)
  }, [selected, unreadTotal, setStatus, t])
  React.useEffect(() => () => setStatus(null), [setStatus])

  const run = React.useCallback(async (action: () => Promise<unknown>) => {
    setActionError(null)
    try { await action(); await channels.reload() } catch (error) { setActionError(teamChatErrorText(error)) }
  }, [channels])

  const joinCall = React.useCallback(() => {
    if (!selected) return
    void (async () => {
      if (!selected.viewerRole && selected.visibility === 'public') await window.electronAPI.teamChatJoin(selected.id)
      await call.join(selected.id)
      await channels.reload()
    })().catch(error => setActionError(teamChatErrorText(error)))
  }, [call, channels, selected])

  const rooms = channels.channels.filter(c => c.kind === 'channel')
  const groups = channels.channels.filter(c => c.kind === 'group')
  const rowProps = (channel: TeamChannelView) => ({
    channel, active: channel.id === selected?.id, label: channelLabel(channel, t), onSelect: () => setSelectedId(channel.id),
    preview: previewOf(channel, nameOf, t), locale: i18n.language,
  })

  return (
    <div className="flex min-h-0 flex-1" data-testid="messenger-channels">
      <aside className="flex w-64 shrink-0 flex-col border-e border-border/60" aria-label={t('messenger.channels.listLabel')}>
        <div className="px-2 pt-2">
          <label className="flex h-8 items-center gap-2 rounded-md bg-surface-input px-2 text-small text-text-muted">
            <Search className="icon-caption shrink-0" aria-hidden />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('messenger.channels.searchPlaceholder')} aria-label={t('messenger.channels.searchPlaceholder')} className="min-w-0 flex-1 bg-transparent text-text-primary outline-none" data-testid="messenger-search" />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {query.trim().length >= 2 ? (
            <SearchResults search={search} channels={channels.channels} nameOf={nameOf} onOpen={(id) => { setSelectedId(id); setQuery('') }} label={c => channelLabel(c, t)} />
          ) : (
            <>
              <SectionHeader title={t('messenger.channels.channels')} onAdd={() => setCreating('channel')} addLabel={t('messenger.channels.newChannel')} />
              <ul className="mb-3 flex flex-col">
                {rooms.map(channel => <ChannelRow key={channel.id} {...rowProps(channel)} />)}
              </ul>
              <SectionHeader title={t('messenger.channels.groups')} onAdd={() => setCreating('group')} addLabel={t('messenger.channels.newGroup')} />
              <ul className="flex flex-col">
                {groups.length === 0 ? <li className="px-2 py-1 text-caption text-text-muted">{t('messenger.channels.noGroups')}</li> : null}
                {groups.map(channel => <ChannelRow key={channel.id} {...rowProps(channel)} label={channel.name} />)}
              </ul>
            </>
          )}
        </div>
        {creating ? (
          <CreateChannelForm
            kind={creating}
            members={members.filter(m => m.userId !== selfUserId)}
            onCancel={() => setCreating(null)}
            onCreate={async (input) => {
              setActionError(null)
              try {
                const view = await window.electronAPI.teamChatCreateChannel({ orgId, ...input })
                setCreating(null)
                await channels.reload()
                setSelectedId(view.id)
              } catch (error) {
                setActionError(teamChatErrorText(error))
              }
            }}
          />
        ) : null}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col" aria-label={selected ? channelLabel(selected, t) : t('messenger.channels.title')}>
        {channels.loading ? (
          <p className="p-4 text-small text-text-secondary" role="status">{t('teamCollab.loading')}</p>
        ) : channels.error ? (
          <p className="p-4 text-small text-destructive" role="alert">{channels.error}</p>
        ) : !selected ? (
          <p className="p-4 text-small text-text-secondary">{t('messenger.channels.empty')}</p>
        ) : (
          <>
            <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
              <ChannelIcon channel={selected} className="text-text-muted" />
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <h2 className="truncate text-body font-semibold">{channelLabel(selected, t)}</h2>
                <p className="truncate text-caption text-text-muted" data-testid="messenger-header-meta">
                  {t('messenger.channels.memberCount', { count: selected.memberCount })} · {t('messenger.channels.onlineCount', { count: onlineCount })}
                  {selected.topic ? ` · ${selected.topic}` : ''}
                </p>
              </div>
              <ul className="flex -space-x-1.5" aria-label={t('messenger.info.memberList')}>
                {selected.memberIds.slice(0, 5).map(id => <li key={id} title={nameOf(id)}><Avatar name={nameOf(id)} className="size-6 ring-2 ring-background" /></li>)}
                {selected.memberIds.length > 5 ? <li className="ps-2.5 text-caption text-text-muted">+{selected.memberIds.length - 5}</li> : null}
              </ul>
              {!inThisCall ? (
                <Button size="sm" variant={selected.activeCall ? 'default' : 'secondary'} onClick={joinCall} disabled={joining || (!selected.viewerRole && selected.visibility !== 'public')} data-testid="messenger-join-call"
                  className={cn(selected.activeCall && 'bg-success text-white hover:bg-success/90')}>
                  <Phone aria-hidden />{selected.activeCall ? t('messenger.calls.join') : t('messenger.calls.start')}
                </Button>
              ) : null}
              {selected.visibility === 'public' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost" size="icon"
                      aria-pressed={selected.viewerSubscribed}
                      aria-label={selected.viewerSubscribed ? t('messenger.channels.unfollow') : t('messenger.channels.follow')}
                      onClick={() => void run(() => window.electronAPI.teamChatSetSubscribed(selected.id, !selected.viewerSubscribed))}
                    >
                      {selected.viewerSubscribed ? <BellOff aria-hidden /> : <Bell aria-hidden />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{selected.viewerSubscribed ? t('messenger.channels.unfollow') : t('messenger.channels.follow')} — {t('messenger.channels.followHint')}</TooltipContent>
                </Tooltip>
              ) : null}
              {!selected.viewerRole && selected.visibility === 'public' ? (
                <Button size="sm" variant="secondary" onClick={() => void run(() => window.electronAPI.teamChatJoin(selected.id))}>
                  <LogIn aria-hidden />{t('messenger.channels.join')}
                </Button>
              ) : null}
              {selected.viewerRole && !selected.isDefault ? (
                <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={t('messenger.channels.leave')} onClick={() => void run(async () => { if (call.channelId === selected.id) await call.leave(); await window.electronAPI.teamChatLeave(selected.id, orgId); setSelectedId(null) })}>
                  <LogOut aria-hidden />
                </Button></TooltipTrigger><TooltipContent>{t('messenger.channels.leave')}</TooltipContent></Tooltip>
              ) : null}
              {!selected.isDefault && (selected.viewerRole === 'owner' || selected.viewerRole === 'admin' || viewerOrgRole === 'owner' || viewerOrgRole === 'admin') ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t('messenger.channels.archive')}
                      onClick={() => {
                        if (!window.confirm(t('messenger.channels.archiveConfirm', { name: selected.name }))) return
                        void run(async () => { if (call.channelId === selected.id) await call.leave(); await window.electronAPI.teamChatArchive(selected.id, orgId); setSelectedId(null) })
                      }}
                    >
                      <Archive aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('messenger.channels.archive')}</TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-pressed={infoOpen} onClick={() => setInfoOpen(v => !v)} aria-label={t('messenger.info.title')}>
                <PanelRight aria-hidden />
              </Button></TooltipTrigger><TooltipContent>{t('messenger.info.title')}</TooltipContent></Tooltip>
            </header>
            {inThisCall || (joining && call.channelId === selected.id) ? <CallStage call={call} /> : null}
            {call.status === 'error' && call.channelId === selected.id ? <p className="border-b border-border/60 px-4 py-1.5 text-caption text-destructive" role="alert">{call.error}</p> : null}
            {actionError ? <p className="border-b border-border/60 px-4 py-1.5 text-caption text-destructive" role="alert">{actionError}</p> : null}
            <MessageList
              loading={messages.loading}
              error={messages.error}
              messages={messages.messages}
              nameOf={nameOf}
              locale={i18n.language}
            />
            {selected.viewerRole ? (
              <Composer
                key={selected.id}
                placeholder={t('messenger.channels.composerPlaceholder', { name: channelLabel(selected, t) })}
                onSend={async (text) => {
                  await window.electronAPI.teamChatPost(selected.id, text)
                  await messages.reload()
                }}
              />
            ) : (
              <p className="border-t border-border/60 px-4 py-3 text-caption text-text-muted">{t('messenger.channels.joinToPost')}</p>
            )}
          </>
        )}
      </section>
      {selected && infoOpen ? (
        <ChannelInfoPanel
          channel={selected}
          label={channelLabel(selected, t)}
          members={members}
          presenceOf={presenceOf}
          nameOf={nameOf}
          messageCount={selected.lastSeq}
          inCall={inThisCall}
          joining={joining}
          onJoinCall={joinCall}
          onClose={() => setInfoOpen(false)}
          locale={i18n.language}
        />
      ) : null}
    </div>
  )
}

function previewOf(channel: TeamChannelView, nameOf: (id: string) => string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const m = channel.lastMessage
  if (!m) return ''
  if (m.kind === 'system') return m.event === 'call.started' ? t('messenger.calls.startedBy', { name: nameOf(m.senderId) }) : t('messenger.calls.ended')
  if (m.kind === 'transcript') return t('messenger.calls.transcriptPreview')
  if (m.kind === 'summary') return t('messenger.calls.summaryPreview')
  return `${nameOf(m.senderId)}: ${m.text.replace(/\s+/g, ' ')}`
}

function SearchResults({ search, channels, nameOf, onOpen, label }: {
  search: ReturnType<typeof useTeamSearch>
  channels: TeamChannelView[]
  nameOf: (id: string) => string
  onOpen: (channelId: string) => void
  label: (c: TeamChannelView) => string
}) {
  const { t } = useTranslation()
  const byId = new Map(channels.map(c => [c.id, c]))
  if (search.loading) return <p className="px-2 text-caption text-text-muted" role="status">{t('teamCollab.loading')}</p>
  if (search.error) return <p className="px-2 text-caption text-destructive" role="alert">{search.error}</p>
  if (!search.results.length) return <p className="px-2 text-caption text-text-muted">{t('messenger.channels.searchEmpty')}</p>
  return (
    <ul className="flex flex-col gap-1" data-testid="messenger-search-results">
      {search.results.map(m => {
        const channel = byId.get(m.channelId)
        return (
          <li key={m.id}>
            <button type="button" className="flex w-full flex-col rounded-md px-2 py-1.5 text-start hover:bg-surface-hover" onClick={() => onOpen(m.channelId)}>
              <span className="flex items-center gap-1 text-caption text-text-muted">
                {m.kind === 'transcript' ? <ScrollText className="icon-caption" aria-hidden /> : m.kind === 'summary' ? <Sparkles className="icon-caption" aria-hidden /> : null}
                {channel ? label(channel) : ''} · {m.kind === 'transcript' ? t('messenger.calls.transcriptPreview') : m.kind === 'summary' ? t('messenger.calls.summaryPreview') : nameOf(m.senderId)}
              </span>
              <span className="line-clamp-2 text-small">{m.text}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function SectionHeader({ title, onAdd, addLabel }: { title: string; onAdd: () => void; addLabel: string }) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 pt-1">
      <h3 className="text-caption font-medium uppercase caps-label text-text-muted">{title}</h3>
      <button type="button" className="rounded p-0.5 text-text-muted hover:bg-surface-hover hover:text-text-primary" onClick={onAdd} aria-label={addLabel} title={addLabel}>
        <Plus className="icon-caption" aria-hidden />
      </button>
    </div>
  )
}

function ChannelRow({ channel, active, label, onSelect, preview, locale }: { channel: TeamChannelView; active: boolean; label: string; onSelect: () => void; preview: string; locale: string }) {
  const when = channel.lastMessage?.createdAt
  const time = when ? new Intl.DateTimeFormat(locale, Date.now() - when < 86_400_000 ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(when) : ''
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        data-channel-id={channel.id}
        className={cn(
          'flex w-full items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-start hover:bg-surface-hover',
          active && 'bg-surface-hover',
          !channel.viewerRole && 'text-text-secondary',
        )}
      >
        <ChannelIcon channel={channel} className="mt-1 text-text-muted" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn('min-w-0 flex-1 truncate text-body', (active || channel.unreadCount > 0) && 'font-medium')}>{label}</span>
            {channel.activeCall ? <Phone className="icon-status shrink-0 text-success" aria-hidden /> : null}
            {channel.viewerSubscribed ? <Bell className="icon-status shrink-0 text-text-muted" aria-hidden /> : null}
            {time ? <span className="shrink-0 text-caption text-text-muted">{time}</span> : null}
          </span>
          {preview ? (
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-caption text-text-muted">{preview}</span>
              {channel.unreadCount > 0 ? (
                <span className="rounded-full bg-accent px-1.5 text-caption font-medium text-accent-foreground" data-testid="messenger-unread">{channel.unreadCount > 99 ? '99+' : channel.unreadCount}</span>
              ) : null}
            </span>
          ) : channel.unreadCount > 0 ? (
            <span className="rounded-full bg-accent px-1.5 text-caption font-medium text-accent-foreground" data-testid="messenger-unread">{channel.unreadCount > 99 ? '99+' : channel.unreadCount}</span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

function CreateChannelForm({ kind, members, onCancel, onCreate }: {
  kind: TeamChannelKind
  members: TeamMemberRef[]
  onCancel: () => void
  onCreate: (input: { name: string; kind: TeamChannelKind; visibility: TeamChannelVisibility; topic?: string; memberIds: string[] }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = React.useState('')
  const [topic, setTopic] = React.useState('')
  const [visibility, setVisibility] = React.useState<TeamChannelVisibility>('public')
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const isGroup = kind === 'group'
  return (
    <form
      className="flex shrink-0 flex-col gap-2 border-t border-border/60 p-2"
      data-testid="messenger-create-form"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!name.trim() || busy) return
        setBusy(true)
        try {
          await onCreate({ name: name.trim(), kind, visibility: isGroup ? 'private' : visibility, ...(topic.trim() ? { topic: topic.trim() } : {}), memberIds: [...picked] })
        } finally { setBusy(false) }
      }}
    >
      <h3 className="text-caption font-medium text-text-secondary">{isGroup ? t('messenger.channels.newGroup') : t('messenger.channels.newChannel')}</h3>
      <input
        autoFocus value={name} maxLength={NAME_MAX} onChange={e => setName(e.target.value)}
        placeholder={isGroup ? t('messenger.channels.groupNamePlaceholder') : t('messenger.channels.namePlaceholder')}
        aria-label={t('messenger.channels.name')}
        className="h-8 rounded-md border border-border bg-surface-input px-2 text-small"
      />
      {!isGroup ? (
        <>
          <input value={topic} maxLength={250} onChange={e => setTopic(e.target.value)} placeholder={t('messenger.channels.topicPlaceholder')} aria-label={t('messenger.channels.topic')} className="h-8 rounded-md border border-border bg-surface-input px-2 text-small" />
          <div className="flex gap-1" role="radiogroup" aria-label={t('messenger.channels.visibility')}>
            {(['public', 'private'] as const).map(v => (
              <button key={v} type="button" role="radio" aria-checked={visibility === v} onClick={() => setVisibility(v)}
                className={cn('flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-caption', visibility === v ? 'border-border-strong bg-surface-hover text-text-primary' : 'border-border text-text-secondary')}>
                {v === 'public' ? <Hash className="icon-status" aria-hidden /> : <Lock className="icon-status" aria-hidden />}
                {t(v === 'public' ? 'messenger.channels.public' : 'messenger.channels.private')}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {members.length > 0 && (isGroup || visibility === 'private') ? (
        <fieldset className="max-h-28 overflow-y-auto">
          <legend className="pb-1 text-caption text-text-muted">{t('messenger.channels.addMembers')}</legend>
          {members.map(m => (
            <label key={m.userId} className="flex items-center gap-2 px-1 py-0.5 text-small">
              <input type="checkbox" checked={picked.has(m.userId)} onChange={e => setPicked(prev => { const next = new Set(prev); if (e.target.checked) next.add(m.userId); else next.delete(m.userId); return next })} />
              <span className="truncate">{m.displayName}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" size="sm" disabled={!name.trim() || busy}>{t('messenger.channels.create')}</Button>
      </div>
    </form>
  )
}

function MessageList({ loading, error, messages, nameOf, locale }: {
  loading: boolean
  error: string | null
  messages: TeamChannelMessage[]
  nameOf: (userId: string) => string
  locale: string
}) {
  const { t } = useTranslation()
  const endRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])
  const time = React.useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), [locale])
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-testid="messenger-messages" aria-live="polite">
      {loading ? <p className="text-small text-text-secondary" role="status">{t('teamCollab.loading')}</p> : null}
      {error ? <p className="text-small text-destructive" role="alert">{error}</p> : null}
      {!loading && !error && messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-text-muted">
          <MessagesSquare className="icon-empty" aria-hidden />
          <p className="text-small">{t('messenger.channels.noMessages')}</p>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const grouped = prev && prev.kind !== 'system' && prev.senderId === m.senderId && m.senderId !== 'system' && m.createdAt - prev.createdAt < 5 * 60_000
          return (
            <li key={m.id} className={cn(!grouped && 'pt-1')}>
              {!grouped && m.kind !== 'system' ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-small font-semibold">{m.senderId === 'system' ? t('messenger.calls.botName') : nameOf(m.senderId)}</span>
                  <time className="text-caption text-text-muted" dateTime={new Date(m.createdAt).toISOString()}>{time.format(m.createdAt)}</time>
                </div>
              ) : null}
              <MessageBody message={m} nameOf={nameOf} />
            </li>
          )
        })}
      </ul>
      <div ref={endRef} />
    </div>
  )
}

function Composer({ placeholder, onSend }: { placeholder: string; onSend: (text: string) => Promise<void> }) {
  const { t } = useTranslation()
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const send = async () => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true); setError(null)
    try { await onSend(value); setText('') } catch (e) { setError(teamChatErrorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="shrink-0 border-t border-border/60 px-4 py-2">
      {error ? <p className="pb-1 text-caption text-destructive" role="alert">{error}</p> : null}
      <div className="flex items-end gap-2">
        <textarea
          value={text} maxLength={MESSAGE_MAX} rows={1} placeholder={placeholder} aria-label={placeholder}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
          className="max-h-40 min-h-9 flex-1 resize-none rounded-md border border-border bg-surface-input px-3 py-2 text-body"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" onClick={() => void send()} disabled={!text.trim() || busy} aria-label={t('messenger.channels.send')}>
              <Send aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('messenger.channels.send')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

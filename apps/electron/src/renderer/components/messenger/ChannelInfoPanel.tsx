/**
 * «О канале» side panel: channel card, «Активный звонок» (timer, participants,
 * join), stats and the member list with presence (in call / online / offline).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Phone, X } from 'lucide-react'
import type { TeamChannelView } from '@rox/shared/team-chat'
import type { TeamMemberRef } from '@rox/shared/team'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCallTimer } from './use-team-call'

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?'
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return <span className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-caption font-semibold text-text-secondary', className)} aria-hidden>{initials(name)}</span>
}

export type Presence = 'call' | 'online' | 'offline'

export function ChannelInfoPanel({ channel, label, members, presenceOf, nameOf, messageCount, inCall, joining, onJoinCall, onClose, locale }: {
  channel: TeamChannelView
  label: string
  members: TeamMemberRef[]
  presenceOf: (userId: string) => Presence
  nameOf: (userId: string) => string
  messageCount: number
  inCall: boolean
  joining: boolean
  onJoinCall: () => void
  onClose: () => void
  locale: string
}) {
  const { t } = useTranslation()
  const call = channel.activeCall
  const timer = useCallTimer(call?.startedAt)
  const byId = new Map(members.map(m => [m.userId, m]))
  const owner = channel.memberIds.map(id => byId.get(id)).find(m => m?.role === 'owner')
  const order: Record<Presence, number> = { call: 0, online: 1, offline: 2 }
  const sorted = [...channel.memberIds].sort((a, b) => order[presenceOf(a)] - order[presenceOf(b)] || nameOf(a).localeCompare(nameOf(b), locale))
  const created = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(channel.createdAt)
  return (
    <aside data-glass-slot="panel" className="flex w-72 shrink-0 flex-col overflow-y-auto border-s border-border/60" aria-label={t('messenger.info.title')} data-testid="messenger-channel-info">
      <div className="flex items-center justify-between px-4 py-2.5">
        <h2 className="text-body font-semibold">{t('messenger.info.title')}</h2>
        <button type="button" className="rounded p-1 text-text-muted hover:bg-surface-hover" onClick={onClose} aria-label={t('common.close')}><X className="icon-toolbar" aria-hidden /></button>
      </div>
      <div className="px-4 pb-3">
        <p className="text-body font-semibold">{label}</p>
        <p className="text-caption text-text-muted">{t('messenger.channels.memberCount', { count: channel.memberCount })}</p>
        {channel.topic ? <p className="mt-2 text-small text-text-secondary">{channel.topic}</p> : null}
      </div>

      <section className="px-4 pb-4" aria-label={t('messenger.calls.activeCall')}>
        <h3 className="mb-2 text-body font-semibold">{t('messenger.calls.activeCall')}</h3>
        {call ? (
          <div className="rounded-lg border border-success/40 bg-success/5 p-3" data-testid="messenger-active-call">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-small text-success"><span className="size-1.5 rounded-full bg-success" aria-hidden />{t('messenger.calls.live')} · <time className="tabular-nums" data-testid="messenger-call-timer">{timer}</time></span>
              {!inCall ? <Button size="sm" onClick={onJoinCall} disabled={joining || (!channel.viewerRole && channel.visibility !== 'public')}><Phone aria-hidden />{t('messenger.calls.join')}</Button> : <span className="text-caption text-text-muted">{t('messenger.calls.youAreIn')}</span>}
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {call.participantIds.map(id => (
                <li key={id} className="flex items-center gap-1 rounded-full bg-surface-hover py-0.5 pe-2 ps-0.5 text-caption"><Avatar name={nameOf(id)} className="size-5" />{nameOf(id)}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
            <span className="text-small text-text-muted">{t('messenger.calls.noCall')}</span>
            <Button size="sm" variant="secondary" onClick={onJoinCall} disabled={joining || (!channel.viewerRole && channel.visibility !== 'public')}><Phone aria-hidden />{t('messenger.calls.start')}</Button>
          </div>
        )}
      </section>

      <section className="px-4 pb-4">
        <h3 className="mb-2 text-body font-semibold">{t('messenger.info.about')}</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-small">
          <dt className="text-text-muted">{t('messenger.info.members')}</dt><dd>{channel.memberCount}</dd>
          <dt className="text-text-muted">{t('messenger.info.messages')}</dt><dd>{messageCount}</dd>
          {owner ? <><dt className="text-text-muted">{t('messenger.info.owner')}</dt><dd className="truncate">{owner.displayName}</dd></> : null}
          <dt className="text-text-muted">{t('messenger.info.created')}</dt><dd>{created}</dd>
        </dl>
      </section>

      <section className="px-4 pb-4">
        <h3 className="mb-2 text-body font-semibold">{t('messenger.info.memberList')}</h3>
        <ul className="flex flex-col gap-1.5" data-testid="messenger-member-list">
          {sorted.map(id => {
            const presence = presenceOf(id)
            return (
              <li key={id} className="flex items-center gap-2 text-small">
                <Avatar name={nameOf(id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{nameOf(id)}</span>
                  {byId.get(id)?.role && byId.get(id)!.role !== 'member' ? <span className="block text-caption text-text-muted">{t(byId.get(id)!.role === 'owner' ? 'messenger.role.owner' : 'messenger.role.admin')}</span> : null}
                </span>
                <span title={t(`messenger.presence.${presence}`)} aria-label={t(`messenger.presence.${presence}`)}
                  className={cn('size-2 rounded-full', presence === 'call' ? 'bg-success' : presence === 'online' ? 'bg-success/60' : 'bg-text-muted/40')} />
              </li>
            )
          })}
        </ul>
      </section>
    </aside>
  )
}

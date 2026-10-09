/**
 * SessionParticipantsPopover — participant history for the chat header (a2.2).
 *
 * Shows who created the session, who currently owns it, and everyone with an
 * identity binding on it. Reads only the server-attributed fields carried on
 * `SessionMeta`; nothing is inferred client-side.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Crown, UserRound, Users } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type {
  SessionCreatedActor,
  SessionOwnerRef,
  SessionParticipantIdentity,
} from '@rox/shared/protocol'

export interface SessionParticipantsListProps {
  creator?: SessionCreatedActor
  owner?: SessionOwnerRef | null
  participants?: readonly SessionParticipantIdentity[]
}

function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || '?'
}

/** Pure participant-history body (creator → owner → participants). */
export function SessionParticipantsList({ creator, owner, participants = [] }: SessionParticipantsListProps) {
  const { t } = useTranslation()
  const hasAny = Boolean(creator || owner || participants.length > 0)

  if (!hasAny) {
    return <p className="text-xs text-muted-foreground">{t('participants.empty')}</p>
  }

  return (
    <div className="flex flex-col gap-3 min-w-[220px]">
      {creator && (
        <section data-participant-role="creator">
          <div className="text-caption font-medium uppercase tracking-wider text-muted-foreground/70">
            {t('sessionOwner.createdBy', { name: creator.displayName })}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-pressed text-caption font-medium">
              {personInitials(creator.displayName)}
            </span>
            <span className="truncate">{creator.displayName}</span>
          </div>
        </section>
      )}

      <section data-participant-role="owner">
        <div className="text-caption font-medium uppercase tracking-wider text-muted-foreground/70">
          {owner ? t('sessionOwner.ownedBy', { name: owner.displayName }) : t('sessionOwner.unassigned')}
        </div>
        <div className="mt-1 flex items-center gap-2 text-sm">
          <Crown className="icon-caption text-accent" aria-hidden="true" />
          <span className="truncate">
            {owner ? owner.displayName : t('sessionOwner.unassigned')}
          </span>
        </div>
        {owner && (
          <div className="mt-0.5 text-caption text-muted-foreground">
            {t('sessionOwner.assignedBy', { name: owner.assignedBy })}
          </div>
        )}
      </section>

      <section data-participant-role="participants">
        <div className="text-caption font-medium uppercase tracking-wider text-muted-foreground/70">
          {t('participants.count', { count: participants.length })}
        </div>
        {participants.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t('participants.empty')}</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {participants.map(participant => (
              <li key={participant.accountId} className="flex items-center gap-2 text-sm">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-pressed text-caption font-medium">
                  {personInitials(participant.displayName)}
                </span>
                <span className="truncate flex-1">{participant.displayName}</span>
                {participant.kind !== 'profile' && (
                  <span className="text-caption text-muted-foreground">{participant.kind}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export interface SessionParticipantsPopoverProps extends SessionParticipantsListProps {
  trigger: React.ReactNode
}

/** Header popover wrapper: renders the trigger plus the participant history. */
export function SessionParticipantsPopover({ trigger, ...list }: SessionParticipantsPopoverProps) {
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
          <Users className="icon-caption" aria-hidden="true" />
          <span>{t('participants.count', { count: list.participants?.length ?? 0 })}</span>
        </div>
        <SessionParticipantsList {...list} />
      </PopoverContent>
    </Popover>
  )
}

/** Small icon used to trigger the participant popover in the header. */
export function ParticipantsTriggerIcon() {
  return <UserRound className="icon-toolbar" />
}
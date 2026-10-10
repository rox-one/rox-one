import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { BroPresenceMemberDto } from '@rox/shared/protocol'
import { useSessionActivityState } from '@/hooks/useSessionPresence'

export interface SessionPresenceFacepileProps {
  viewers: readonly BroPresenceMemberDto[]
}

/**
 * Pure facepile: live viewers of the session. Kept separate from the hook
 * wrapper so it can be rendered deterministically (and tested) from a
 * synthetic presence snapshot.
 */
export function SessionPresenceFacepile({ viewers }: SessionPresenceFacepileProps) {
  const { t } = useTranslation()
  if (viewers.length === 0) return null

  return (
    <div
      className="flex items-center -space-x-1.5 pr-1"
      aria-label={t('collaboration.presenceAria', { count: viewers.length })}
      data-presence-count={viewers.length}
    >
      {viewers.slice(0, 4).map((member) => (
        <span
          key={member.accountId}
          title={member.displayName}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground/15 text-xs font-medium text-foreground ring-1 ring-background"
          data-presence-status={member.status}
        >
          {initials(member.displayName)}
        </span>
      ))}
    </div>
  )
}

/** Live presence avatars for an open session, driven by `session_presence`. */
export function SessionPresenceAvatars({ sessionId }: { sessionId: string }) {
  const { viewers } = useSessionActivityState(sessionId)
  return <SessionPresenceFacepile viewers={viewers} />
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '')
  return letters.join('') || '?'
}
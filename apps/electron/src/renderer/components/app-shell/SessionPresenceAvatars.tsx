import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { BroPresenceMemberDto } from '@craft-agent/shared/protocol'

export interface SessionPresenceAvatarsProps {
  sessionId: string
}

export function SessionPresenceAvatars({ sessionId }: SessionPresenceAvatarsProps) {
  const { t } = useTranslation()
  const [members, setMembers] = React.useState<BroPresenceMemberDto[]>([])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await window.electronAPI.sessionCommand(sessionId, { type: 'listBroPresence' })
        if (!cancelled && Array.isArray(result)) {
          setMembers(result as BroPresenceMemberDto[])
        }
      } catch {
        if (!cancelled) setMembers([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (members.length === 0) return null

  return (
    <div
      className="flex items-center -space-x-1.5 pr-1"
      aria-label={t('collaboration.presenceAria', { count: members.length })}
    >
      {members.slice(0, 4).map((member) => (
        <span
          key={member.accountId}
          title={member.displayName}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground/15 text-[9px] font-medium text-foreground ring-1 ring-background"
          data-presence-status={member.status}
        >
          {initials(member.displayName)}
        </span>
      ))}
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '')
  return letters.join('') || '?'
}

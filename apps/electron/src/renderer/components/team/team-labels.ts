import type { TeamActivityEvent, TeamMemberRef, TeamSyncStatus } from '@rox/shared/team'

type T = (key: string, opts?: Record<string, unknown>) => string

export function memberName(members: readonly TeamMemberRef[], userId: string | undefined, selfUserId: string | null, t: T): string {
  if (!userId) return ''
  if (userId === selfUserId) return t('teamCollab.you')
  return members.find((m) => m.userId === userId)?.displayName ?? t('teamCollab.unknownMember')
}

export function memberInitials(name: string): string {
  const parts = name.trim().split(/[\s.@_-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function syncStatusText(status: TeamSyncStatus, pending: number, t: T): string {
  switch (status.state) {
    case 'no-org':
      return t('teamCollab.sync.noOrg')
    case 'org-server-required':
      return pending > 0 ? t('teamCollab.sync.serverRequiredPending', { count: pending }) : t('teamCollab.sync.serverRequired')
    case 'connected':
      return t('teamCollab.sync.connected')
    case 'error':
      return t('teamCollab.sync.error', { message: status.message })
  }
}

export function activityText(
  e: TeamActivityEvent,
  members: readonly TeamMemberRef[],
  selfUserId: string | null,
  t: T,
): string {
  const actor = memberName(members, e.actorUserId, selfUserId, t)
  const subject = memberName(members, e.subjectUserId, selfUserId, t)
  const title = e.target.title || t(`teamCollab.target.${e.target.kind}`)
  return t(`teamCollab.activity.${e.kind}`, { actor, subject, title })
}

import type { CollaboratorRole, RoxAccount } from './invite.ts'

export type PresenceStatus = 'online' | 'away' | 'offline'

export interface PresenceMember {
  accountId: string
  displayName: string
  username: string
  role: CollaboratorRole
  status: PresenceStatus
  joinedAt: number
}

export function upsertPresence(
  members: readonly PresenceMember[],
  account: RoxAccount,
  role: CollaboratorRole,
  now: number,
  status: PresenceStatus = 'online',
): PresenceMember[] {
  const next = members.filter((m) => m.accountId !== account.accountId)
  next.push({
    accountId: account.accountId,
    displayName: account.displayName,
    username: account.username,
    role,
    status,
    joinedAt: members.find((m) => m.accountId === account.accountId)?.joinedAt ?? now,
  })
  return next.sort((a, b) => a.joinedAt - b.joinedAt)
}

export function setPresenceStatus(
  members: readonly PresenceMember[],
  accountId: string,
  status: PresenceStatus,
): PresenceMember[] {
  return members.map((m) => (m.accountId === accountId ? { ...m, status } : m))
}

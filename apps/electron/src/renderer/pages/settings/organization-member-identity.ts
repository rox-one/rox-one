import type { OrgMember } from '@craft-agent/shared/orgs'

export interface OrgMemberIdentityLabels {
  userId: string
  username: string
  email: string
}

export interface FormattedOrgMemberIdentity {
  userId: string
  username: string
  email: string
  summary: string
}

export function formatOrgMemberIdentity(
  member: Pick<OrgMember, 'userId' | 'username' | 'email'>,
  labels: OrgMemberIdentityLabels,
  empty: string,
): FormattedOrgMemberIdentity {
  const username = member.username?.trim() || empty
  const email = member.email?.trim() || empty
  return {
    userId: member.userId,
    username,
    email,
    summary: `${labels.userId}: ${member.userId} · ${labels.username}: ${username} · ${labels.email}: ${email}`,
  }
}

/**
 * W1-11 (#1508) — Identity lifecycle contracts (TECH-SPEC §15, DATA-MODEL §5.11,
 * ADR-U16).
 *
 * The headline property is **activation keeps ids**: whatever the placeholder's
 * id, the verified email and the auth subject, activation returns the same
 * `principalId`, so mentions, assignments, chat membership and entity links
 * never need re-pointing. Merge is the other half: it re-points the
 * placeholder's rows to the account and deactivates the placeholder.
 */

import { describe, expect, it } from 'bun:test'
import { PRINCIPAL_STATUSES, membershipAfterActivation, placeholderCan, principalCanSignIn } from '../principal.ts'
import {
  INVITATION_REMINDER_DAYS,
  INVITATION_TTL_DAYS,
  dueInvitationReminder,
  invitationExpiry,
  invitationIsExpired,
  inviteDomainAllowed,
  normalizePrimaryEmail,
  type Invitation,
} from '../invitation.ts'
import {
  IDENTITY_EVENTS,
  PLACEHOLDER_MERGE_COLLECTIONS,
  generalChatInviteChatIds,
  inboxInviteCard,
  normalizeInviteEmails,
  planPlaceholder,
  planPlaceholderActivation,
  planPlaceholderMerge,
} from '../lifecycle.ts'

/** Deterministic PRNG so the property test is reproducible. */
function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const HEX = '0123456789abcdef'

function randomUuid(random: () => number): string {
  let out = ''
  for (let index = 0; index < 32; index += 1) out += HEX[Math.floor(random() * 16)]
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`
}

describe('placeholder activation keeps ids (property)', () => {
  it('holds for 500 generated principals, emails and auth subjects', () => {
    const random = pseudoRandom(20261008)
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const principalId = randomUuid(random)
      const username = `user${Math.floor(random() * 1e6)}`
      const domain = ['example.com', 'rox.one', 'mail.example.org'][Math.floor(random() * 3)]!
      const email = `${username}@${domain}`
      const authSubject = `oidc|${randomUuid(random)}`
      const activation = planPlaceholderActivation({
        placeholder: { principalId, status: 'placeholder', primaryEmail: email, kind: 'human' },
        verifiedEmail: email,
        authSubject,
        memberships: [{ workspaceId: 'ws-1', status: 'invited' }],
        now: new Date('2026-10-08T12:00:00.000Z'),
      })
      expect(activation).not.toMatchObject({ ok: false })
      if ('principalId' in activation) {
        // The id is *the same row*: no new principal is created (§5.11 rule 4).
        expect(activation.principalId).toBe(principalId)
        expect(activation.status).toBe('active')
        expect(activation.authSubject).toBe(authSubject)
        expect(activation.memberships).toEqual([{ workspaceId: 'ws-1', from: 'invited', to: 'active' }])
        expect(activation.releaseHeldNotifications).toBe(true)
        expect(activation.chatMemberships).toBe('pending_activation→active')
      }
    }
  })

  it('matches the email case-insensitively and refuses a different one', () => {
    const placeholder = { principalId: 'p1', status: 'placeholder' as const, primaryEmail: '  Ann@Example.COM ', kind: 'human' as const }
    const activation = planPlaceholderActivation({ placeholder, verifiedEmail: 'ann@example.com', authSubject: 'sub-1' })
    expect(activation).toMatchObject({ principalId: 'p1', status: 'active' })
    expect(planPlaceholderActivation({ placeholder, verifiedEmail: 'bob@example.com', authSubject: 'sub-1' }))
      .toEqual({ ok: false, reason: 'email_mismatch' })
  })

  it('refuses to activate a non-placeholder or a deactivated principal', () => {
    const base = { primaryEmail: 'a@example.com', kind: 'human' as const }
    expect(planPlaceholderActivation({ placeholder: { principalId: 'p1', status: 'active', ...base }, verifiedEmail: 'a@example.com', authSubject: 's' }))
      .toEqual({ ok: false, reason: 'not_a_placeholder' })
    expect(planPlaceholderActivation({ placeholder: { principalId: 'p1', status: 'deactivated', ...base }, verifiedEmail: 'a@example.com', authSubject: 's' }))
      .toEqual({ ok: false, reason: 'deactivated' })
  })

  it('flips only the invited memberships', () => {
    expect(membershipAfterActivation('invited')).toBe('active')
    for (const status of ['active', 'left', 'removed'] as const) expect(membershipAfterActivation(status)).toBe(status)
  })
})

describe('merge semantics (DATA-MODEL §5.11 rule 6)', () => {
  it('re-points every documented collection and deactivates the placeholder', () => {
    const merge = planPlaceholderMerge({
      placeholder: { principalId: 'placeholder-1', status: 'placeholder' },
      account: { principalId: 'account-1', status: 'active' },
      confirmedBy: 'admin-1',
    })
    expect(merge).toMatchObject({
      placeholderId: 'placeholder-1',
      accountId: 'account-1',
      collections: PLACEHOLDER_MERGE_COLLECTIONS,
      placeholderStatus: 'deactivated',
      mergedInto: 'account-1',
      audited: true,
    })
    expect([...PLACEHOLDER_MERGE_COLLECTIONS]).toEqual(['chat_member', 'workspace_member', 'work_item.assignee_id', 'entity_link', 'mention_index'])
  })

  it('refuses a merge into itself, a missing placeholder or an inactive account', () => {
    expect(planPlaceholderMerge({ placeholder: { principalId: 'p', status: 'placeholder' }, account: { principalId: 'p', status: 'active' }, confirmedBy: 'a' }))
      .toEqual({ ok: false, reason: 'same_principal' })
    expect(planPlaceholderMerge({ placeholder: { principalId: 'p', status: 'active' }, account: { principalId: 'a', status: 'active' }, confirmedBy: 'a' }))
      .toEqual({ ok: false, reason: 'not_a_placeholder' })
    expect(planPlaceholderMerge({ placeholder: { principalId: 'p', status: 'placeholder' }, account: { principalId: 'a', status: 'placeholder' }, confirmedBy: 'a' }))
      .toEqual({ ok: false, reason: 'account_not_active' })
  })
})

describe('invitations', () => {
  it('normalises and de-duplicates the invite list, preserving order', () => {
    expect(normalizeInviteEmails([' Ann@Example.com ', 'ann@example.com', '', 'BOB@example.org']))
      .toEqual(['ann@example.com', 'bob@example.org'])
    expect(normalizePrimaryEmail('  Mixed@Case.COM ')).toBe('mixed@case.com')
  })

  it('expires 30 days after sending and reminds only once per configured day', () => {
    const sentAt = new Date('2026-10-01T09:00:00.000Z')
    const invitation: Invitation = {
      invitationId: 'inv-1', workspaceId: 'ws-1', email: 'a@example.com', principalId: 'p1', invitedBy: 'owner-1',
      role: 'member', targets: [], status: 'pending', sentAt: sentAt.toISOString(), expiresAt: invitationExpiry(sentAt),
    }
    expect(INVITATION_TTL_DAYS).toBe(30)
    expect(invitation.expiresAt).toBe(new Date('2026-10-31T09:00:00.000Z').toISOString())
    expect(invitationIsExpired(invitation, new Date('2026-10-20T00:00:00.000Z'))).toBe(false)
    expect(invitationIsExpired(invitation, new Date('2026-11-01T00:00:00.000Z'))).toBe(true)
    expect(dueInvitationReminder(invitation, new Date('2026-10-02T00:00:00.000Z'))).toBeNull()
    expect(dueInvitationReminder(invitation, new Date('2026-10-04T12:00:00.000Z'))).toBe(INVITATION_REMINDER_DAYS[0])
    expect(dueInvitationReminder({ ...invitation, lastRemindedAt: '2026-10-04T12:00:00.000Z' }, new Date('2026-10-04T18:00:00.000Z'))).toBeNull()
    expect(dueInvitationReminder({ ...invitation, lastRemindedAt: '2026-10-04T12:00:00.000Z' }, new Date('2026-10-08T12:00:00.000Z'))).toBe(INVITATION_REMINDER_DAYS[1])
    expect(dueInvitationReminder({ ...invitation, status: 'accepted' }, new Date('2026-10-09T00:00:00.000Z'))).toBeNull()
  })

  it('honours an allowed-domain policy', () => {
    expect(inviteDomainAllowed('a@rox.one', { allowedDomains: ['rox.one'] })).toBe(true)
    expect(inviteDomainAllowed('a@other.com', { allowedDomains: ['rox.one'] })).toBe(false)
    expect(inviteDomainAllowed('a@other.com', {})).toBe(true)
    expect(inviteDomainAllowed('a@other.com', null)).toBe(true)
    expect(inviteDomainAllowed('not-an-email', { allowedDomains: ['rox.one'] })).toBe(false)
  })

  it('plans a placeholder for a new email and an Inbox card for an active account', () => {
    const fresh = planPlaceholder({ email: 'New@Example.com', chatIds: ['chat-general'] })
    expect(fresh).toMatchObject({ email: 'new@example.com', createPlaceholder: true, principalId: null, existingAccount: false, memberStatus: 'invited' })
    expect(fresh.chatMemberships).toEqual([{ chatId: 'chat-general', state: 'pending_activation' }])

    const existing = planPlaceholder({ email: 'ann@example.com', existing: { principalId: 'p9', status: 'active', kind: 'human' } })
    expect(existing).toMatchObject({ createPlaceholder: false, principalId: 'p9', existingAccount: true })

    const placeholder = planPlaceholder({ email: 'ann@example.com', existing: { principalId: 'p8', status: 'placeholder', kind: 'human' } })
    expect(placeholder).toMatchObject({ createPlaceholder: false, principalId: 'p8', existingAccount: false })

    // A deactivated row does not block the email: the new invite creates a new placeholder.
    const revived = planPlaceholder({ email: 'ann@example.com', existing: { principalId: 'p7', status: 'deactivated', kind: 'human' } })
    expect(revived).toMatchObject({ createPlaceholder: true, principalId: null })

    expect(inboxInviteCard({ workspaceId: 'ws-1', role: 'member', invitedBy: 'owner-1' }))
      .toEqual({ kind: 'invite', workspaceId: 'ws-1', role: 'member', invitedBy: 'owner-1', targets: [] })
  })

  it('names the events and the General chat of the invite path', () => {
    expect(IDENTITY_EVENTS.placeholderActivated).toBe('identity.placeholder_activated')
    expect(IDENTITY_EVENTS.memberAdded).toBe('people.member_added')
    expect(generalChatInviteChatIds({ chatId: 'chat-1', systemRole: 'general' })).toEqual(['chat-1'])
    expect(generalChatInviteChatIds({ chatId: 'chat-2', systemRole: null })).toEqual([])
  })
})

describe('principal rules', () => {
  it('a placeholder can be mentioned, assigned and invited — and nothing else', () => {
    expect(placeholderCan('mention')).toBe(true)
    expect(placeholderCan('assign')).toBe(true)
    expect(placeholderCan('event_attendee')).toBe(true)
    expect(placeholderCan('contributor')).toBe(true)
    expect(placeholderCan('invite')).toBe(true)
    // @ts-expect-error the denied vocabulary is not part of PlaceholderAction
    expect(placeholderCan('sign_in')).toBe(false)
  })

  it('only an active human signs in; placeholders never do', () => {
    expect(principalCanSignIn({ kind: 'human', status: 'active' })).toBe(true)
    expect(principalCanSignIn({ kind: 'human', status: 'placeholder' })).toBe(false)
    expect(principalCanSignIn({ kind: 'human', status: 'deactivated' })).toBe(false)
    expect(principalCanSignIn({ kind: 'bot', status: 'active' })).toBe(false)
    expect(PRINCIPAL_STATUSES).toEqual(['active', 'placeholder', 'deactivated'])
  })
})
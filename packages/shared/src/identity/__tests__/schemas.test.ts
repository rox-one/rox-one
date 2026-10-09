/**
 * W1-11 (#1508) — Identity and team-chat payload schemas (TECH-SPEC §15.1,
 * D-v2-2). Every schema is checked on its boundaries: the enum values the DDL
 * would reject, the array bounds, and the command names the catalogue declares.
 */

import { describe, expect, it } from 'bun:test'
import { COMMAND_CATALOGUE } from '@rox/core/commands'
import {
  IDENTITY_PAYLOAD_SCHEMAS,
  TEAM_CHAT_PAYLOAD_SCHEMAS,
  activatePlaceholderSchema,
  browsePublicChatsSchema,
  createChatSchema,
  createWorkspaceSchema,
  ensurePlaceholderSchema,
  invitePeopleSchema,
  joinChatSchema,
  leaveChatSchema,
  mergePlaceholderSchema,
  principalStatusSchema,
  setVisibilitySchema,
  workspaceMemberStatusSchema,
} from '../schemas.ts'

describe('team-chat schemas (D-v2-2)', () => {
  it('accepts a group chat / channel with a public or private visibility', () => {
    for (const kind of ['group', 'channel'] as const) {
      for (const visibility of ['public', 'private'] as const) {
        const parsed = createChatSchema.safeParse({ kind, visibility })
        expect(parsed.success, `${kind}/${visibility}`).toBe(true)
      }
    }
    const channel = createChatSchema.safeParse({
      kind: 'channel', name: 'Отчёты', description: 'Weekly numbers', visibility: 'public',
      members: ['p1', 'p2'], postingPolicy: 'admins', invitePolicy: 'admins',
    })
    expect(channel.success).toBe(true)
    if (channel.success) expect(channel.data.postingPolicy).toBe('admins')
  })

  it('rejects the kinds and policies the contract does not have', () => {
    expect(createChatSchema.safeParse({ kind: 'p2p', visibility: 'public' }).success).toBe(false)
    expect(createChatSchema.safeParse({ kind: 'group', visibility: 'secret' }).success).toBe(false)
    expect(createChatSchema.safeParse({ kind: 'group', visibility: 'public', postingPolicy: 'nobody' }).success).toBe(false)
    expect(createChatSchema.safeParse({ kind: 'group', visibility: 'public', members: ['a', 'b'], invitePolicy: 'everyone' }).success).toBe(false)
  })

  it('join / leave need a chat id; set_visibility carries the confirmation flag', () => {
    expect(joinChatSchema.safeParse({ chatId: 'chat-1' }).success).toBe(true)
    expect(joinChatSchema.safeParse({}).success).toBe(false)
    expect(leaveChatSchema.safeParse({ chatId: 'chat-1' }).success).toBe(true)
    expect(setVisibilitySchema.safeParse({ chatId: 'chat-1', visibility: 'public', confirmHistoryExposure: true }).success).toBe(true)
    expect(setVisibilitySchema.safeParse({ chatId: 'chat-1', visibility: 'public' }).success).toBe(true)
    expect(setVisibilitySchema.safeParse({ chatId: 'chat-1', visibility: 'hidden' }).success).toBe(false)
  })

  it('browse bounds the page size and the query length', () => {
    expect(browsePublicChatsSchema.safeParse({}).success).toBe(true)
    expect(browsePublicChatsSchema.safeParse({ query: 'отчёты', kind: 'channel', limit: 50 }).success).toBe(true)
    expect(browsePublicChatsSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(browsePublicChatsSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(browsePublicChatsSchema.safeParse({ query: 'x'.repeat(257) }).success).toBe(false)
  })

  it('workspaces.create validates the slug and carries the chat-creation policy', () => {
    expect(createWorkspaceSchema.safeParse({ name: 'Rox', slug: 'rox-team' }).success).toBe(true)
    expect(createWorkspaceSchema.safeParse({ name: 'Rox', slug: 'Rox Team' }).success).toBe(false)
    expect(createWorkspaceSchema.safeParse({ name: 'Rox', slug: '-rox' }).success).toBe(false)
    expect(createWorkspaceSchema.safeParse({ name: 'Rox', slug: 'rox', chatCreation: 'admins' }).success).toBe(true)
    expect(createWorkspaceSchema.safeParse({ name: 'Rox', slug: 'rox', chatCreation: 'nobody' }).success).toBe(false)
    const invites = createWorkspaceSchema.safeParse({ name: 'Rox', slug: 'rox', invites: [{ email: 'a@example.com' }, { email: 'b@example.com', role: 'guest' }] })
    expect(invites.success).toBe(true)
  })

  it('every team-chat command of the catalogue has a schema', () => {
    const catalogueTypes = new Set<string>(COMMAND_CATALOGUE.map(definition => definition.type as string))
    for (const [type, schema] of Object.entries(TEAM_CHAT_PAYLOAD_SCHEMAS)) {
      expect(catalogueTypes.has(type), `${type} must be declared in the catalogue`).toBe(true)
      expect(typeof schema.safeParse, `${type} must validate`).toBe('function')
    }
    expect(Object.keys(TEAM_CHAT_PAYLOAD_SCHEMAS).sort()).toEqual([
      'im.browse_public_chats', 'im.create_chat', 'im.join_chat', 'im.leave_chat', 'im.set_visibility', 'workspaces.create',
    ])
  })
})

describe('identity lifecycle schemas (§15.1, §5.11)', () => {
  it('people.invite takes at least one email and normalises nothing itself', () => {
    expect(invitePeopleSchema.safeParse({ workspaceId: 'w1', emails: ['a@example.com'] }).success).toBe(true)
    expect(invitePeopleSchema.safeParse({ workspaceId: 'w1', emails: [] }).success).toBe(false)
    expect(invitePeopleSchema.safeParse({ workspaceId: 'w1', emails: ['not-an-email'] }).success).toBe(false)
    expect(invitePeopleSchema.safeParse({ workspaceId: 'w1', emails: Array.from({ length: 101 }, (_, i) => `u${i}@example.com`) }).success).toBe(false)
    const withTargets = invitePeopleSchema.safeParse({
      workspaceId: 'w1', emails: ['a@example.com'], role: 'admin', targets: [{ kind: 'channel', id: 'chat-1', role: 'member' }], message: 'Привет',
    })
    expect(withTargets.success).toBe(true)
    expect(invitePeopleSchema.safeParse({ workspaceId: 'w1', emails: ['a@example.com'], targets: [{ kind: 'doc', id: 'd1' }] }).success).toBe(false)
  })

  it('ensure_placeholder requires the inviter and accepts the auto-join chats', () => {
    const parsed = ensurePlaceholderSchema.safeParse({
      workspaceId: 'w1', email: 'new@example.com', invitedBy: 'owner-1', chatIds: ['chat-general'], role: 'member',
    })
    expect(parsed.success).toBe(true)
    expect(ensurePlaceholderSchema.safeParse({ workspaceId: 'w1', email: 'new@example.com' }).success).toBe(false)
    expect(ensurePlaceholderSchema.safeParse({ workspaceId: 'w1', email: 'new@example.com', invitedBy: 'o', sentAt: 'not-a-date' }).success).toBe(false)
  })

  it('activate_placeholder needs a verified email and an auth subject', () => {
    expect(activatePlaceholderSchema.safeParse({ authSubject: 'oidc|123', verifiedEmail: 'ann@example.com' }).success).toBe(true)
    expect(activatePlaceholderSchema.safeParse({ authSubject: 'oidc|123', verifiedEmail: 'nope' }).success).toBe(false)
    expect(activatePlaceholderSchema.safeParse({ verifiedEmail: 'ann@example.com' }).success).toBe(false)
  })

  it('merge_placeholder needs the admin confirmation triple', () => {
    expect(mergePlaceholderSchema.safeParse({ placeholderId: 'p1', accountId: 'a1', confirmedBy: 'admin-1' }).success).toBe(true)
    expect(mergePlaceholderSchema.safeParse({ placeholderId: 'p1', accountId: 'a1' }).success).toBe(false)
  })

  it('the status vocabularies match the DDL', () => {
    for (const status of ['active', 'placeholder', 'deactivated']) expect(principalStatusSchema.safeParse(status).success).toBe(true)
    expect(principalStatusSchema.safeParse('invited').success).toBe(false)
    for (const status of ['invited', 'active', 'left', 'removed']) expect(workspaceMemberStatusSchema.safeParse(status).success).toBe(true)
    expect(workspaceMemberStatusSchema.safeParse('placeholder').success).toBe(false)
  })

  it('every identity command of the catalogue has a schema', () => {
    const catalogueTypes = new Set<string>(COMMAND_CATALOGUE.map(definition => definition.type as string))
    for (const type of Object.keys(IDENTITY_PAYLOAD_SCHEMAS)) expect(catalogueTypes.has(type), type).toBe(true)
    expect(Object.keys(IDENTITY_PAYLOAD_SCHEMAS).sort()).toEqual([
      'identity.activate_placeholder', 'identity.ensure_placeholder', 'identity.merge_placeholder', 'people.invite',
    ])
  })
})
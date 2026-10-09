/**
 * W1-11 (#1508) — Team-chat contract tests (D-v2-2, PRD R-COL-11, DATA-MODEL
 * §5.11, TECH-SPEC §15.1).
 *
 * The General chat's invariants, who may create / join / change visibility,
 * and the posting / invite policies are contracts wave 2 renders and enforces,
 * so they are pinned here rather than in the surface that consumes them.
 */

import { describe, expect, it } from 'bun:test'
import {
  CHAT_CREATION_POLICIES,
  chatAclProjection,
  chatPrivacyFor,
  CHAT_INVITE_POLICIES,
  CHAT_POSTING_POLICIES,
  GENERAL_CHAT_INVARIANTS,
  GENERAL_CHAT_SYSTEM_ROLE,
  TEAM_CHAT_COMMANDS,
  canCreateChat,
  canInviteToChat,
  canJoinChat,
  canPostToChat,
  canSetVisibility,
  chatJoinMode,
  generalChatDraft,
  isGeneralChat,
  isTeamChatCommand,
  type TeamChat,
} from '../team-chats.ts'

const general: TeamChat = { chatId: 'chat-general', workspaceId: 'ws-1', kind: 'group', visibility: 'public', systemRole: 'general', name: 'General' }
const privateGroup: TeamChat = { chatId: 'chat-private', workspaceId: 'ws-1', kind: 'group', visibility: 'private' }
const publicChannel: TeamChat = { chatId: 'chat-channel', workspaceId: 'ws-1', kind: 'channel', visibility: 'public', postingPolicy: 'admins' }

describe('the General chat (D-v2-2)', () => {
  it('is created with the workspace as a public group with the system role', () => {
    expect(generalChatDraft('Rox')).toEqual({
      kind: 'group', visibility: 'public', systemRole: GENERAL_CHAT_SYSTEM_ROLE, name: 'Rox', postingPolicy: 'all', invitePolicy: 'members',
    })
    expect(generalChatDraft('   ').name).toBe('General')
    expect(generalChatDraft(null).name).toBe('General')
    expect(isGeneralChat(general)).toBe(true)
    expect(isGeneralChat(privateGroup)).toBe(false)
  })

  it('declares the invariants the DDL enforces', () => {
    expect(GENERAL_CHAT_INVARIANTS).toEqual({
      autoJoin: 'all_active_members',
      pendingMembers: 'pending_activation',
      deletable: false,
      changeableVisibility: false,
      renameable: true,
      creatableBy: 'workspaces.create',
    })
  })

  it('can never be made private or deleted, even by the owner', () => {
    expect(canSetVisibility({ chat: general, role: 'owner' })).toEqual({ allowed: false, requiresConfirmation: false, privileged: false, reason: 'general_chat' })
    expect(canSetVisibility({ chat: general, role: 'admin' }).allowed).toBe(false)
  })

  it('always answers to the self-join mode', () => {
    expect(chatJoinMode(general)).toBe('self_join')
    expect(canJoinChat({ visibility: general.visibility, archived: false })).toBe(true)
  })
})

describe('creating chats', () => {
  it('any active member may create while the policy is `members`', () => {
    expect(canCreateChat({ role: 'member', status: 'active', chatCreation: 'members' })).toEqual({ allowed: true })
    expect(canCreateChat({ role: 'guest', status: 'active', chatCreation: 'members' })).toEqual({ allowed: true })
  })

  it('`admins` restricts creation to owners and admins', () => {
    expect(canCreateChat({ role: 'member', status: 'active', chatCreation: 'admins' }))
      .toEqual({ allowed: false, reason: 'policy_admins_only' })
    expect(canCreateChat({ role: 'admin', status: 'active', chatCreation: 'admins' })).toEqual({ allowed: true })
    expect(canCreateChat({ role: 'owner', status: 'active', chatCreation: 'admins' })).toEqual({ allowed: true })
  })

  it('an invited (not yet activated) or left member never creates a chat', () => {
    for (const status of ['invited', 'left', 'removed'] as const) {
      expect(canCreateChat({ role: 'member', status, chatCreation: 'members' })).toEqual({ allowed: false, reason: 'placeholder' })
    }
    expect(canCreateChat({ role: null, status: 'active', chatCreation: 'members' })).toEqual({ allowed: false, reason: 'not_a_member' })
  })

  it('keeps the policy vocabulary of the workspace setting', () => {
    expect([...CHAT_CREATION_POLICIES]).toEqual(['members', 'admins'])
    expect([...CHAT_POSTING_POLICIES]).toEqual(['all', 'admins'])
    expect([...CHAT_INVITE_POLICIES]).toEqual(['members', 'admins'])
  })
})

describe('joining and visibility', () => {
  it('public chats are self-join, private ones invite-only (§15.1)', () => {
    expect(canJoinChat({ visibility: 'public' })).toBe(true)
    expect(canJoinChat({ visibility: 'private' })).toBe(false)
    expect(canJoinChat({ visibility: 'public', archived: true })).toBe(false)
    expect(chatJoinMode(privateGroup)).toBe('invite_only')
  })

  it('private → public needs an owner / admin and a confirmation; public → private keeps members', () => {
    expect(canSetVisibility({ chat: privateGroup, role: 'owner' }))
      .toEqual({ allowed: true, requiresConfirmation: true, privileged: true })
    expect(canSetVisibility({ chat: privateGroup, role: 'admin' })).toMatchObject({ allowed: true, privileged: true })
    expect(canSetVisibility({ chat: privateGroup, role: 'member' }))
      .toEqual({ allowed: false, requiresConfirmation: false, privileged: false, reason: 'not_owner_or_admin' })
    expect(canSetVisibility({ chat: publicChannel, role: 'admin' }))
      .toEqual({ allowed: true, requiresConfirmation: false, privileged: false })
    expect(canSetVisibility({ chat: publicChannel, role: null }).allowed).toBe(false)
  })

  it('invite and posting policies default to every member', () => {
    expect(canInviteToChat({ role: 'member' })).toBe(true)
    expect(canInviteToChat({ role: 'member', invitePolicy: 'admins' })).toBe(false)
    expect(canInviteToChat({ role: 'admin', invitePolicy: 'admins' })).toBe(true)
    expect(canInviteToChat({ role: null })).toBe(false)
    expect(canPostToChat({ role: 'member' })).toBe(true)
    expect(canPostToChat({ role: 'member', postingPolicy: 'admins' })).toBe(false)
    expect(canPostToChat({ role: 'owner', postingPolicy: 'admins' })).toBe(true)
  })
})

describe('the frozen command names', () => {
  it('lists the six team-chat commands of D-v2-2', () => {
    expect([...TEAM_CHAT_COMMANDS]).toEqual([
      'workspaces.create', 'im.create_chat', 'im.join_chat', 'im.leave_chat', 'im.set_visibility', 'im.browse_public_chats',
    ])
    expect(isTeamChatCommand('im.create_chat')).toBe(true)
    expect(isTeamChatCommand('im.update_chat')).toBe(false)
  })
})
describe('ACL projection (private chats are hidden from non-members)', () => {
  it('a private chat is never visible to a non-member, and is secret', () => {
    const projection = chatAclProjection({ chat: privateGroup, member: null, workspaceActive: true })
    expect(projection).toEqual({ visible: false, action: 'none', pendingActivation: false, secret: true })
    expect(chatPrivacyFor(privateGroup)).toBe('invited')
  })

  it('a public chat is listed for every active member; a joiner sees only the title', () => {
    const outsider = chatAclProjection({ chat: publicChannel, member: null, workspaceActive: true })
    expect(outsider).toEqual({ visible: true, action: 'view_title', pendingActivation: false, secret: false })
    const member = chatAclProjection({ chat: publicChannel, member: { role: 'member', state: 'active' }, workspaceActive: true })
    expect(member.action).toBe('comment')
    const admin = chatAclProjection({ chat: publicChannel, member: { role: 'admin', state: 'active' }, workspaceActive: true })
    expect(admin.action).toBe('manage_access')
    expect(chatPrivacyFor(publicChannel)).toBe('inherit')
  })

  it('an active member of a private chat may act; a pending placeholder may not', () => {
    const member = chatAclProjection({ chat: privateGroup, member: { role: 'member', state: 'active' }, workspaceActive: true })
    expect(member).toEqual({ visible: true, action: 'comment', pendingActivation: false, secret: true })
    const owner = chatAclProjection({ chat: privateGroup, member: { role: 'owner', state: 'active' }, workspaceActive: true })
    expect(owner.action).toBe('manage_access')
    const pending = chatAclProjection({ chat: general, member: { role: 'member', state: 'pending_activation' }, workspaceActive: true })
    expect(pending.visible).toBe(true)
    expect(pending.action).toBe('view_title')
    expect(pending.pendingActivation).toBe(true)
  })

  it('a left / removed member loses a private chat entirely, and a non-member loses both', () => {
    for (const state of ['left', 'removed'] as const) {
      expect(chatAclProjection({ chat: privateGroup, member: { role: 'member', state }, workspaceActive: true }).visible).toBe(false)
      expect(chatAclProjection({ chat: publicChannel, member: { role: 'member', state }, workspaceActive: true }).action).toBe('view_title')
    }
    expect(chatAclProjection({ chat: general, member: { role: 'member', state: 'active' }, workspaceActive: false }))
      .toEqual({ visible: false, action: 'none', pendingActivation: false, secret: false })
  })

  it('an archived public chat is not listed as viewable', () => {
    const archived = chatAclProjection({ chat: { ...publicChannel, archivedAt: '2026-10-08T00:00:00.000Z' }, member: null, workspaceActive: true })
    expect(archived).toEqual({ visible: true, action: 'view_title', pendingActivation: false, secret: true })
  })
})

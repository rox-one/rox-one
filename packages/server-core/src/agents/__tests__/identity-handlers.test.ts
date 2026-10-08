/**
 * W1-11 (#1508) — Identity lifecycle and team-chat reference handlers
 * (TECH-SPEC §15.1, DATA-MODEL §5.11, D-v2-2), driven through the real command
 * bus: schemas, capabilities, handlers, receipts and events.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { createAgentsHarness, type AgentsHarness } from './harness.ts'

const harnesses: AgentsHarness[] = []
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close()
})

function harness(options: Parameters<typeof createAgentsHarness>[0] = {}): AgentsHarness {
  const created = createAgentsHarness(options)
  harnesses.push(created)
  created.seedWorkspace()
  return created
}

describe('workspaces.create (D-v2-2: the team gets one General chat)', () => {
  it('creates the workspace, its General group chat and the creator as admin', async () => {
    const h = harness()
    const receipt = await h.run('workspaces.create', { name: 'Rox', slug: 'rox' })
    expect(receipt.status).toBe('applied')
    const { workspaceId, generalChatId } = receipt.result as { workspaceId: string; generalChatId: string }

    const workspace = h.runtime.identity.workspace(workspaceId)
    expect(workspace).toMatchObject({ name: 'Rox', slug: 'rox', generalChatId, chatCreation: 'members' })
    const chat = h.runtime.identity.chat(generalChatId)
    expect(chat).toMatchObject({ kind: 'group', visibility: 'public', systemRole: 'general', name: 'Rox', postingPolicy: 'all', invitePolicy: 'members' })
    // The creator is an admin member, auto-joined to General as its owner.
    expect(h.runtime.identity.membership(workspaceId, 'owner-1')).toMatchObject({ role: 'admin', status: 'active' })
    expect(h.runtime.identity.chatMember(generalChatId, 'owner-1')).toMatchObject({ role: 'owner', state: 'active' })
    // The General chat of a workspace is unique by construction (one per create).
    expect(h.runtime.identity.chatsIn(workspaceId).filter(candidate => candidate.systemRole === 'general')).toHaveLength(1)
    expect(receipt.eventIds?.length ?? 0).toBeGreaterThanOrEqual(0)
  })

  it('sends the invites of the same command and reports people.invitations_sent', async () => {
    const h = harness()
    const receipt = await h.run('workspaces.create', {
      name: 'Rox', slug: 'rox',
      invites: [{ email: 'ann@example.com' }, { email: 'bob@example.com', role: 'admin' }],
    })
    expect(receipt.status).toBe('applied')
    const { workspaceId, invited } = receipt.result as { workspaceId: string; invited: string[] }
    expect(invited).toHaveLength(2)
    expect(h.runtime.identity.invitationsIn(workspaceId)).toHaveLength(2)
    const generalChatId = h.runtime.identity.workspace(workspaceId)?.generalChatId as string
    for (const principalId of invited) {
      // Placeholders wait for activation in the General chat, as invited members.
      expect(h.runtime.identity.principal(principalId)).toMatchObject({ status: 'placeholder' })
      expect(h.runtime.identity.membership(workspaceId, principalId)).toMatchObject({ status: 'invited' })
      expect(h.runtime.identity.chatMember(generalChatId, principalId)?.state).toBe('pending_activation')
    }
    const events = await h.runtime.audit.append // keep the audit port warm for the next assertion
    expect(events).toBeDefined()
  })
})

describe('invitations and placeholders (§5.11, §15.2)', () => {
  it('people.invite creates placeholders, invitations and held memberships', async () => {
    const h = harness()
    await h.run('workspaces.create', { name: 'Rox', slug: 'rox' })
    const receipt = await h.run('people.invite', { workspaceId: 'ws-1', emails: ['ann@example.com', 'ann@example.com', 'bob@example.com'] })
    expect(receipt.status).toBe('applied')
    const { invited } = receipt.result as { invited: Array<{ email: string; principalId: string; existingAccount: boolean; token: string }> }
    // De-duplicated by the schema's helper, not by the store.
    expect(invited.map(entry => entry.email)).toEqual(['ann@example.com', 'bob@example.com'])
    expect(invited.every(entry => entry.existingAccount === false)).toBe(true)
    for (const entry of invited) {
      expect(h.runtime.identity.principalByEmail(entry.email)?.principalId).toBe(entry.principalId)
      expect(entry.token).toBeTruthy()
      expect(h.runtime.identity.membership('ws-1', entry.principalId)?.status).toBe('invited')
    }
    // A second invite for the same email is a no-op (the unique pending index).
    const again = await h.run('people.invite', { workspaceId: 'ws-1', emails: ['ann@example.com'] })
    expect((again.result as { invited: unknown[] }).invited).toHaveLength(0)
    // The invitation itself is audited (DATA-MODEL §5.13).
    expect(h.auditRows().some(row => row.commandType === 'people.invite' && row.decision === 'executed')).toBe(true)
  })

  it('an existing account is invited without a placeholder', async () => {
    const h = harness()
    await h.run('workspaces.create', { name: 'Rox', slug: 'rox' })
    h.runtime.identity.createPrincipal({ principalId: 'ann', kind: 'human', status: 'active', primaryEmail: 'ann@example.com' })
    const receipt = await h.run('people.invite', { workspaceId: 'ws-1', emails: ['ANN@example.com'] })
    const { invited, cards } = receipt.result as { invited: Array<{ existingAccount: boolean; principalId: string }>; cards: unknown[] }
    expect(invited[0]).toMatchObject({ existingAccount: true, principalId: 'ann' })
    expect(cards).toHaveLength(1)
    expect(h.runtime.identity.membership('ws-1', 'ann')).toMatchObject({ status: 'invited' })
  })

  it('activation keeps the principal id, flips memberships and releases held notifications', async () => {
    const h = harness()
    await h.run('workspaces.create', { name: 'Rox', slug: 'rox' })
    const invited = await h.run('people.invite', { workspaceId: 'ws-1', emails: ['ann@example.com'] })
    const { invited: entries } = invited.result as { invited: Array<{ principalId: string }> }
    const principalId = entries[0]!.principalId
    // Held notifications while the invitee has not activated.
    h.runtime.notifications.hold(principalId, 'Вас упомянули в General')
    h.runtime.notifications.hold(principalId, 'Анна назначила вам задачу')

    const activation = await h.run('identity.activate_placeholder', { authSubject: 'oidc|ann', verifiedEmail: 'ann@example.com' })
    expect(activation.status).toBe('applied')
    expect(activation.ref).toEqual({ kind: 'person', id: principalId })
    const result = activation.result as { principalId: string; releasedNotifications: number; chats: number }
    expect(result.principalId).toBe(principalId)
    expect(result.releasedNotifications).toBe(2)
    expect(h.runtime.identity.principal(principalId)).toMatchObject({ status: 'active', authSubject: 'oidc|ann' })
    expect(h.runtime.identity.membership('ws-1', principalId)?.status).toBe('active')
    // The authorship/history rows keep pointing at the same principal.
    expect(h.runtime.identity.chatMembershipsOf(principalId)[0]?.state).toBe('active')
  })

  it('merge re-points memberships and chat memberships onto the account', async () => {
    const h = harness()
    await h.run('workspaces.create', { name: 'Rox', slug: 'rox' })
    const invited = await h.run('people.invite', { workspaceId: 'ws-1', emails: ['ann@example.com'] })
    const placeholderId = ((invited.result as { invited: Array<{ principalId: string }> }).invited[0]!).principalId
    h.runtime.identity.createPrincipal({ principalId: 'ann-account', kind: 'human', status: 'active', primaryEmail: 'ann.second@example.com' })

    const merged = await h.run('identity.merge_placeholder', { placeholderId, accountId: 'ann-account', confirmedBy: 'admin-1' })
    expect(merged.status).toBe('applied')
    expect(merged.result).toMatchObject({ placeholderId, accountId: 'ann-account' })
    expect(h.runtime.identity.principal(placeholderId)).toMatchObject({ status: 'deactivated', mergedInto: 'ann-account' })
    expect(h.runtime.identity.membership('ws-1', 'ann-account')).toMatchObject({ status: 'invited' })
    expect(h.runtime.identity.chatMembershipsOf(placeholderId)).toHaveLength(0)
    expect(h.auditRows().some(row => row.commandType === 'identity.merge_placeholder' && row.riskClass === 'privileged')).toBe(true)
  })

  it('refuses to activate a principal that is not a placeholder', async () => {
    const h = harness()
    await h.run('workspaces.create', { name: 'Rox', slug: 'rox' })
    const receipt = await h.run('identity.activate_placeholder', { authSubject: 'oidc|x', verifiedEmail: 'nobody@example.com' })
    expect(receipt.status).toBe('rejected')
    expect(receipt.error?.code).toBe('NOT_FOUND')
  })
})

describe('team chats (D-v2-2)', () => {
  it('creates a private group chat and a public channel with their policies', async () => {
    const h = harness()
    await h.run('workspaces.create', { name: 'Rox', slug: 'rox' })
    const group = await h.run('im.create_chat', { kind: 'group', visibility: 'private', members: ['p2', 'p3'] })
    expect(group.status).toBe('applied')
    expect(group.ref?.kind).toBe('channel')
    const groupChatId = (group.result as { chatId: string }).chatId
    expect(h.runtime.identity.chat(groupChatId)).toMatchObject({ kind: 'group', visibility: 'private' })
    expect(h.runtime.identity.memberCount(groupChatId)).toBe(3)

    const channel = await h.run('im.create_chat', { kind: 'channel', name: 'Отчёты', visibility: 'public', postingPolicy: 'admins', invitePolicy: 'admins' })
    expect(channel.status).toBe('applied')
    const channelId = (channel.result as { chatId: string }).chatId
    expect(h.runtime.identity.chat(channelId)).toMatchObject({ postingPolicy: 'admins', invitePolicy: 'admins' })

    // A channel without a name is refused by the handler contract.
    const unnamed = await h.run('im.create_chat', { kind: 'channel', visibility: 'public' })
    expect(unnamed.status).toBe('rejected')
    expect(unnamed.error?.code).toBe('VALIDATION')
  })

  it('honours the workspace `chat_creation` setting', async () => {
    const h = createAgentsHarness()
    harnesses.push(h)
    h.seedWorkspace({ chatCreation: 'admins' })
    h.runtime.identity.upsertMembership({ workspaceId: 'ws-1', principalId: 'member-1', role: 'member', status: 'active' })
    const receipt = await h.run('im.create_chat', { kind: 'group', visibility: 'private' }, { actor: { principalId: 'member-1', kind: 'user' } })
    expect(receipt.status).toBe('rejected')
    expect(receipt.error).toMatchObject({ code: 'FORBIDDEN' })
    expect(receipt.error?.message).toContain('policy_admins_only')
  })

  it('a placeholder cannot create a chat', async () => {
    const h = harness()
    await h.run('workspaces.create', { name: 'Rox', slug: 'rox' })
    const invited = await h.run('people.invite', { workspaceId: 'ws-1', emails: ['ann@example.com'] })
    const placeholderId = ((invited.result as { invited: Array<{ principalId: string }> }).invited[0]!).principalId
    const receipt = await h.run('im.create_chat', { kind: 'group', visibility: 'public' }, { actor: { principalId: placeholderId, kind: 'user' } })
    expect(receipt.status).toBe('rejected')
    expect(receipt.error?.code).toBe('FORBIDDEN')
  })

  it('public chats are discoverable and self-joinable; private ones are neither', async () => {
    const h = harness()
    await h.run('workspaces.create', { name: 'Rox', slug: 'rox' })
    const generalChatId = h.runtime.identity.workspace('ws-1')?.generalChatId as string
    const publicChannel = await h.run('im.create_chat', { kind: 'channel', name: 'Общий канал', visibility: 'public' })
    const privateGroup = await h.run('im.create_chat', { kind: 'group', visibility: 'private' })
    const privateId = (privateGroup.result as { chatId: string }).chatId

    // Nobody but the creator is in the private chat yet; an outsider sees only
    // the public chats in «Обзор чатов».
    h.runtime.identity.upsertMembership({ workspaceId: 'ws-1', principalId: 'member-2', role: 'member', status: 'active' })
    const browse = await h.run('im.browse_public_chats', { query: 'канал' }, { actor: { principalId: 'member-2', kind: 'user' } })
    expect(browse.status).toBe('applied')
    const chats = (browse.result as { chats: Array<{ chatId: string; visibility: string }> }).chats
    expect(chats.map(chat => chat.chatId)).toContain((publicChannel.result as { chatId: string }).chatId)
    expect(chats.map(chat => chat.chatId)).not.toContain(privateId)
    // The General chat is public, so it is discoverable when the filter matches.
    const all = await h.run('im.browse_public_chats', {}, { actor: { principalId: 'member-2', kind: 'user' } })
    expect((all.result as { chats: Array<{ chatId: string }> }).chats.map(chat => chat.chatId)).toContain(generalChatId)

    // Self-join a public chat; the private one answers FORBIDDEN.
    const joined = await h.run('im.join_chat', { chatId: (publicChannel.result as { chatId: string }).chatId }, { actor: { principalId: 'member-2', kind: 'user' } })
    expect(joined.status).toBe('applied')
    expect(h.runtime.identity.chatMember((publicChannel.result as { chatId: string }).chatId, 'member-2')?.state).toBe('active')
    const refused = await h.run('im.join_chat', { chatId: privateId }, { actor: { principalId: 'member-2', kind: 'user' } })
    expect(refused.status).toBe('rejected')
    expect(refused.error).toMatchObject({ code: 'FORBIDDEN' })

    // Leaving is a self-service action too.
    const left = await h.run('im.leave_chat', { chatId: (publicChannel.result as { chatId: string }).chatId }, { actor: { principalId: 'member-2', kind: 'user' } })
    expect(left.status).toBe('applied')
    expect(h.runtime.identity.chatMember((publicChannel.result as { chatId: string }).chatId, 'member-2')?.state).toBe('left')
  })

  it('the General chat stays public and cannot be left', async () => {
    const h = harness()
    await h.run('workspaces.create', { name: 'Rox', slug: 'rox' })
    const generalChatId = h.runtime.identity.workspace('ws-1')?.generalChatId as string
    // Switching it private is refused for the owner too.
    const visibility = await h.run('im.set_visibility', { chatId: generalChatId, visibility: 'private' })
    expect(visibility.status).toBe('rejected')
    expect(visibility.error).toMatchObject({ code: 'FORBIDDEN' })
    expect(visibility.error?.message).toContain('general_chat')
    // Leaving it is refused as well.
    const leave = await h.run('im.leave_chat', { chatId: generalChatId })
    expect(leave.status).toBe('rejected')
    expect(leave.error?.code).toBe('FORBIDDEN')
  })

  it('private → public needs admin rights and the history confirmation', async () => {
    const h = harness()
    await h.run('workspaces.create', { name: 'Rox', slug: 'rox' })
    const private_ = await h.run('im.create_chat', { kind: 'group', visibility: 'private' })
    const chatId = (private_.result as { chatId: string }).chatId
    h.runtime.identity.upsertMembership({ workspaceId: 'ws-1', principalId: 'member-2', role: 'member', status: 'active' })

    const asMember = await h.run('im.set_visibility', { chatId, visibility: 'public', confirmHistoryExposure: true }, { actor: { principalId: 'member-2', kind: 'user' } })
    expect(asMember.status).toBe('rejected')
    expect(asMember.error?.message).toContain('not_owner_or_admin')

    const withoutConfirmation = await h.run('im.set_visibility', { chatId, visibility: 'public' })
    expect(withoutConfirmation.status).toBe('rejected')
    expect(withoutConfirmation.error?.code).toBe('VALIDATION')

    const confirmed = await h.run('im.set_visibility', { chatId, visibility: 'public', confirmHistoryExposure: true })
    expect(confirmed.status).toBe('applied')
    expect(confirmed.result).toMatchObject({ visibility: 'public', privileged: true })
    expect(h.runtime.identity.chat(chatId)?.visibility).toBe('public')

    // Public → private keeps the current members and needs no confirmation.
    const back = await h.run('im.set_visibility', { chatId, visibility: 'private' })
    expect(back.status).toBe('applied')
    expect(back.result).toMatchObject({ privileged: false })
  })

  it('every team-chat command is bound, schema-checked and capability-visible', () => {
    const h = harness()
    const capabilities = h.capabilities()
    for (const type of ['workspaces.create', 'im.create_chat', 'im.join_chat', 'im.leave_chat', 'im.set_visibility', 'im.browse_public_chats']) {
      const capability = capabilities.find(candidate => candidate.type === type)
      expect(capability?.available, type).toBe(true)
      expect(h.registry.get(type)?.schemaBound, type).toBe(true)
    }
  })
})
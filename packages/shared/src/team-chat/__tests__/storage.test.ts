import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTeamChatStore, TeamChatError, type TeamChatOrgDirectory } from '../index.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const ORG = 'org-1'
const roles: Record<string, 'owner' | 'admin' | 'member'> = { alice: 'owner', bob: 'member', carol: 'member' }
const orgs: TeamChatOrgDirectory = {
  roleOf: (orgId, userId) => (orgId === ORG ? roles[userId] ?? null : null),
  memberIds: orgId => (orgId === ORG ? Object.keys(roles) : []),
}

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'team-chat-'))
  dirs.push(dir)
  return createTeamChatStore({ path: join(dir, 'team-chat.json'), orgs })
}
const alice = { userId: 'alice' }, bob = { userId: 'bob' }, carol = { userId: 'carol' }, mallory = { userId: 'mallory' }

describe('team chat store', () => {
  it('creates one shared default channel with every org member', () => {
    const s = store()
    const list = s.listChannels(ORG, bob)
    expect(list).toHaveLength(1)
    expect(list[0]!.isDefault).toBe(true)
    expect(list[0]!.memberIds.sort()).toEqual(['alice', 'bob', 'carol'])
    expect(s.listChannels(ORG, alice)).toHaveLength(1)
  })

  it('rejects non-members of the org', () => {
    const s = store()
    expect(() => s.listChannels(ORG, mallory)).toThrow(TeamChatError)
    const general = s.listChannels(ORG, alice)[0]!
    expect(() => s.postMessage(general.id, 'hi', mallory)).toThrow()
  })

  it('hides private channels and group chats from non-members', () => {
    const s = store()
    const priv = s.createChannel({ orgId: ORG, name: 'secret', visibility: 'private' }, alice)
    const group = s.createChannel({ orgId: ORG, name: 'a+b', kind: 'group', visibility: 'public', memberIds: ['bob', 'mallory'] }, alice)
    expect(group.visibility).toBe('private')
    expect(group.memberIds.sort()).toEqual(['alice', 'bob'])
    expect(s.listChannels(ORG, carol).map(c => c.name)).toEqual(['general'])
    expect(() => s.listMessages({ channelId: priv.id }, carol)).toThrow('Channel not found')
    expect(() => s.joinChannel(priv.id, carol)).toThrow()
    expect(s.listChannels(ORG, bob).map(c => c.name).sort()).toEqual(['a+b', 'general'])
  })

  it('public channels: join, post, unread, subscribe without joining', () => {
    const s = store()
    const pub = s.createChannel({ orgId: ORG, name: 'releases' }, alice)
    expect(() => s.postMessage(pub.id, 'hi', bob)).toThrow('Join the channel to post')
    const sub = s.setSubscribed(pub.id, true, carol)
    expect(sub.viewerSubscribed).toBe(true)
    expect(sub.viewerRole).toBeUndefined()
    s.postMessage(pub.id, '  v1 shipped  ', alice)
    expect(s.listMessages({ channelId: pub.id }, carol).messages.map(m => m.text)).toEqual(['v1 shipped'])
    s.joinChannel(pub.id, bob)
    s.postMessage(pub.id, 'nice', alice)
    expect(s.listChannels(ORG, bob).find(c => c.id === pub.id)!.unreadCount).toBe(1)
    s.markRead(pub.id, bob)
    expect(s.listChannels(ORG, bob).find(c => c.id === pub.id)!.unreadCount).toBe(0)
    expect(s.setSubscribed(pub.id, false, carol).viewerSubscribed).toBe(false)
  })

  it('validates names and protects the default channel', () => {
    const s = store()
    expect(() => s.createChannel({ orgId: ORG, name: '   ' }, alice)).toThrow()
    s.createChannel({ orgId: ORG, name: 'Design' }, alice)
    expect(() => s.createChannel({ orgId: ORG, name: 'design' }, bob)).toThrow('already exists')
    const general = s.listChannels(ORG, alice).find(c => c.isDefault)!
    expect(() => s.leaveChannel(general.id, bob)).toThrow()
    expect(() => s.archiveChannel(general.id, alice)).toThrow()
    expect(() => s.postMessage(general.id, 'x'.repeat(4001), alice)).toThrow('too long')
  })

  it('only admins archive; archived channels disappear', () => {
    const s = store()
    const pub = s.createChannel({ orgId: ORG, name: 'tmp' }, bob)
    s.joinChannel(pub.id, carol)
    expect(() => s.archiveChannel(pub.id, carol)).toThrow('Only channel or org admins')
    s.archiveChannel(pub.id, alice)
    expect(s.listChannels(ORG, bob).some(c => c.id === pub.id)).toBe(false)
  })
})

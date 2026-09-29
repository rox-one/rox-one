import { beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OrganizationWithMembers } from '@craft-agent/shared/orgs'
import { addComment, assign } from '@craft-agent/shared/team'
import { pickActiveOrg, toTeamMembers } from '../use-team-roster'
import { activityText, memberInitials, memberName, syncStatusText } from '../team-labels'
import { __resetTeamStoreForTests, dispatchTeam, readTeamState, teamActionContext } from '../team-store'

const rendererDir = join(import.meta.dir, '..', '..', '..')
const repoRoot = join(rendererDir, '..', '..', '..', '..')
const read = (rel: string) => readFileSync(join(rendererDir, rel), 'utf8')
const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)

const org: OrganizationWithMembers = {
  id: 'o1', name: 'Org', slug: 'org', createdBy: 'u1', createdAt: 1,
  members: [
    { orgId: 'o1', userId: 'u1', role: 'owner', username: 'mark', joinedAt: 1 },
    { orgId: 'o1', userId: 'u2', role: 'member', email: 'anna@example.test', joinedAt: 2 },
  ],
  pendingInvites: [],
}

describe('team roster (real org members only)', () => {
  it('maps org members and picks the org the user belongs to', () => {
    const members = toTeamMembers(org)
    expect(members.map((m) => m.displayName)).toEqual(['mark', 'anna@example.test'])
    expect(toTeamMembers(null)).toEqual([])
    const other = { ...org, id: 'o0', members: [] }
    expect(pickActiveOrg([other, org], 'u2')?.id).toBe('o1')
    expect(pickActiveOrg([], 'u2')).toBeNull()
  })
})

describe('team labels', () => {
  it('renders honest sync states', () => {
    expect(syncStatusText({ state: 'no-org' }, 0, t)).toBe('teamCollab.sync.noOrg')
    expect(syncStatusText({ state: 'org-server-required', orgId: 'o1' }, 2, t)).toContain('serverRequiredPending')
    expect(memberName(toTeamMembers(org), 'u1', 'u1', t)).toBe('teamCollab.you')
    expect(memberName(toTeamMembers(org), 'zz', 'u1', t)).toBe('teamCollab.unknownMember')
    expect(memberInitials('Анна Котова')).toBe('АК')
  })
})

describe('team store', () => {
  beforeEach(() => __resetTeamStoreForTests())
  it('applies reducers and keeps queued outbox (no server)', () => {
    const roster = toTeamMembers(org)
    const target = { kind: 'session' as const, id: 's1', title: 'S' }
    dispatchTeam((s) => assign(s, teamActionContext('u1'), { target, assigneeUserId: 'u2', roster }))
    dispatchTeam((s) => addComment(s, teamActionContext('u1'), { target, body: 'hi @anna', roster }))
    const s = readTeamState()
    expect(s.assignments).toHaveLength(1)
    expect(s.comments[0]!.mentions).toEqual(['u2'])
    expect(s.outbox).toHaveLength(2)
    expect(activityText(s.activity[s.activity.length - 1]!, roster, 'u1', t)).toContain('teamCollab.activity.assign')
    expect(() => dispatchTeam((st) => assign(st, teamActionContext('u1'), { target, assigneeUserId: 'ghost', roster }))).toThrow()
  })
})

describe('team wiring', () => {
  it('mounts the session button in the chat header and the section in Organizations', () => {
    expect(read('pages/ChatPage.tsx')).toContain('<TeamSessionButton')
    expect(read('pages/settings/OrganizationsSettingsPage.tsx')).toContain('<TeamOrgSettingsSection')
    const inbox = read('pages/InboxPage.tsx')
    expect(inbox).toContain('useTeamInboxNav()')
    expect(inbox).toContain("t('teamCollab.inboxNav')")
  })

  it('never ships fake teammates in team components', () => {
    for (const f of readdirSync(join(rendererDir, 'components/team')).filter((n) => n.endsWith('.tsx') || n.endsWith('.ts'))) {
      const src = read(`components/team/${f}`)
      expect(src).not.toMatch(/Иван|Анна|mock(Member|User)/)
    }
  })

  it('has every teamCollab key in all locales', () => {
    const used = new Set<string>(['teamCollab.inboxNav'])
    for (const f of readdirSync(join(rendererDir, 'components/team')).filter((n) => /\.tsx?$/.test(n))) {
      for (const m of read(`components/team/${f}`).matchAll(/t\('(teamCollab\.[\w.-]+)'/g)) used.add(m[1]!)
    }
    expect(used.size).toBeGreaterThan(20)
    const localesDir = join(repoRoot, 'packages/shared/src/i18n/locales')
    for (const file of readdirSync(localesDir).filter((n) => n.endsWith('.json'))) {
      const dict = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of used) expect(dict[key], `${file}: ${key}`).toBeTruthy()
      for (const k of ['view', 'comment', 'run']) expect(dict[`teamCollab.role.${k}`]).toBeTruthy()
    }
  })
})

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isVerifiedEffect } from '@craft-agent/core/rox2'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import {
  createLiveDisabledTrackerActions,
  createMemorySourceRegistry,
  createMemoryTrackerAdapter,
  createTrackerActions,
  resolveTrackerTarget,
  type TrackerCreateRequest,
  type TrackerTarget,
} from '../tracker-actions.ts'

const githubTarget: TrackerTarget = {
  provider: 'github',
  accountId: 'acct_1',
  repositoryId: 'repo_42',
  projectId: 'proj_9',
  assigneeId: 'user_7',
}

const githubGrant: MeetingGrant = {
  id: 'g-gh',
  actorId: 'acct-1',
  workspaceId: 'ws-a',
  deviceId: 'dev-1',
  capabilities: ['action.external'],
  target: 'github:acct_1:repo_42',
  expiresAt: 9_000,
}

const registry = createMemorySourceRegistry([
  { provider: 'github', accountId: 'acct_1', slug: 'github', credentialRef: 'cred:github:acct_1', enabled: true },
  { provider: 'linear', accountId: 'acct_l', slug: 'linear', credentialRef: 'cred:linear:acct_l', enabled: true },
])

function request(overrides: Partial<TrackerCreateRequest> = {}): TrackerCreateRequest {
  return {
    operationId: 'op-1',
    idempotencyKey: 'idem-1',
    payloadHash: 'hash-1',
    sourceRevision: 'src-1',
    target: githubTarget,
    approvedTarget: githubTarget,
    currentAssigneeId: 'user_7',
    draft: {
      title: 'Follow up',
      context: 'from meeting',
      acceptanceCriteria: ['has source link'],
      priority: 'p1',
      source: { meetingId: 'mtg_1', excerptHash: 'abc', segmentId: 'seg-1', segmentRevision: 2, quote: 'open the github issue' },
    },
    grants: [githubGrant],
    actorId: 'acct-1',
    workspaceId: 'ws-a',
    deviceId: 'dev-1',
    now: 1,
    ...overrides,
  }
}

describe('meeting tracker actions (issue 373 / I017)', () => {
  test('resolves exact GitHub/Linear IDs before approval and rejects a name-only target', () => {
    const ok = resolveTrackerTarget(githubTarget, registry)
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.target.resource).toBe('github:acct_1:repo_42')
    expect(ok.target.credentialRef).toBe('cred:github:acct_1')
    const named = resolveTrackerTarget(
      { provider: 'github', accountId: 'acct_1', repositoryName: 'other-repo' },
      registry,
    )
    expect(named.ok).toBe(false)
    if (named.ok) return
    expect(named.reason).toBe('missing-exact-ids')
  })

  test('denies wrong target instead of auto-retargeting', async () => {
    const adapter = createMemoryTrackerAdapter()
    const actions = createTrackerActions(adapter, registry)
    const result = await actions.createFromMeeting(
      request({ target: { ...githubTarget, repositoryId: 'repo_other' } }),
    )
    expect(result.status).toBe('denied')
    expect(result.reason).toBe('wrong_target')
    expect(result.live).toBe(false)
    expect(isVerifiedEffect(result.result)).toBe(false)
    expect(adapter.writes).toHaveLength(0)
    expect(adapter.list()).toHaveLength(0)
  })

  test('denies missing permissions and expired grants', async () => {
    const adapter = createMemoryTrackerAdapter()
    const actions = createTrackerActions(adapter, registry)
    const deniedPerm = await actions.createFromMeeting(
      request({
        grants: [{ ...githubGrant, target: 'github:other:repo' }],
      }),
    )
    expect(deniedPerm.reason).toBe('permissions')
    expect(adapter.writes).toHaveLength(0)
    const expired = await actions.createFromMeeting(
      request({
        grants: [{ ...githubGrant, expiresAt: 0 }],
      }),
    )
    expect(expired.reason).toBe('permissions')
    expect(isVerifiedEffect(expired.result)).toBe(false)
  })

  test('does not duplicate creates with the same idempotency key', async () => {
    const adapter = createMemoryTrackerAdapter()
    const actions = createTrackerActions(adapter, registry)
    const first = await actions.createFromMeeting(request())
    const second = await actions.createFromMeeting(request())
    expect(first.status).toBe('acked')
    expect(first.live).toBe(false)
    expect(first.evidenceLevel).toBe('U1')
    expect(isVerifiedEffect(first.result)).toBe(false)
    expect(first.result.mode).toBe('fixture')
    expect(second.status).toBe('duplicate')
    expect(first.issue?.remoteId).toBe(second.issue?.remoteId)
    expect(adapter.writes).toHaveLength(1)
    expect(actions.bindings('mtg_1')).toHaveLength(1)
    expect(first.issue?.htmlUrl).toContain('github.com')
    expect(first.issue?.acceptanceCriteria).toEqual(['has source link'])
    expect(first.binding?.htmlUrl).toBe(first.issue?.htmlUrl)
  })

  test('maps post-write timeout to unknown for reconciliation', async () => {
    const adapter = createMemoryTrackerAdapter({ fail: 'timeout' })
    const actions = createTrackerActions(adapter, registry)
    const result = await actions.createFromMeeting(request({ idempotencyKey: 'timeout-1', operationId: 'op-timeout' }))
    expect(result.status).toBe('unknown')
    expect(result.reason).toBe('timeout')
    expect(result.live).toBe(false)
    expect(result.result.verification).toBe('unknown')
    expect(isVerifiedEffect(result.result)).toBe(false)
    const replay = await actions.createFromMeeting(request({ idempotencyKey: 'timeout-1', operationId: 'op-timeout' }))
    expect(replay.status).toBe('unknown')
    expect(adapter.writes).toHaveLength(1)
  })

  test('rejects concurrent updates via CAS revision mismatch', async () => {
    const actions = createTrackerActions(createMemoryTrackerAdapter({ currentRevision: '2' }), registry)
    const result = await actions.updateFromMeeting({
      ...request(),
      remoteId: 'iss-1',
      expectedRevision: '1',
      currentRevision: '2',
    })
    expect(result.status).toBe('conflict')
    expect(result.reason).toBe('concurrent_update')
    expect(isVerifiedEffect(result.result)).toBe(false)
  })

  test('denies when assignee changed after approval', async () => {
    const adapter = createMemoryTrackerAdapter()
    const actions = createTrackerActions(adapter, registry)
    const result = await actions.createFromMeeting(request({ currentAssigneeId: 'user_other' }))
    expect(result.reason).toBe('assignee_changed')
    expect(adapter.writes).toHaveLength(0)
  })

  test('never auto-merges a draft PR and never treats fixture as live', async () => {
    const adapter = createMemoryTrackerAdapter()
    const actions = createTrackerActions(adapter, registry)
    const merge = await actions.createFromMeeting(request({ draftPr: { autoMerge: true } }))
    expect(merge.live).toBe(false)
    expect(merge.reason).toBe('draft-pr-no-auto-merge')
    expect(adapter.writes).toHaveLength(0)

    const created = await actions.createFromMeeting(request({ idempotencyKey: 'idem-2', operationId: 'op-2' }))
    expect(created.status).toBe('acked')
    expect(created.live).toBe(false)
    expect(created.evidenceLevel).toBe('U1')
    expect(isVerifiedEffect(created.result)).toBe(false)
    expect(JSON.stringify(created.result)).not.toMatch(/"verification":"verified"/)
  })

  test('live-disabled export stays unsupported and revoke does not delete remote issues', async () => {
    const disabled = createLiveDisabledTrackerActions()
    const result = await disabled.createFromMeeting(request())
    expect(result.status).toBe('unsupported')
    expect(result.reason).toBe('live-disabled')

    const adapter = createMemoryTrackerAdapter()
    const actions = createTrackerActions(adapter, registry)
    const created = await actions.createFromMeeting(request())
    expect(created.issue?.remoteId).toBeTruthy()
    actions.setCapabilityEnabled(false)
    const after = await actions.createFromMeeting(request({ idempotencyKey: 'idem-3', operationId: 'op-3' }))
    expect(after.status).toBe('unsupported')
    expect(adapter.list()).toHaveLength(1)
    expect(adapter.list()[0]?.remoteId).toBe(created.issue?.remoteId)
  })

  test('requires exact Linear team IDs and does not retarget a denied write', async () => {
    const adapter = createMemoryTrackerAdapter()
    const actions = createTrackerActions(adapter, registry)
    const linearGrant: MeetingGrant = {
      ...githubGrant,
      id: 'g-lin',
      target: 'linear:acct_l:team_1',
    }
    const missing = await actions.createFromMeeting(
      request({
        target: { provider: 'linear', accountId: 'acct_l' },
        approvedTarget: { provider: 'linear', accountId: 'acct_l' },
        grants: [linearGrant],
      }),
    )
    expect(missing.reason).toBe('missing-exact-ids')
    expect(adapter.writes).toHaveLength(0)

    const linear: TrackerTarget = { provider: 'linear', accountId: 'acct_l', teamId: 'team_1' }
    const ok = await actions.createFromMeeting(
      request({
        operationId: 'op-lin',
        idempotencyKey: 'lin-1',
        target: linear,
        approvedTarget: linear,
        currentAssigneeId: undefined,
        grants: [linearGrant],
      }),
    )
    expect(ok.status).toBe('acked')
    expect(ok.live).toBe(false)
    expect(ok.issue?.htmlUrl).toContain('linear.app')
    expect(ok.issue?.resource).toBe('linear:acct_l:team_1')
  })

  test('does not use a new credential store and keeps issues out of the meeting copy', () => {
    const source = readFileSync(join(import.meta.dir, '../tracker-actions.ts'), 'utf8')
    expect(source).toContain('credentialRef')
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('GITHUB_TOKEN')
    expect(source).not.toContain('LINEAR_API_KEY')
    expect(source).toContain('The meeting keeps a link/span')
  })
})

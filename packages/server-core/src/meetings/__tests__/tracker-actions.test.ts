import { describe, expect, it } from 'bun:test'
import { isLiveVerified } from '../types.ts'
import {
  createLiveDisabledTrackerActions,
  createMemoryTrackerAdapter,
  createTrackerActions,
  type TrackerAdapter,
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

function request(overrides: Partial<TrackerCreateRequest> = {}): TrackerCreateRequest {
  return {
    operationId: 'op-1',
    idempotencyKey: 'idem-1',
    sourceRevision: 'src-1',
    target: githubTarget,
    approvedTarget: githubTarget,
    currentAssigneeId: 'user_7',
    draft: {
      title: 'Follow up',
      context: 'from meeting',
      acceptanceCriteria: ['has source link'],
      priority: 'p1',
      source: { meetingId: 'mtg_1', excerptHash: 'abc' },
    },
    grant: {
      actions: ['tracker.create'],
      resources: ['github:acct_1:repo_42'],
    },
    ...overrides,
  }
}

describe('tracker-actions fail-closed (#373)', () => {
  it('denies wrong target instead of auto-retargeting', async () => {
    const actions = createTrackerActions(createMemoryTrackerAdapter())
    const result = await actions.createFromMeeting(
      request({
        target: { ...githubTarget, repositoryId: 'repo_other' },
      }),
    )
    expect(result.status).toBe('denied')
    expect(result.reason).toBe('wrong_target')
    expect(result.live).toBe(false)
  })

  it('denies missing permissions and expired grants', async () => {
    const actions = createTrackerActions(createMemoryTrackerAdapter())
    const deniedPerm = await actions.createFromMeeting(
      request({ grant: { actions: ['tracker.create'], resources: ['github:other:repo'] } }),
    )
    expect(deniedPerm.reason).toBe('permissions')
    const expired = await actions.createFromMeeting(
      request({ grant: { actions: ['tracker.create'], resources: ['github:acct_1:repo_42'], expired: true } }),
    )
    expect(expired.reason).toBe('permissions')
  })

  it('does not duplicate creates with the same idempotency key', async () => {
    const actions = createTrackerActions(createMemoryTrackerAdapter())
    const first = await actions.createFromMeeting(request())
    const second = await actions.createFromMeeting(request())
    expect(first.status).toBe('verified')
    expect(first.live).toBe(false)
    expect(second.status).toBe('duplicate')
    expect(first.payload?.remoteId).toBe(second.payload?.remoteId)
  })

  it('maps post-write timeout to unknown for reconciliation', async () => {
    const actions = createTrackerActions(createMemoryTrackerAdapter({ fail: 'timeout' }))
    const result = await actions.createFromMeeting(request({ idempotencyKey: 'timeout-1', operationId: 'op-timeout' }))
    expect(result.status).toBe('unknown')
    expect(result.reason).toBe('timeout')
    expect(result.live).toBe(false)
  })

  it('rejects concurrent updates via CAS revision mismatch', async () => {
    const actions = createTrackerActions(createMemoryTrackerAdapter({ currentRevision: '2' }))
    const result = await actions.updateFromMeeting({
      ...request(),
      remoteId: 'iss-1',
      baseRevision: '1',
      currentRevision: '2',
    })
    expect(result.status).toBe('conflict')
    expect(result.reason).toBe('concurrent_update')
  })

  it('denies when assignee changed after approval', async () => {
    const actions = createTrackerActions(createMemoryTrackerAdapter())
    const result = await actions.createFromMeeting(request({ currentAssigneeId: 'user_other' }))
    expect(result.reason).toBe('assignee_changed')
  })

  it('never auto-merges a draft PR and never treats fixture as live', async () => {
    const actions = createTrackerActions(createMemoryTrackerAdapter())
    const merge = await actions.createFromMeeting(request({ draftPr: { autoMerge: true } }))
    expect(resultLive(merge)).toBe(false)
    expect(merge.reason).toBe('draft-pr-no-auto-merge')

    const created = await actions.createFromMeeting(request({ idempotencyKey: 'idem-2', operationId: 'op-2' }))
    expect(created.status).toBe('verified')
    expect(created.live).toBe(false)
    expect(created.evidenceLevel).toBe('U1')
  })

  it('live-disabled export stays unsupported', async () => {
    const actions = createLiveDisabledTrackerActions()
    const result = await actions.createFromMeeting(request())
    expect(result.status).toBe('unsupported')
    expect(result.reason).toBe('live-disabled')
  })

  it('does not let a simulated adapter claim live', async () => {
    const inner = createMemoryTrackerAdapter()
    const simulated: TrackerAdapter = {
      mode: 'live',
      createIssue: (req) => inner.createIssue(req),
      updateIssue: (req) => inner.updateIssue(req),
    }
    const actions = createTrackerActions(simulated)
    const created = await actions.createFromMeeting(
      request({ idempotencyKey: 'sim-live', operationId: 'op-sim' }),
    )
    expect(created.status).toBe('blocked')
    expect(created.reason).toBe('fixture-not-live')
    expect(created.live).toBe(false)
    expect(created.evidenceLevel).toBe('U1')
    expect(isLiveVerified(created)).toBe(false)
    expect(created.payload?.mode).not.toBe('live')

    const updated = await actions.updateFromMeeting({
      ...request({ idempotencyKey: 'sim-live-upd', operationId: 'op-sim-upd' }),
      remoteId: 'iss-sim',
      baseRevision: '1',
    })
    expect(updated.status).toBe('blocked')
    expect(updated.reason).toBe('fixture-not-live')
    expect(updated.live).toBe(false)
    expect(isLiveVerified(updated)).toBe(false)
    expect(updated.payload?.mode).not.toBe('live')
  })

  it('requires exact Linear team IDs', async () => {
    const actions = createTrackerActions(createMemoryTrackerAdapter())
    const linear: TrackerTarget = { provider: 'linear', accountId: 'acct_l', teamId: 'team_1' }
    const missing = await actions.createFromMeeting(
      request({
        target: { provider: 'linear', accountId: 'acct_l' },
        approvedTarget: { provider: 'linear', accountId: 'acct_l' },
        grant: { actions: ['tracker.create'], resources: ['linear:acct_l:team_1'] },
      }),
    )
    expect(missing.reason).toBe('missing-exact-ids')
    const ok = await actions.createFromMeeting(
      request({
        operationId: 'op-lin',
        idempotencyKey: 'lin-1',
        target: linear,
        approvedTarget: linear,
        currentAssigneeId: undefined,
        grant: { actions: ['tracker.create'], resources: ['linear:acct_l:team_1'] },
      }),
    )
    expect(ok.status).toBe('verified')
    expect(ok.live).toBe(false)
  })
})

function resultLive(result: { live: boolean }): boolean {
  return result.live
}

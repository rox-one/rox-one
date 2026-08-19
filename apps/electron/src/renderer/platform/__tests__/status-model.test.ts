import { describe, expect, it } from 'bun:test'
import { buildStatusBarModel, countActiveRuns, countPendingApprovals } from '../status-model'

describe('buildStatusBarModel', () => {
  it('defaults to local with sync OK and zero counts', () => {
    expect(buildStatusBarModel({})).toEqual({
      workspaceMode: 'local',
      syncOk: true,
      runCount: 0,
      approvalCount: 0,
      permissionMode: null,
      peopleCount: 0,
      agentCount: 0,
    })
  })

  it('treats a connected remote transport as remote', () => {
    const model = buildStatusBarModel({ transportMode: 'remote', transportStatus: 'connected' })
    expect(model.workspaceMode).toBe('remote')
    expect(model.syncOk).toBe(true)
  })

  it('treats idle remote as remote', () => {
    expect(buildStatusBarModel({ transportMode: 'remote', transportStatus: 'idle' }).workspaceMode).toBe('remote')
  })

  it('treats a disconnected remote transport as offline', () => {
    const model = buildStatusBarModel({ transportMode: 'remote', transportStatus: 'reconnecting' })
    expect(model.workspaceMode).toBe('offline')
    expect(model.syncOk).toBe(false)
  })

  it('passes through counts and permission mode', () => {
    const model = buildStatusBarModel({
      runCount: 3,
      approvalCount: 1,
      permissionMode: 'ask',
      peopleCount: 2,
      agentCount: 4,
    })
    expect(model.runCount).toBe(3)
    expect(model.approvalCount).toBe(1)
    expect(model.permissionMode).toBe('ask')
    expect(model.peopleCount).toBe(2)
    expect(model.agentCount).toBe(4)
  })
})

describe('countPendingApprovals / countActiveRuns', () => {
  it('sums permission queues across sessions', () => {
    expect(countPendingApprovals(undefined)).toBe(0)
    expect(countPendingApprovals(new Map([
      ['a', [{}, {}]],
      ['b', [{}]],
    ]))).toBe(3)
  })

  it('counts running and stale tasks only', () => {
    expect(countActiveRuns(undefined)).toBe(0)
    expect(countActiveRuns([
      { status: 'running' },
      { status: 'stale' },
      { status: 'completed' },
      { status: 'failed' },
    ])).toBe(2)
  })
})

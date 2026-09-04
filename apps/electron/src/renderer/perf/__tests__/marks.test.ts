import { beforeEach, describe, expect, it } from 'bun:test'
import { clearInteractions, endInteraction, getCompletedInteractions, startInteraction } from '../marks'
import { clearIpcCalls, recordIpcInvoke } from '../ipc-counter'

describe('interaction marks', () => {
  beforeEach(() => {
    clearInteractions()
    clearIpcCalls()
  })

  it('captures IPC delta for a cached switch window', () => {
    startInteraction('cached-session-switch')
    recordIpcInvoke('sessions:getMessages', 12)
    const duration = endInteraction('cached-session-switch')
    expect(duration).toBeGreaterThanOrEqual(0)
    const completed = getCompletedInteractions()
    expect(completed[0]?.kind).toBe('cached-session-switch')
    expect(completed[0]?.ipcDelta['sessions:getMessages']?.count).toBe(1)
    expect(completed[0]?.ipcDelta['sessions:get']).toBeUndefined()
  })
})

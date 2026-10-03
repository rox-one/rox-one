import { describe, expect, it } from 'bun:test'
import { RoxConnectFlow } from '../rox-connect-flow'
import type { RoxDevicePollApproved, RoxDeviceStartResult } from '@craft-agent/shared/auth/rox-cloud'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const approved: RoxDevicePollApproved = { status: 'approved', accessToken: 'synthetic-token', expiresIn: 60, tokenType: 'Bearer', user: { id: 'synthetic-user', name: 'Test', email: 'test@example.test' } }
const started: RoxDeviceStartResult = { deviceCode: 'synthetic-device', userCode: 'TEST-CODE', verificationUri: 'https://example.test/device', verificationUriComplete: 'https://example.test/device', expiresIn: 60, interval: 5 }
const flush = () => Bun.sleep(1)

describe('Rox Connect attempt ownership', () => {
  function fixture() {
    const approvals: Array<ReturnType<typeof deferred<RoxDevicePollApproved>>> = []
    const saved: string[] = []
    const errors: string[] = []
    const flow = new RoxConnectFlow({
      start: async () => started,
      wait: async () => { const approval = deferred<RoxDevicePollApproved>(); approvals.push(approval); return approval.promise },
      save: async value => { saved.push(value.user.id) },
      clear: async () => { saved.length = 0 },
      failed: message => { errors.push(message) },
    })
    return { flow, approvals, saved, errors }
  }
  it('never saves an old approval after restart', async () => {
    const f = fixture()
    await f.flow.start(); await f.flow.start()
    f.approvals[0]!.resolve(approved); await flush()
    expect(f.saved).toEqual([])
    f.approvals[1]!.resolve(approved); await flush()
    expect(f.saved).toEqual(['synthetic-user'])
    expect(f.flow.state).toEqual({ connectError: null, connectExpiresAt: null })
  })
  it('ignores stale errors and allows retry after a current approval fails', async () => {
    const f = fixture()
    await f.flow.start(); await f.flow.start()
    f.approvals[0]!.reject(new Error('stale failure')); await flush()
    expect(f.errors).toEqual([])
    f.approvals[1]!.reject(new Error('DEVICE_CODE_EXPIRED')); await flush()
    expect(f.flow.state.connectError).toBe('DEVICE_CODE_EXPIRED')
    await f.flow.start()
    expect(f.flow.state.connectError).toBeNull()
  })
  it('cannot reconnect from a late approved response after logout', async () => {
    const f = fixture()
    await f.flow.start(); await f.flow.clear()
    f.approvals[0]!.resolve(approved); await flush()
    expect(f.saved).toEqual([])
    expect(f.flow.state).toEqual({ connectError: null, connectExpiresAt: null })
  })
  it('waits for an in-progress secure write before final logout deletion', async () => {
    const pendingSave = deferred<void>()
    const approval = deferred<RoxDevicePollApproved>()
    let session: string | null = null
    const flow = new RoxConnectFlow({ start: async () => started, wait: () => approval.promise,
      save: async value => { await pendingSave.promise; session = value.user.id }, clear: async () => { session = null }, failed() {} })
    await flow.start(); approval.resolve(approved); await flush()
    let cleared = false
    const clearing = flow.clear().then(() => { cleared = true })
    await flush(); expect(cleared).toBe(false)
    pendingSave.resolve(); await clearing
    expect(session).toBeNull()
  })
  it('rejects old HTTP starts that complete after a newer attempt', async () => {
    const starts = [deferred<RoxDeviceStartResult>(), deferred<RoxDeviceStartResult>()]
    let calls = 0; let polls = 0
    const flow = new RoxConnectFlow({ start: () => starts[calls++]!.promise, wait: async () => { polls++; return new Promise(() => {}) }, save: async () => {}, clear: async () => {}, failed() {} })
    const first = flow.start(); const second = flow.start()
    starts[1]!.resolve(started); await second
    starts[0]!.resolve(started)
    await expect(first).rejects.toThrow('ROX_CONNECT_CANCELLED')
    expect(polls).toBe(1)
    await flow.clear()
  })
})

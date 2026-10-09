import { describe, expect, it } from 'bun:test'
import type { RpcServer } from '@rox/server-core/transport'
import type { GatewayService } from '@rox/server-core/service'
import type { DoctorReport, ServiceLifecycleResult, ServiceStatus } from '@rox/shared/service-lifecycle'
import { registerServiceLifecycleIpc, SERVICE_LIFECYCLE_HANDLED_CHANNELS } from '../service-lifecycle-ipc'
import { RPC_CHANNELS } from '../../shared/types'

type Handler = (...args: unknown[]) => unknown

function createHarness(service: Partial<GatewayService>, report: DoctorReport = { generatedAt: 1, checks: [] }) {
  const handlers = new Map<string, Handler>()
  const pushes: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  const server = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) },
    push: (channel: string, target: unknown, ...args: unknown[]) => { pushes.push({ channel, target, args }) },
  } as unknown as RpcServer
  const runDoctor = async (): Promise<DoctorReport> => report
  registerServiceLifecycleIpc({ server, service: service as GatewayService, runDoctor })
  return { handlers, pushes }
}

function status(state: ServiceStatus['state']): ServiceStatus {
  return { state, platform: 'darwin', managed: true, autostart: true }
}

describe('serviceLifecycle IPC', () => {
  it('registers every service lifecycle channel on the embedded server', () => {
    const h = createHarness({})
    expect([...h.handlers.keys()].sort()).toEqual([...SERVICE_LIFECYCLE_HANDLED_CHANNELS].sort())
  })

  it('returns the status projection and publishes transitions to all clients', async () => {
    const h = createHarness({
      getStatus: async () => status('installed'),
      start: async (): Promise<ServiceLifecycleResult> => ({ ok: true, status: status('running') }),
    })
    expect(await h.handlers.get(RPC_CHANNELS.serviceLifecycle.GET_STATUS)!()).toMatchObject({ state: 'installed' })
    const result = await h.handlers.get(RPC_CHANNELS.serviceLifecycle.START)!()
    expect(result).toMatchObject({ ok: true, status: { state: 'running' } })
    expect(h.pushes).toEqual([
      { channel: RPC_CHANNELS.serviceLifecycle.STATUS_CHANGED, target: { to: 'all' }, args: [status('running')] },
    ])
  })

  it('does not publish when an operation fails without changing state', async () => {
    const h = createHarness({
      getStatus: async () => status('failed'),
      stop: async (): Promise<ServiceLifecycleResult> => ({ ok: false, status: status('failed') }),
    })
    await h.handlers.get(RPC_CHANNELS.serviceLifecycle.STOP)!()
    expect(h.pushes).toHaveLength(0)
  })

  it('runs the doctor and caches the last report', async () => {
    const report: DoctorReport = { generatedAt: 42, checks: [{ checkId: 'logs', severity: 'warn', messageKey: 'doctor.logs.detail' }] }
    const h = createHarness({}, report)
    expect(await h.handlers.get(RPC_CHANNELS.diagnostics.GET_LAST)!()).toBeNull()
    expect(await h.handlers.get(RPC_CHANNELS.diagnostics.RUN)!()).toEqual(report)
    expect(await h.handlers.get(RPC_CHANNELS.diagnostics.GET_LAST)!()).toEqual(report)
  })
})
import { describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:net'
import { defaultPortAvailable, runDoctor, type DoctorDependencies } from '../doctor.ts'
import type { DoctorReport, ServiceStatus } from '@rox/shared/service-lifecycle'

function deps(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  return {
    now: () => 1_700_000_000_000,
    getServiceStatus: async () => ({
      state: 'running', platform: 'darwin', managed: true, autostart: true,
    } satisfies ServiceStatus),
    servicePorts: [],
    isPortAvailable: async () => true,
    configDir: '/Users/x/rox',
    pathExists: async () => true,
    appVersion: '0.11.8',
    runtimeVersion: '0.11.8',
    logPaths: ['/Users/x/rox/logs/messaging-gateway.log'],
    ...overrides,
  }
}

function byId(report: DoctorReport, id: string) {
  return report.checks.find(check => check.checkId === id)!
}

describe('service doctor', () => {
  it('reports ok for a healthy host and covers every check id exactly once', async () => {
    const report = await runDoctor(deps())
    expect(report.generatedAt).toBe(1_700_000_000_000)
    expect(report.checks.map(check => check.checkId)).toEqual([
      'service-state', 'port-conflict', 'runtime-mismatch', 'config-dir', 'logs',
    ])
    for (const check of report.checks) expect(check.severity).toBe('ok')
  })

  it('flags failed/degraded service state as an error and not-installed as warn', async () => {
    const failed = await runDoctor(deps({ getServiceStatus: async () => ({ state: 'failed', platform: 'darwin', managed: true, autostart: true, safeError: 'START_FAILED' }) }))
    expect(byId(failed, 'service-state')).toMatchObject({ severity: 'error', detail: { state: 'failed' } })

    const absent = await runDoctor(deps({ getServiceStatus: async () => ({ state: 'not-installed', platform: 'darwin', managed: true, autostart: false }) }))
    expect(byId(absent, 'service-state')).toMatchObject({ severity: 'warn', detail: { state: 'not-installed' } })
  })

  it('detects a real bound port as a conflict on loopback', async () => {
    const server: Server = createServer()
    await new Promise<void>(resolve => server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const report = await runDoctor(deps({ servicePorts: [port], isPortAvailable: defaultPortAvailable }))
      const conflict = byId(report, 'port-conflict')
      expect(conflict.severity).toBe('error')
      expect(conflict.messageKey).toBe('doctor.portConflict.detail')
      expect(conflict.detail?.ports).toBe(String(port))

      const free = await runDoctor(deps({ servicePorts: [port + 1], isPortAvailable: defaultPortAvailable }))
      expect(byId(free, 'port-conflict').severity).toBe('ok')
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      expect(await defaultPortAvailable(port)).toBe(true)
    }
  })

  it('warns on runtime mismatch and missing runtime, and on missing config dir/logs', async () => {
    const mismatch = await runDoctor(deps({ runtimeVersion: '0.11.0' }))
    expect(byId(mismatch, 'runtime-mismatch')).toMatchObject({
      severity: 'warn',
      messageKey: 'doctor.runtimeMismatch.detail',
      detail: { app: '0.11.8', runtime: '0.11.0' },
    })

    const missingRuntime = await runDoctor(deps({ runtimeVersion: null }))
    expect(byId(missingRuntime, 'runtime-mismatch').severity).toBe('warn')

    const noConfig = await runDoctor(deps({ pathExists: async path => path.endsWith('.log') }))
    expect(byId(noConfig, 'config-dir')).toMatchObject({ severity: 'warn', messageKey: 'doctor.configDir.detail' })
    expect(byId(noConfig, 'logs').severity).toBe('ok')

    const noLogs = await runDoctor(deps({ pathExists: async path => path === '/Users/x/rox' }))
    expect(byId(noLogs, 'logs')).toMatchObject({ severity: 'warn', messageKey: 'doctor.logs.detail', detail: { count: 0 } })
  })
})
/**
 * Pure service doctor — evaluates the host's service/port/runtime/config/log
 * state into a bounded report.
 *
 * Everything is injected (status probe, port probe, path stat, versions), so the
 * report builder has no ambient I/O and every check is directly testable. The
 * real `runDoctor` wiring supplies the default loopback port probe.
 */

import { createServer } from 'node:net'
import type { DoctorFinding, DoctorReport, ServiceStatus } from '@rox/shared/service-lifecycle'

export interface DoctorDependencies {
  readonly now?: () => number
  readonly getServiceStatus: () => Promise<ServiceStatus>
  /** Ports the installed service binds; only real bound ports can conflict. */
  readonly servicePorts: readonly number[]
  readonly isPortAvailable: (port: number) => Promise<boolean>
  readonly configDir: string
  readonly pathExists: (path: string) => Promise<boolean>
  readonly appVersion: string
  /** Managed toolchain/runtime version, or null when not provisioned. */
  readonly runtimeVersion: string | null
  readonly logPaths: readonly string[]
}

/** Loopback bind probe — a port is available when an exclusive listen succeeds. */
export async function defaultPortAvailable(port: number): Promise<boolean> {
  const server = createServer()
  const { promise, resolve } = Promise.withResolvers<boolean>()
  let settled = false
  const settle = (available: boolean): void => {
    if (settled) return
    settled = true
    resolve(available)
  }
  server.once('error', () => settle(false))
  server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
    server.close(() => settle(true))
  })
  return promise
}

function finding(checkId: DoctorFinding['checkId'], severity: DoctorFinding['severity'], messageKey: string, detail?: Record<string, string | number>): DoctorFinding {
  return { checkId, severity, messageKey, ...(detail === undefined ? {} : { detail }) }
}

export async function runDoctor(deps: DoctorDependencies): Promise<DoctorReport> {
  const now = deps.now ?? Date.now
  const checks: DoctorFinding[] = []

  const status = await deps.getServiceStatus()
  const stateSeverity: DoctorFinding['severity'] =
    status.state === 'running' ? 'ok'
      : status.state === 'failed' || status.state === 'degraded' ? 'error'
        : 'warn'
  checks.push(finding('service-state', stateSeverity, 'doctor.check.serviceState', {
    state: status.state,
    platform: status.platform,
  }))

  const conflicts: number[] = []
  for (const port of deps.servicePorts) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue
    if (!await deps.isPortAvailable(port)) conflicts.push(port)
  }
  checks.push(conflicts.length === 0
    ? finding('port-conflict', 'ok', 'doctor.check.portConflict', { count: deps.servicePorts.length })
    : finding('port-conflict', 'error', 'doctor.portConflict.detail', { count: conflicts.length, ports: conflicts.join(',') }))

  if (deps.runtimeVersion === null) {
    checks.push(finding('runtime-mismatch', 'warn', 'doctor.runtimeMismatch.detail', { app: deps.appVersion, runtime: 'none' }))
  } else if (deps.runtimeVersion !== deps.appVersion) {
    checks.push(finding('runtime-mismatch', 'warn', 'doctor.runtimeMismatch.detail', { app: deps.appVersion, runtime: deps.runtimeVersion }))
  } else {
    checks.push(finding('runtime-mismatch', 'ok', 'doctor.check.runtimeMismatch', { version: deps.appVersion }))
  }

  const configDirExists = await deps.pathExists(deps.configDir)
  checks.push(configDirExists
    ? finding('config-dir', 'ok', 'doctor.check.configDir', { path: deps.configDir })
    : finding('config-dir', 'warn', 'doctor.configDir.detail', { path: deps.configDir }))

  let existingLogs = 0
  for (const path of deps.logPaths) {
    if (await deps.pathExists(path)) existingLogs += 1
  }
  checks.push(existingLogs > 0
    ? finding('logs', 'ok', 'doctor.check.logs', { count: existingLogs })
    : finding('logs', 'warn', 'doctor.logs.detail', { count: 0 }))

  return { generatedAt: now(), checks }
}
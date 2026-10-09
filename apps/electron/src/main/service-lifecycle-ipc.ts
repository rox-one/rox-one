/**
 * serviceLifecycle.* + diagnostics.* IPC — host-local service control and the
 * doctor, registered on the embedded RPC server.
 *
 * All channels are classified LOCAL_ONLY (routing.ts), so the transport gate
 * admits them only for an Electron-main-bound client. Handlers return the frozen
 * safe projections; a status change is pushed to every client so the renderer
 * and tray stay in sync.
 */

import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import type { GatewayService } from '@rox/server-core/service'
import type { DoctorReport, ServiceLifecycleResult, ServiceStatus } from '@rox/shared/service-lifecycle'
import { RPC_CHANNELS } from '../shared/types'

export interface ServiceLifecycleIpcDependencies {
  readonly server: RpcServer
  readonly service: GatewayService
  /** Runs the host doctor; the last report is cached for `diagnostics:getLast`. */
  readonly runDoctor: () => Promise<DoctorReport>
}

const HANDLED_CHANNELS = [
  RPC_CHANNELS.serviceLifecycle.GET_STATUS,
  RPC_CHANNELS.serviceLifecycle.INSTALL,
  RPC_CHANNELS.serviceLifecycle.START,
  RPC_CHANNELS.serviceLifecycle.STOP,
  RPC_CHANNELS.serviceLifecycle.RESTART,
  RPC_CHANNELS.serviceLifecycle.UNINSTALL,
  RPC_CHANNELS.diagnostics.RUN,
  RPC_CHANNELS.diagnostics.GET_LAST,
] as const

/** Push a service status transition to every connected client. */
export function publishServiceStatus(server: RpcServer, status: ServiceStatus): void {
  pushTyped(server, RPC_CHANNELS.serviceLifecycle.STATUS_CHANGED, { to: 'all' }, status)
}

export function registerServiceLifecycleIpc(deps: ServiceLifecycleIpcDependencies): void {
  let lastDoctorReport: DoctorReport | null = null

  const mutate = async (operation: 'install' | 'start' | 'stop' | 'restart' | 'uninstall'): Promise<ServiceLifecycleResult> => {
    const before = await deps.service.getStatus()
    const result = await deps.service[operation]()
    // Publish on success, and on a state change even when the operation failed.
    if (result.ok || result.status.state !== before.state) publishServiceStatus(deps.server, result.status)
    return result
  }

  deps.server.handle(RPC_CHANNELS.serviceLifecycle.GET_STATUS, async (): Promise<ServiceStatus> => deps.service.getStatus())
  deps.server.handle(RPC_CHANNELS.serviceLifecycle.INSTALL, async (): Promise<ServiceLifecycleResult> => mutate('install'))
  deps.server.handle(RPC_CHANNELS.serviceLifecycle.START, async (): Promise<ServiceLifecycleResult> => mutate('start'))
  deps.server.handle(RPC_CHANNELS.serviceLifecycle.STOP, async (): Promise<ServiceLifecycleResult> => mutate('stop'))
  deps.server.handle(RPC_CHANNELS.serviceLifecycle.RESTART, async (): Promise<ServiceLifecycleResult> => mutate('restart'))
  deps.server.handle(RPC_CHANNELS.serviceLifecycle.UNINSTALL, async (): Promise<ServiceLifecycleResult> => mutate('uninstall'))

  deps.server.handle(RPC_CHANNELS.diagnostics.RUN, async (): Promise<DoctorReport> => {
    const report = await deps.runDoctor()
    lastDoctorReport = report
    return report
  })
  deps.server.handle(RPC_CHANNELS.diagnostics.GET_LAST, async (): Promise<DoctorReport | null> => lastDoctorReport)
}

export { HANDLED_CHANNELS as SERVICE_LIFECYCLE_HANDLED_CHANNELS }
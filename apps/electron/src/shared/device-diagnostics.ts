/** Native, read-only diagnostics. Never routed to a workspace server or WebUI. */
export const DEVICE_DIAGNOSTICS_CHANNELS = Object.freeze({
  READ: '__device-diagnostics:read',
  CANCEL: '__device-diagnostics:cancel',
})

export type DeviceDiagnosticKind = 'overview' | 'network' | 'processes' | 'launchAgents' | 'logs'
export type DeviceDiagnosticLogSource = 'main' | 'messaging' | 'updates'
export type DeviceDiagnosticReason = 'unsupported-platform' | 'permission-denied' | 'command-unavailable' | 'disabled' | 'no-data' | 'failed' | 'cancelled'
export type DiagnosticResult<T> = { status: 'available'; data: T } | { status: 'unavailable'; reason: DeviceDiagnosticReason }

export interface DeviceDiagnosticRequest {
  requestId: string
  kind: DeviceDiagnosticKind
  source?: DeviceDiagnosticLogSource
}

export interface DeviceOverview {
  cpuPercent: number | null
  cpuCount: number
  memoryTotalBytes: number
  memoryFreeBytes: number
  appMemoryBytes: number
  appUptimeSeconds: number
}

export interface DeviceNetworkInterface {
  name: string
  receivedBytes: number | null
  sentBytes: number | null
  internal: boolean
}

export interface DeviceProcess {
  pid: number
  name: string
  cpuPercent: number
  memoryBytes: number
}

export interface DeviceLaunchAgent {
  label: string
  pid: number | null
  lastExitStatus: number
}

export interface DeviceLogTail {
  lines: string[]
  truncated: boolean
}

export interface DeviceDiagnosticData {
  overview: DeviceOverview
  network: { interfaces: DeviceNetworkInterface[] }
  processes: { processes: DeviceProcess[] }
  launchAgents: { agents: DeviceLaunchAgent[] }
  logs: DeviceLogTail
}

export type DeviceDiagnosticSnapshot = {
  [K in DeviceDiagnosticKind]: {
    kind: K
    sampledAt: number
    platform: string
    result: DiagnosticResult<DeviceDiagnosticData[K]>
  }
}[DeviceDiagnosticKind]

export interface DeviceDiagnosticsApi {
  read(request: DeviceDiagnosticRequest): Promise<DeviceDiagnosticSnapshot>
  cancel(requestId: string): Promise<void>
}

declare global {
  interface Window {
    deviceDiagnostics?: DeviceDiagnosticsApi
  }
}

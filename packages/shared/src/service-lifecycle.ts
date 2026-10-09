/**
 * Service lifecycle — OS-level service control + host diagnostics types.
 * Shared between the Electron main process and renderer.
 */

export type ServicePlatform = 'darwin' | 'linux' | 'win32' | 'app-managed'

export type ServiceState =
  | 'unavailable'
  | 'not-installed'
  | 'installed'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'degraded'
  | 'failed'
  | 'unsupported'

export interface ServiceStatus {
  state: ServiceState
  platform: ServicePlatform
  managed: boolean
  autostart: boolean
  version?: string
  lastHealthAt?: number
  safeError?: string
}

export interface ServiceLifecycleResult {
  ok: boolean
  status: ServiceStatus
}

export type DoctorCheckId = 'service-state' | 'port-conflict' | 'runtime-mismatch' | 'config-dir' | 'logs'

export type DoctorSeverity = 'ok' | 'warn' | 'error'

export interface DoctorFinding {
  checkId: DoctorCheckId
  severity: DoctorSeverity
  messageKey: string
  detail?: Record<string, string | number>
}

export interface DoctorReport {
  generatedAt: number
  checks: readonly DoctorFinding[]
}

export interface TrayStatus {
  agentState: 'idle' | 'working' | 'error'
  serviceState: ServiceState
}
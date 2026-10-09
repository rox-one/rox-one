/**
 * Service lifecycle — shared contracts for the OS-level ROX service.
 *
 * The service abstraction installs/controls a host-managed process (launchd
 * LaunchAgent on macOS, Electron-owned child otherwise). Every public method
 * returns a safe projection: no host path, port, pid, or credential material
 * leaks out of these modules.
 */

import type { OpenClawRuntimeSafeErrorCode } from '@rox/shared/openclaw'
import type { ServiceLifecycleResult, ServiceStatus } from '@rox/shared/service-lifecycle'

/**
 * Error codes owned by the service layer. The shared OpenClaw runtime codes are
 * reused for the overlapping conditions (port conflict, start/stop failure,
 * path rejection) so the renderer keeps a single vocabulary.
 */
export type ServiceSafeErrorCode =
  | OpenClawRuntimeSafeErrorCode
  | 'INSTALL_FAILED'
  | 'UNINSTALL_FAILED'
  | 'NOT_INSTALLED'
  | 'UNSUPPORTED_PLATFORM'
  | 'MUTATION_REFUSED'
  | 'UNSIGNED_BUILD'
  | 'ALREADY_INSTALLED'
  | 'SYSTEM_DAEMON_CONFLICT'
  | 'INVALID_DEFINITION'

/** Controlled error used only inside server-core. `message` is always the safe code. */
export class ServiceOperationError extends Error {
  readonly code: ServiceSafeErrorCode
  readonly retryable: boolean

  constructor(code: ServiceSafeErrorCode, retryable = false) {
    super(code)
    this.name = 'ServiceOperationError'
    this.code = code
    this.retryable = retryable
  }
}

/**
 * Digest of a resolved, side-effect-free service definition. Builders are pure:
 * they never touch the filesystem, so a caller can inspect the exact bytes
 * before any transactional publish.
 */
export interface ServiceDefinitionDigest {
  readonly label: string
  readonly platform: 'darwin' | 'linux' | 'win32' | 'app-managed'
  /** Stable hash of the generated definition bytes (plist + env + wrapper). */
  readonly sha256: string
}

/**
 * One backend that can install/start/stop/restart/status/uninstall the ROX
 * service for a platform. Implementations: launchd (macOS) and app-managed
 * (Electron-owned child); unsupported platforms return a terminal status.
 */
export interface GatewayService {
  getStatus(): Promise<ServiceStatus>
  install(): Promise<ServiceLifecycleResult>
  start(): Promise<ServiceLifecycleResult>
  stop(): Promise<ServiceLifecycleResult>
  restart(): Promise<ServiceLifecycleResult>
  uninstall(): Promise<ServiceLifecycleResult>
}

export function result(ok: boolean, status: ServiceStatus): ServiceLifecycleResult {
  return { ok, status }
}

/** Rejects label values that could escape a launchd target or a plist path. */
export function assertServiceLabel(label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(label)) {
    throw new ServiceOperationError('INVALID_DEFINITION')
  }
}
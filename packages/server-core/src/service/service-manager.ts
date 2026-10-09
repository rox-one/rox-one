/**
 * Platform dispatch for the ROX service.
 *
 * macOS uses a launchd LaunchAgent (gui/<uid> domain) composed from the pure
 * builder + transactional install. Other platforms are genuinely unsupported
 * today and report `unsupported` rather than pretending. An Electron-owned
 * child (`app-managed`) can be selected when no launchd session is available
 * (SSH install, ad-hoc/unsigned dev build).
 */

import { relative, resolve } from 'node:path'
import type { ServiceLifecycleResult, ServicePlatform, ServiceStatus } from '@rox/shared/service-lifecycle'
import { AppManagedService, type AppManagedServiceDeps } from './app-managed.ts'
import { installServiceArtifacts, removeServiceArtifacts, type ServiceFilesystem } from './launchd-install.ts'
import type { LaunchAgentFiles } from './launchd-plist.ts'
import type { LaunchdRuntime } from './launchd-runtime.ts'
import { result, ServiceOperationError, type GatewayService } from './types.ts'

function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/')
}

export interface LaunchdServiceDeps {
  readonly files: LaunchAgentFiles
  readonly fs: ServiceFilesystem
  readonly runtime: LaunchdRuntime
  /** Host-owned 0700 directory that must contain the env file and wrapper. */
  readonly serviceDirectory: string
  /** Absolute `~/Library/LaunchAgents`; the plist must live inside it. */
  readonly launchAgentsDirectory: string
  readonly now?: () => number
}

/** macOS launchd backend: publish artifacts, then drive the gui/<uid> job. */
export class LaunchdService implements GatewayService {
  constructor(private readonly deps: LaunchdServiceDeps) {}

  private status(state: ServiceStatus['state'], autostart: boolean, extra?: { lastHealthAt?: number; safeError?: string }): ServiceStatus {
    return {
      state,
      platform: 'darwin',
      managed: true,
      autostart,
      ...(extra?.lastHealthAt === undefined ? {} : { lastHealthAt: extra.lastHealthAt }),
      ...(extra?.safeError === undefined ? {} : { safeError: extra.safeError }),
    }
  }

  private assertUserScope(): void {
    if (!isInside(this.deps.launchAgentsDirectory, this.deps.files.plistPath)) {
      throw new ServiceOperationError('SYSTEM_DAEMON_CONFLICT')
    }
  }

  async getStatus(): Promise<ServiceStatus> {
    const installed = await this.deps.fs.readFile(this.deps.files.plistPath) !== null
    if (!installed) return this.status('not-installed', false)
    const loaded = await this.deps.runtime.isLoaded()
    return this.status(loaded ? 'running' : 'installed', true, loaded ? { lastHealthAt: (this.deps.now ?? Date.now)() } : undefined)
  }

  async install(): Promise<ServiceLifecycleResult> {
    try {
      this.assertUserScope()
      await installServiceArtifacts({
        artifacts: [
          { path: this.deps.files.envFile.path, content: this.deps.files.envFile.content, mode: this.deps.files.envFile.mode },
          { path: this.deps.files.wrapper.path, content: this.deps.files.wrapper.content, mode: this.deps.files.wrapper.mode },
          { path: this.deps.files.plistPath, content: this.deps.files.plist, mode: 0o600 },
        ],
        directories: [this.deps.serviceDirectory, this.deps.launchAgentsDirectory],
        fs: this.deps.fs,
      })
      return result(true, this.status('installed', true))
    } catch (error) {
      const code = error instanceof ServiceOperationError ? error.code : 'INSTALL_FAILED'
      return result(false, this.status('failed', false, { safeError: code }))
    }
  }

  async start(): Promise<ServiceLifecycleResult> {
    try {
      if (await this.deps.fs.readFile(this.deps.files.plistPath) === null) {
        return result(false, this.status('not-installed', false, { safeError: 'NOT_INSTALLED' }))
      }
      if (await this.deps.runtime.isLoaded()) {
        await this.deps.runtime.kickstart()
      } else {
        await this.deps.runtime.bootstrap(this.deps.files.plistPath)
      }
      return result(true, this.status('running', true, { lastHealthAt: (this.deps.now ?? Date.now)() }))
    } catch (error) {
      const code = error instanceof ServiceOperationError ? error.code : 'START_FAILED'
      return result(false, this.status('failed', true, { safeError: code }))
    }
  }

  async stop(): Promise<ServiceLifecycleResult> {
    try {
      await this.deps.runtime.bootout()
      return result(true, this.status('stopped', true))
    } catch (error) {
      const code = error instanceof ServiceOperationError ? error.code : 'STOP_FAILED'
      return result(false, this.status('failed', true, { safeError: code }))
    }
  }

  async restart(): Promise<ServiceLifecycleResult> {
    await this.stop()
    return this.start()
  }

  async uninstall(): Promise<ServiceLifecycleResult> {
    try {
      await this.deps.runtime.bootout()
      await removeServiceArtifacts({
        paths: [this.deps.files.plistPath, this.deps.files.wrapper.path, this.deps.files.envFile.path],
        fs: this.deps.fs,
      })
      return result(true, this.status('not-installed', false))
    } catch (error) {
      const code = error instanceof ServiceOperationError ? error.code : 'UNINSTALL_FAILED'
      return result(false, this.status('failed', true, { safeError: code }))
    }
  }
}

/** Terminal backend for platforms without a supported service mechanism. */
export class UnsupportedService implements GatewayService {
  constructor(private readonly platform: ServicePlatform, private readonly version?: string) {}

  private status(): ServiceStatus {
    return {
      state: 'unsupported',
      platform: this.platform,
      managed: false,
      autostart: false,
      ...(this.version === undefined ? {} : { version: this.version }),
      safeError: 'UNSUPPORTED_PLATFORM',
    }
  }

  async getStatus(): Promise<ServiceStatus> {
    return this.status()
  }

  private async rejected(): Promise<ServiceLifecycleResult> {
    return result(false, this.status())
  }

  async install(): Promise<ServiceLifecycleResult> { return this.rejected() }
  async start(): Promise<ServiceLifecycleResult> { return this.rejected() }
  async stop(): Promise<ServiceLifecycleResult> { return this.rejected() }
  async restart(): Promise<ServiceLifecycleResult> { return this.rejected() }
  async uninstall(): Promise<ServiceLifecycleResult> { return this.rejected() }
}

export interface ServiceManagerDeps {
  /** darwin uses launchd; linux/win32 report unsupported unless appManaged is set. */
  readonly platform: ServicePlatform
  readonly launchd?: LaunchdServiceDeps
  readonly appManaged?: AppManagedServiceDeps
}

/**
 * Platform dispatch. `app-managed` is preferred only when explicitly requested
 * (no Aqua session); otherwise macOS gets launchd and other platforms report
 * unsupported rather than fabricating a service.
 */
export function createServiceManager(deps: ServiceManagerDeps): GatewayService {
  if (deps.platform === 'darwin' && deps.launchd) return new LaunchdService(deps.launchd)
  if (deps.appManaged) return new AppManagedService(deps.appManaged)
  return new UnsupportedService(deps.platform)
}

/**
 * Blocks `install` when the running build is not trusted (ad-hoc/unsigned local
 * dist): a service installed from such a build would be TCC/signature-coupled
 * and silently misbehave. Everything else delegates unchanged.
 */
export function guardServiceInstall(service: GatewayService, isBuildTrusted: () => boolean): GatewayService {
  return {
    getStatus: () => service.getStatus(),
    install: async () => {
      if (isBuildTrusted()) return service.install()
      const status = await service.getStatus()
      return result(false, { ...status, state: 'failed', safeError: 'UNSIGNED_BUILD' })
    },
    start: () => service.start(),
    stop: () => service.stop(),
    restart: () => service.restart(),
    uninstall: () => service.uninstall(),
  }
}
/**
 * App-managed backend — the Electron process owns the service child directly.
 *
 * This is the honest fallback when no Aqua/launchd GUI session is available
 * (SSH installs, ad-hoc dev builds): the app spawns and supervises one child,
 * and `shutdown()` stops only the child it started. It mirrors the ownership
 * discipline of the OpenClaw runtime manager.
 */

import type { ServiceLifecycleResult, ServiceStatus } from '@rox/shared/service-lifecycle'
import { result, type GatewayService } from './types.ts'

export interface ManagedServiceProcess {
  readonly pid?: number
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  once(event: 'error', listener: () => void): unknown
  kill(signal?: NodeJS.Signals | number): boolean
}

export interface AppManagedServiceDeps {
  /** Spawns exactly one owned child; the caller closes over the executable/args. */
  readonly spawn: () => ManagedServiceProcess
  readonly now?: () => number
}

export class AppManagedService implements GatewayService {
  private installed = false
  private child: ManagedServiceProcess | null = null
  private state: ServiceStatus['state'] = 'not-installed'
  private lastHealthAt: number | null = null

  constructor(private readonly deps: AppManagedServiceDeps) {}

  private status(safeError?: string): ServiceStatus {
    return {
      state: this.state,
      platform: 'app-managed',
      managed: true,
      autostart: this.installed,
      ...(this.lastHealthAt === null ? {} : { lastHealthAt: this.lastHealthAt }),
      ...(safeError === undefined ? {} : { safeError }),
    }
  }

  async getStatus(): Promise<ServiceStatus> {
    return this.status()
  }

  async install(): Promise<ServiceLifecycleResult> {
    this.installed = true
    this.state = 'installed'
    return result(true, this.status())
  }

  async start(): Promise<ServiceLifecycleResult> {
    if (!this.installed) return result(false, this.status('NOT_INSTALLED'))
    if (this.child) return result(true, this.status())
    try {
      const child = this.deps.spawn()
      this.child = child
      this.state = 'running'
      this.lastHealthAt = (this.deps.now ?? Date.now)()
      child.once('exit', () => {
        if (this.child !== child) return
        this.child = null
        this.state = 'stopped'
      })
      child.once('error', () => {
        if (this.child !== child) return
        this.child = null
        this.state = 'failed'
      })
      return result(true, this.status())
    } catch {
      this.state = 'failed'
      return result(false, this.status('START_FAILED'))
    }
  }

  async stop(): Promise<ServiceLifecycleResult> {
    const child = this.child
    if (!child) {
      this.state = this.installed ? 'stopped' : this.state
      return result(true, this.status())
    }
    this.child = null
    let killed = false
    try {
      killed = child.kill('SIGTERM')
    } catch {
      killed = false
    }
    this.state = killed || child.pid === undefined ? 'stopped' : 'failed'
    return result(this.state === 'stopped', this.status(this.state === 'stopped' ? undefined : 'STOP_FAILED'))
  }

  async restart(): Promise<ServiceLifecycleResult> {
    await this.stop()
    return this.start()
  }

  async uninstall(): Promise<ServiceLifecycleResult> {
    await this.stop()
    this.installed = false
    this.state = 'not-installed'
    return result(true, this.status())
  }

  /** Stops only the child this instance started. Safe to call on app quit. */
  async shutdown(): Promise<void> {
    if (this.child) await this.stop()
  }
}
/**
 * launchd runtime control — bootstrap/bootout/kickstart inside the per-user
 * `gui/<uid>` domain.
 *
 * Fences:
 *  - mutating verbs refuse to run from inside the managed service itself
 *    (`ROX_SERVICE_MANAGED=1`), so a supervised child can never re-enter its own
 *    supervisor or fight an operator's launchd session;
 *  - no command is ever built from renderer input: the label and the plist path
 *    come from the composed definition, and launchctl is invoked through an
 *    injected runner with a fixed argument vector.
 */

import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { assertServiceLabel, ServiceOperationError } from './types.ts'

export interface LaunchctlResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export interface LaunchctlRunner {
  run(args: readonly string[]): Promise<LaunchctlResult>
}

export interface LaunchdRuntimeOptions {
  readonly label: string
  readonly uid: number
  readonly runner: LaunchctlRunner
  /** Overridable for tests; defaults to the ROX managed-service env marker. */
  readonly isInsideService?: () => boolean
}

function defaultIsInsideService(): boolean {
  return process.env.ROX_SERVICE_MANAGED === '1'
}

/** Fixed-PATH launchctl runner. Never shell-interpolated; argv is passed verbatim. */
export function createLaunchctlRunner(): LaunchctlRunner {
  return {
    run: async args => {
      const { promise, resolve } = Promise.withResolvers<LaunchctlResult>()
      execFile('/bin/launchctl', [...args], {
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', LANG: 'C' },
      }, (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? String(stderr ?? '') })
      })
      return promise
    },
  }
}

export class LaunchdRuntime {
  private readonly label: string
  private readonly uid: number
  private readonly runner: LaunchctlRunner
  private readonly isInsideService: () => boolean

  constructor(options: LaunchdRuntimeOptions) {
    assertServiceLabel(options.label)
    if (!Number.isInteger(options.uid) || options.uid < 0) throw new ServiceOperationError('INVALID_DEFINITION')
    this.label = options.label
    this.uid = options.uid
    this.runner = options.runner
    this.isInsideService = options.isInsideService ?? defaultIsInsideService
  }

  /** e.g. `gui/501`. */
  get domain(): string {
    return `gui/${this.uid}`
  }

  /** e.g. `gui/501/com.rox.service`. */
  get serviceTarget(): string {
    return `${this.domain}/${this.label}`
  }

  private assertMutable(): void {
    if (this.isInsideService()) throw new ServiceOperationError('MUTATION_REFUSED')
  }

  private async run(args: readonly string[]): Promise<LaunchctlResult> {
    try {
      return await this.runner.run(args)
    } catch {
      throw new ServiceOperationError('START_FAILED', true)
    }
  }

  /** `launchctl bootstrap gui/<uid> <plist>` — load and start the agent. */
  async bootstrap(plistPath: string): Promise<void> {
    this.assertMutable()
    if (!isAbsolute(plistPath) || plistPath.includes('\u0000')) throw new ServiceOperationError('PATH_REJECTED')
    const result = await this.run(['bootstrap', this.domain, plistPath])
    if (result.code !== 0) throw new ServiceOperationError('START_FAILED')
  }

  /** `launchctl bootout gui/<uid>/<label>` — stop and unload the agent. */
  async bootout(): Promise<void> {
    this.assertMutable()
    const result = await this.run(['bootout', this.serviceTarget])
    // 3 = no such process: already unloaded, which is the desired end state.
    if (result.code !== 0 && result.code !== 3) throw new ServiceOperationError('STOP_FAILED')
  }

  /** `launchctl kickstart -k gui/<uid>/<label>` — restart the live agent. */
  async kickstart(): Promise<void> {
    this.assertMutable()
    const result = await this.run(['kickstart', '-k', this.serviceTarget])
    if (result.code !== 0) throw new ServiceOperationError('START_FAILED')
  }

  /** `launchctl print gui/<uid>/<label>` — true when launchd has the job loaded. */
  async isLoaded(): Promise<boolean> {
    try {
      const result = await this.runner.run(['print', this.serviceTarget])
      return result.code === 0
    } catch {
      return false
    }
  }
}
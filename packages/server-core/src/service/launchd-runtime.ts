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
  /** Overridable for tests; defaults to `Date.now`. */
  readonly now?: () => number
  /** Overridable for tests; defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>
}

/**
 * launchd applies a mutating verb asynchronously: an immediate `launchctl print`
 * after `bootout` can transiently still report the job as loaded (and after
 * `bootstrap`, transiently still not-loaded). We therefore bound how long a
 * post-mutation status read will re-poll for the expected state before trusting
 * the last real print. Total budget is ~1s; polling never runs unbounded.
 */
const SETTLE_BUDGET_MS = 1_000
const SETTLE_INTERVAL_MS = 25

function defaultIsInsideService(): boolean {
  return process.env.ROX_SERVICE_MANAGED === '1'
}

function defaultSleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
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
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  /**
   * Set by a successful mutating verb; consumed by the next status read. While
   * a settle window is open, `print` is polled (bounded) until it reports the
   * expected loaded/not-loaded state, so a stale first print cannot be
   * misreported as the settled state.
   */
  private pending: { readonly expected: boolean; readonly deadline: number } | null = null

  constructor(options: LaunchdRuntimeOptions) {
    assertServiceLabel(options.label)
    if (!Number.isInteger(options.uid) || options.uid < 0) throw new ServiceOperationError('INVALID_DEFINITION')
    this.label = options.label
    this.uid = options.uid
    this.runner = options.runner
    this.isInsideService = options.isInsideService ?? defaultIsInsideService
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
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

  /** Opens the settle window a status read must observe before trusting `print`. */
  private noteMutation(expected: boolean): void {
    this.pending = { expected, deadline: this.now() + SETTLE_BUDGET_MS }
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
    this.noteMutation(true)
  }

  /** `launchctl bootout gui/<uid>/<label>` — stop and unload the agent. */
  async bootout(): Promise<void> {
    this.assertMutable()
    const result = await this.run(['bootout', this.serviceTarget])
    // 3 = no such process: already unloaded, which is the desired end state.
    if (result.code !== 0 && result.code !== 3) throw new ServiceOperationError('STOP_FAILED')
    this.noteMutation(false)
  }

  /** `launchctl kickstart -k gui/<uid>/<label>` — restart the live agent. */
  async kickstart(): Promise<void> {
    this.assertMutable()
    const result = await this.run(['kickstart', '-k', this.serviceTarget])
    if (result.code !== 0) throw new ServiceOperationError('START_FAILED')
    this.noteMutation(true)
  }

  /**
   * `launchctl print gui/<uid>/<label>` — true when launchd has the job loaded.
   *
   * Right after this process performed a mutation the first print may be stale,
   * so a settle window is honoured: the read re-polls (bounded to
   * {@link SETTLE_BUDGET_MS}) until `print` reports the state the mutation
   * targets, or the budget elapses. A job this process just booted out is never
   * reported loaded on the strength of a single stale print. With no open
   * window a single `print` is authoritative.
   */
  async isLoaded(): Promise<boolean> {
    const pending = this.pending
    this.pending = null
    if (!pending) return this.printLoaded()
    let observed = await this.printLoaded()
    while (observed !== pending.expected && this.now() < pending.deadline) {
      await this.sleep(SETTLE_INTERVAL_MS)
      observed = await this.printLoaded()
    }
    return observed
  }

  private async printLoaded(): Promise<boolean> {
    try {
      const result = await this.runner.run(['print', this.serviceTarget])
      return result.code === 0
    } catch {
      return false
    }
  }
}
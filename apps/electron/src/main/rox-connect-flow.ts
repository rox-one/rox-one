import type { RoxDevicePollApproved, RoxDeviceStartResult } from '@rox/shared/auth/rox-cloud'

export interface RoxConnectFlowDependencies {
  start(signal: AbortSignal): Promise<RoxDeviceStartResult>
  wait(deviceCode: string, options: { timeoutMs: number; interval: number; signal: AbortSignal }): Promise<RoxDevicePollApproved>
  save(approved: RoxDevicePollApproved): Promise<void>
  clear(): Promise<void>
  failed(message: string): void
}

/** One approval attempt owns its result; logout waits for any credential write. */
export class RoxConnectFlow {
  #generation = 0
  #abort: AbortController | null = null
  #error: string | null = null
  #expiresAt: number | null = null
  #credentialWrites: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: RoxConnectFlowDependencies) {}

  get state(): { connectError: string | null; connectExpiresAt: number | null } {
    return { connectError: this.#error, connectExpiresAt: this.#expiresAt }
  }

  #serialize(operation: () => Promise<void>): Promise<void> {
    const write = this.#credentialWrites.then(operation)
    this.#credentialWrites = write.catch(() => {})
    return write
  }

  async clear(): Promise<void> {
    ++this.#generation
    this.#abort?.abort()
    this.#abort = null
    this.#error = null
    this.#expiresAt = null
    await this.#serialize(() => this.dependencies.clear())
  }

  async start(): Promise<RoxDeviceStartResult> {
    const generation = ++this.#generation
    this.#abort?.abort()
    const abort = new AbortController()
    this.#abort = abort
    this.#error = null
    this.#expiresAt = null
    const current = () => this.#generation === generation && !abort.signal.aborted
    let started: RoxDeviceStartResult
    try {
      started = await this.dependencies.start(abort.signal)
      if (!current()) throw new Error('ROX_CONNECT_CANCELLED')
    } catch (error) {
      if (current()) this.#error = error instanceof Error ? error.message : 'ROX_CONNECT_FAILED'
      throw error
    }
    const timeoutMs = started.expiresIn * 1000
    this.#expiresAt = Date.now() + timeoutMs
    void this.dependencies.wait(started.deviceCode, { timeoutMs, interval: started.interval, signal: abort.signal })
      .then(approved => this.#serialize(async () => {
        if (!current()) return
        await this.dependencies.save(approved)
        // Logout/restart can happen while the secure credential backend awaits
        // OS storage. Clear that stale result before any newer write can run.
        if (!current()) await this.dependencies.clear()
      }))
      .then(() => { if (current()) { this.#error = null; this.#expiresAt = null } })
      .catch(error => {
        if (!current()) return
        const message = error instanceof Error ? error.message : 'ROX_CONNECT_FAILED'
        this.#error = message
        this.dependencies.failed(message)
      })
    return started
  }
}

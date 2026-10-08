/**
 * W1-03 (#1500) — Workspace command client + outbox drainer.
 *
 * `WorkspaceCommandHttpClient` POSTs one envelope to
 * `POST {baseUrl}/v1/workspaces/{ws}/commands` with the session bearer token
 * and returns the service's receipt. Network failures, 5xx, 408/429 and auth
 * failures are *transport* errors (retry later); any other answer carrying a
 * receipt is terminal.
 *
 * `WorkspaceCommandSync` implements the router's `WorkspaceCommandSink`:
 * enqueue → `queued` receipt → drain (FIFO, single-flight, exponential
 * backoff on transport errors, stops at the first failure to keep order).
 * A 401 pauses the workspace in `auth_required` until the credential the
 * failed request used changes (or `credentialsChanged`), with a slow probe
 * (one attempt per `authProbeIntervalMs`) in case the 401 was transient. A
 * head command that keeps failing retryably is reported as `stuck` after
 * `stuckAfterAttempts` and stays in place. `start()` also drains workspaces
 * that only exist in the persisted outbox (`outbox.workspaceIds()`).
 */

import { createHash } from 'node:crypto'
import { queuedReceipt, rejectedReceipt, type CommandEnvelope, type CommandReceipt } from '@rox/core/commands'
import { decodeCommandReceipt } from '@rox/shared/commands/schemas'
import type { WorkspaceCommandSink } from '../commands/router'
import type { CommandOutbox } from './outbox'

export class WorkspaceTransportError extends Error {
  readonly status?: number
  /** Fingerprint of the credential the failed request actually used (never the secret). */
  readonly credentialFingerprint?: string | null
  constructor(message: string, status?: number, credentialFingerprint?: string | null) {
    super(message)
    this.name = 'WorkspaceTransportError'
    if (status !== undefined) this.status = status
    if (credentialFingerprint !== undefined) this.credentialFingerprint = credentialFingerprint
  }
}

/** Opaque, non-reversible token fingerprint (sha256 prefix). */
export function fingerprintCredential(token: string | null | undefined): string | null {
  return token ? createHash('sha256').update(token).digest('hex').slice(0, 32) : null
}

export interface WorkspaceCommandTransport {
  /** Terminal receipt, or throws `WorkspaceTransportError` (retryable). */
  send(workspaceId: string, envelope: CommandEnvelope): Promise<CommandReceipt>
  /**
   * Opaque fingerprint of the credential `send` would use now (never the
   * secret itself). After a 401 the sync stays paused until it changes.
   */
  credentialFingerprint?(workspaceId: string): Promise<string | null> | string | null
}

export interface WorkspaceCommandHttpClientOptions {
  baseUrl: string
  /** Current bearer token for the workspace session (refreshed by the host). */
  token: () => string | Promise<string>
  fetch?: typeof fetch
  timeoutMs?: number
}

export class WorkspaceCommandHttpClient implements WorkspaceCommandTransport {
  private readonly options: WorkspaceCommandHttpClientOptions

  constructor(options: WorkspaceCommandHttpClientOptions) {
    const url = new URL(options.baseUrl)
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) {
      throw new Error('Workspace command transport requires https for non-loopback hosts')
    }
    this.options = options
  }

  async credentialFingerprint(): Promise<string | null> {
    try {
      return fingerprintCredential(await this.options.token())
    } catch {
      return null
    }
  }

  async send(workspaceId: string, envelope: CommandEnvelope): Promise<CommandReceipt> {
    const fetchImpl = this.options.fetch ?? fetch
    const url = new URL(`/v1/workspaces/${encodeURIComponent(workspaceId)}/commands`, this.options.baseUrl)
    let response: Response
    let used: string | null = null
    try {
      const token = await this.options.token()
      used = fingerprintCredential(token)
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      })
    } catch (error) {
      throw new WorkspaceTransportError(`Workspace unreachable: ${(error as Error)?.message ?? String(error)}`)
    }
    if (response.status >= 500 || response.status === 408 || response.status === 429 || response.status === 401) {
      await response.body?.cancel().catch(() => {})
      throw new WorkspaceTransportError(`Workspace answered ${response.status}`, response.status, used)
    }
    let body: unknown
    try { body = await response.json() } catch { body = undefined }
    const receipt = body && typeof body === 'object' && 'receipt' in body ? (body as { receipt: unknown }).receipt : body
    const decoded = decodeCommandReceipt(receipt)
    if (decoded.ok && decoded.value.commandId === envelope.commandId) return decoded.value
    // Terminal HTTP-level refusals: retrying the same bytes can never succeed.
    if (response.status === 404) {
      return rejectedReceipt(envelope.commandId, 'SERVER_REQUIRED', 'Workspace service has no command endpoint')
    }
    if (response.status === 403) return rejectedReceipt(envelope.commandId, 'FORBIDDEN', 'Workspace denied the command')
    if (response.status === 413) return rejectedReceipt(envelope.commandId, 'PAYLOAD_TOO_LARGE', 'Workspace refused the request size')
    if (response.status >= 400 && response.status < 500) {
      return rejectedReceipt(envelope.commandId, 'VALIDATION', `Workspace refused the request (${response.status})`)
    }
    throw new WorkspaceTransportError(`Workspace answered ${response.status} without a receipt`, response.status)
  }
}

export interface WorkspaceCommandSyncOptions {
  outbox: CommandOutbox
  transport: WorkspaceCommandTransport
  /** Terminal receipts of queued commands (pushed to the renderer). */
  onReceipt?: (workspaceId: string, receipt: CommandReceipt) => void
  onStatus?: (workspaceId: string, status: WorkspaceSyncStatus) => void
  /** Backoff: base * 2^(attempts-1), capped. */
  backoffBaseMs?: number
  backoffMaxMs?: number
  /** Report `stuck` once the head command failed this many times in a row (default 50). */
  stuckAfterAttempts?: number
  /** While `auth_required` with an unchanged credential, probe once per this interval (default backoffMaxMs). */
  authProbeIntervalMs?: number
  batchSize?: number
  /** Drain automatically after enqueue (default true). */
  autoDrain?: boolean
  now?: () => number
}

export interface WorkspaceSyncStatus {
  pending: number
  /**
   * `auth_required`: paused after a 401 until the credential changes (plus a
   * slow probe). `stuck`: the head command failed retryably `stuckAfterAttempts`
   * times in a row; it stays in place (order is preserved) and keeps retrying.
   */
  state: 'idle' | 'retrying' | 'auth_required' | 'stuck'
  lastError?: string
  /** Head command of a `stuck` workspace and its attempt count. */
  stuckCommandId?: string
  attempts?: number
}

export interface DrainResult {
  sent: number
  failed: number
  remaining: number
  /** The drain did not send because the workspace waits for new credentials. */
  authRequired?: boolean
}

export class WorkspaceCommandSync implements WorkspaceCommandSink {
  private readonly options: WorkspaceCommandSyncOptions
  private readonly draining = new Map<string, Promise<DrainResult>>()
  private readonly again = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly known = new Set<string>()
  /** Workspaces paused after a 401 → rejected credential fingerprint + next slow probe. */
  private readonly authPaused = new Map<string, { rejected: string | null; nextProbeAt: number }>()

  constructor(options: WorkspaceCommandSyncOptions) {
    this.options = options
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  async enqueue(workspaceId: string, envelope: CommandEnvelope): Promise<CommandReceipt> {
    const entry = await this.options.outbox.enqueue(workspaceId, envelope, new Date(this.now()).toISOString())
    this.known.add(workspaceId)
    if (this.options.autoDrain !== false) void this.drain(workspaceId).catch(() => {})
    return queuedReceipt(envelope.commandId, entry.enqueuedAt)
  }

  /**
   * Send pending commands in FIFO order until the outbox is empty or the
   * transport fails. Concurrent callers share one drain per workspace; a
   * request arriving mid-drain schedules one more pass.
   */
  drain(workspaceId: string, options: { force?: boolean } = {}): Promise<DrainResult> {
    const running = this.draining.get(workspaceId)
    if (running) {
      this.again.add(workspaceId)
      return running
    }
    const run = (async () => {
      const total: DrainResult = { sent: 0, failed: 0, remaining: 0 }
      do {
        this.again.delete(workspaceId)
        const pass = await this.drainPass(workspaceId, options.force === true)
        total.sent += pass.sent
        total.failed += pass.failed
        total.remaining = pass.remaining
        if (pass.authRequired) total.authRequired = true
        if (pass.failed > 0 || pass.authRequired) break
      } while (this.again.has(workspaceId))
      return total
    })().finally(() => this.draining.delete(workspaceId))
    this.draining.set(workspaceId, run)
    return run
  }

  /** Workspace waiting for a new credential after a 401. */
  isAuthRequired(workspaceId: string): boolean {
    return this.authPaused.has(workspaceId)
  }

  /** The host refreshed the session: resume paused workspaces (all, or one). */
  credentialsChanged(workspaceId?: string): void {
    const ids = workspaceId ? [workspaceId] : [...this.authPaused.keys()]
    for (const id of ids) {
      if (!this.authPaused.delete(id)) continue
      void this.drain(id).catch(() => {})
    }
  }

  private async fingerprint(workspaceId: string): Promise<string | null> {
    try { return (await this.options.transport.credentialFingerprint?.(workspaceId)) ?? null } catch { return null }
  }

  private async drainPass(workspaceId: string, force: boolean): Promise<DrainResult> {
    const { outbox, transport } = this.options
    const batchSize = this.options.batchSize ?? 100
    let sent = 0
    const paused = this.authPaused.get(workspaceId)
    if (paused) {
      const current = await this.fingerprint(workspaceId)
      const changed = current !== null && current !== paused.rejected
      // Slow probe: a 401 may have been a server-side blip or a race with a refresh.
      const probe = this.now() >= paused.nextProbeAt
      if (!changed && !probe) {
        const remaining = await outbox.count(workspaceId)
        this.options.onStatus?.(workspaceId, { pending: remaining, state: 'auth_required', lastError: 'Workspace answered 401' })
        return { sent: 0, failed: 0, remaining, authRequired: true }
      }
      this.authPaused.delete(workspaceId)
    }
    for (;;) {
      const batch = await outbox.pending(workspaceId, batchSize)
      if (batch.length === 0) break
      for (const entry of batch) {
        if (!force && entry.nextAttemptAt > this.now()) {
          return { sent, failed: 0, remaining: await outbox.count(workspaceId) }
        }
        let receipt: CommandReceipt
        try {
          receipt = await transport.send(workspaceId, entry.envelope)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (error instanceof WorkspaceTransportError && error.status === 401) {
            // Credential problem, not an outage: wait for a new token (plus a slow probe).
            // The rejected credential is the one the request used, not whatever the host
            // refreshed to while it was in flight.
            const rejected = error.credentialFingerprint !== undefined ? error.credentialFingerprint : await this.fingerprint(workspaceId)
            const probeInterval = this.options.authProbeIntervalMs ?? this.options.backoffMaxMs ?? 60_000
            this.authPaused.set(workspaceId, { rejected, nextProbeAt: this.now() + probeInterval })
            await outbox.fail(workspaceId, entry.commandId, message, this.now())
            const remaining = await outbox.count(workspaceId)
            this.options.onStatus?.(workspaceId, { pending: remaining, state: 'auth_required', lastError: message })
            return { sent, failed: 1, remaining, authRequired: true }
          }
          const attempts = entry.attempts + 1
          const delay = Math.min((this.options.backoffBaseMs ?? 1_000) * 2 ** (attempts - 1), this.options.backoffMaxMs ?? 60_000)
          await outbox.fail(workspaceId, entry.commandId, message, this.now() + delay)
          const remaining = await outbox.count(workspaceId)
          const stuckAfter = this.options.stuckAfterAttempts ?? 50
          if (attempts >= stuckAfter) {
            // Defence in depth: surface it, but keep it at the head (FIFO order is the contract).
            this.options.onStatus?.(workspaceId, { pending: remaining, state: 'stuck', lastError: message, stuckCommandId: entry.commandId, attempts })
          } else {
            this.options.onStatus?.(workspaceId, { pending: remaining, state: 'retrying', lastError: message })
          }
          return { sent, failed: 1, remaining }
        }
        await outbox.complete(workspaceId, entry.commandId, receipt)
        sent += 1
        this.options.onReceipt?.(workspaceId, receipt)
      }
    }
    const remaining = await outbox.count(workspaceId)
    this.options.onStatus?.(workspaceId, { pending: remaining, state: 'idle' })
    return { sent, failed: 0, remaining }
  }

  /**
   * Periodic retry of every workspace with pending commands: seen by this
   * instance, passed in `workspaceIds`, or persisted in the outbox by an
   * earlier process (`outbox.workspaceIds()`, drained right away).
   * Resolves once the persisted workspaces are known.
   */
  start(intervalMs = 5_000, workspaceIds: readonly string[] = []): Promise<void> {
    for (const id of workspaceIds) this.known.add(id)
    const seeded = this.options.outbox.workspaceIds()
      .then(ids => {
        for (const id of ids) {
          if (this.known.has(id)) continue
          this.known.add(id)
          void this.drain(id).catch(() => {})
        }
      })
      .catch(() => { /* the periodic pass still covers known workspaces */ })
    if (this.timer) return seeded
    this.timer = setInterval(() => {
      for (const id of this.known) void this.drain(id).catch(() => {})
    }, intervalMs)
    ;(this.timer as { unref?: () => void }).unref?.()
    return seeded
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

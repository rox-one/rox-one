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
 * A 401 does not back off on a timer: the workspace pauses in the
 * `auth_required` state until the transport's credential changes (or the
 * host calls `credentialsChanged`). `start()` also drains workspaces that
 * only exist in the persisted outbox (`outbox.workspaceIds()`).
 */

import { createHash } from 'node:crypto'
import { queuedReceipt, rejectedReceipt, type CommandEnvelope, type CommandReceipt } from '@rox/core/commands'
import { decodeCommandReceipt } from '@rox/shared/commands/schemas'
import type { WorkspaceCommandSink } from '../commands/router'
import type { CommandOutbox } from './outbox'

export class WorkspaceTransportError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'WorkspaceTransportError'
    if (status !== undefined) this.status = status
  }
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
      const token = await this.options.token()
      return token ? createHash('sha256').update(token).digest('hex').slice(0, 32) : null
    } catch {
      return null
    }
  }

  async send(workspaceId: string, envelope: CommandEnvelope): Promise<CommandReceipt> {
    const fetchImpl = this.options.fetch ?? fetch
    const url = new URL(`/v1/workspaces/${encodeURIComponent(workspaceId)}/commands`, this.options.baseUrl)
    let response: Response
    try {
      const token = await this.options.token()
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
      throw new WorkspaceTransportError(`Workspace answered ${response.status}`, response.status)
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
  batchSize?: number
  /** Drain automatically after enqueue (default true). */
  autoDrain?: boolean
  now?: () => number
}

export interface WorkspaceSyncStatus {
  pending: number
  /** `auth_required`: paused after a 401 until the credential changes. */
  state: 'idle' | 'retrying' | 'auth_required'
  lastError?: string
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
  /** Workspaces paused after a 401 → fingerprint of the rejected credential. */
  private readonly authPaused = new Map<string, string | null>()

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
    if (this.authPaused.has(workspaceId)) {
      const rejected = this.authPaused.get(workspaceId) ?? null
      const current = await this.fingerprint(workspaceId)
      if (current === null || current === rejected) {
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
            // Credential problem, not an outage: no timer, wait for a new token.
            const rejected = await this.fingerprint(workspaceId)
            this.authPaused.set(workspaceId, rejected)
            await outbox.fail(workspaceId, entry.commandId, message, this.now())
            const remaining = await outbox.count(workspaceId)
            this.options.onStatus?.(workspaceId, { pending: remaining, state: 'auth_required', lastError: message })
            return { sent, failed: 1, remaining, authRequired: true }
          }
          const attempts = entry.attempts + 1
          const delay = Math.min((this.options.backoffBaseMs ?? 1_000) * 2 ** (attempts - 1), this.options.backoffMaxMs ?? 60_000)
          await outbox.fail(workspaceId, entry.commandId, message, this.now() + delay)
          const remaining = await outbox.count(workspaceId)
          this.options.onStatus?.(workspaceId, { pending: remaining, state: 'retrying', lastError: message })
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

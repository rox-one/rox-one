/**
 * W1-03 (#1500) — Realtime gateway (TECH-SPEC §5).
 *
 * Clients subscribe to topics over the authenticated workspace WS
 * (`realtime:subscribe`). Every subscribe is ACL-checked per topic, and every
 * delivery is re-checked: the transport revalidates the live session and the
 * authorizer re-reads the topic ACL before a frame leaves the server, so a
 * revoked session or lost permission stops the stream immediately.
 *
 * Frames come from the in-process event bus (projections of committed
 * `domain_event` rows), carry a per-topic `seq` + epoch, and are delivered in
 * order per client. Resubscribing with `sinceSeq` replays the gap from the
 * bus window or answers `snapshot_required`.
 *
 * Subscriptions belong to a live connection: a subscribe whose client went
 * away while its ACL / cursor reads were pending inserts nothing, and one
 * client holds at most `maxTopicsPerClient` topics (`limit_exceeded`).
 *
 * Revalidation cache: per client the transport's session revalidation and
 * per (client, topic) the ACL check are reused for `revalidationCacheMs`
 * (default 5 s) on hot topics. A revoked session or lost permission therefore
 * stops the stream within that window; `0` re-checks on every delivery.
 */

import {
  MAX_TOPICS_PER_CLIENT,
  REALTIME_RPC,
  parseTopic,
  topicAclTarget,
  type RealtimeEventFrame,
  type RealtimeSubscribeResult,
  type RealtimeSubscribeTopicResult,
} from '../../../../../packages/core/src/events/index.ts'
import { decodeRealtimeSubscribeRequest, decodeRealtimeUnsubscribeRequest } from '../../../../../packages/shared/src/commands/schemas.ts'
import type { InProcessEventBus } from '../../../../../packages/server-core/src/commands/event-bus.ts'
import { IdentityDomainError } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { TopicAuthorizer } from '../commands/authorizer.ts'
import type { RealtimeCursorOwner, RealtimeCursorStore } from './cursor-store.ts'

export const DEFAULT_REVALIDATION_CACHE_MS = 5_000

/** Transport surface the gateway needs (`WsRpcServer` satisfies it). */
export interface RealtimePushTransport {
  pushToWorkspaceClient(
    clientId: string,
    workspaceId: string,
    channel: string,
    args: readonly unknown[],
    guard?: (actor: { principalId: string }) => boolean | Promise<boolean>,
    options?: { reuseVerifiedSessionMs?: number },
  ): Promise<boolean>
  onClientDisconnect(listener: (clientId: string) => void): () => void
}

export interface RealtimeClientContext {
  clientId: string
  workspaceId: string
  principalId: string
  /** Device (else session) of the connection; keys the resume cursor. */
  deviceKey?: string
  /** Whether the request's connection is still the live one (transport check). */
  isCurrent?: () => boolean
}

/** Last delivered position per topic; `epoch` is the log epoch that `lastSeq` belongs to. */
interface TopicState {
  lastSeq: number
  epoch: string
  aclCheckedAt?: number
}

interface Subscription {
  workspaceId: string
  principalId: string
  deviceKey: string | undefined
  /** The client asked for server-side resume (`resume: true`): only then are cursors persisted. */
  resume: boolean
  topics: Map<string, TopicState>
  /** Per-client delivery chain: frames leave in seq order. */
  chain: Promise<void>
}

export interface RealtimeGatewayOptions {
  bus: InProcessEventBus
  transport: RealtimePushTransport
  authorizer: TopicAuthorizer
  cursors?: RealtimeCursorStore
  /** Current policy epoch for cursors (DATA-MODEL `policy_epoch`). */
  policyEpoch?: number
  /** Topics one client may hold across subscribe calls (default MAX_TOPICS_PER_CLIENT). */
  maxTopicsPerClient?: number
  /** Reuse session revalidation / topic ACL results this long during fan-out (default 5 s; 0 = never). */
  revalidationCacheMs?: number
  now?: () => number
  onError?: (error: unknown) => void
  /**
   * Whether an authorizer failure is a transient infrastructure error (the
   * store's classifier). Such a subscribe answers `unavailable` (retry), not
   * `forbidden`. Without it every authorizer throw is a denial.
   */
  isTransientError?: (error: unknown) => boolean
}

export class RealtimeGateway {
  private readonly clients = new Map<string, Subscription>()
  private readonly disposers: Array<() => void> = []
  private readonly cacheMs: number
  private readonly maxTopics: number

  constructor(private readonly options: RealtimeGatewayOptions) {
    this.cacheMs = Math.max(0, options.revalidationCacheMs ?? DEFAULT_REVALIDATION_CACHE_MS)
    this.maxTopics = Math.max(1, options.maxTopicsPerClient ?? MAX_TOPICS_PER_CLIENT)
    this.disposers.push(options.bus.subscribe((workspaceId, frame) => this.fanOut(workspaceId, frame)))
    this.disposers.push(options.transport.onClientDisconnect(clientId => { void this.drop(clientId) }))
  }

  close(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
    this.clients.clear()
  }

  subscriberCount(topic?: string): number {
    let count = 0
    for (const sub of this.clients.values()) if (!topic || sub.topics.has(topic)) count += 1
    return count
  }

  async subscribe(ctx: RealtimeClientContext, input: unknown): Promise<RealtimeSubscribeResult> {
    const decoded = decodeRealtimeSubscribeRequest(input)
    if (!decoded.ok) throw new IdentityDomainError('INVALID_PAYLOAD')
    const request = decoded.value
    const principal = { principalId: ctx.principalId, workspaceId: ctx.workspaceId }
    const results: RealtimeSubscribeTopicResult[] = []
    for (const item of request.topics) {
      const epoch = this.options.bus.epochOf(ctx.workspaceId)
      const parsed = parseTopic(item.topic)
      if (!parsed) { results.push({ topic: item.topic, status: 'invalid', seq: 0, epoch }); continue }
      const topic = item.topic
      let allowed = false
      try {
        allowed = (await this.options.authorizer.canReadTopic(principal, topicAclTarget(parsed))) === true
      } catch (error) {
        if (this.isTransient(error)) {
          this.options.onError?.(error)
          results.push({ topic, status: 'unavailable', seq: 0, epoch })
          continue
        }
        allowed = false
      }
      if (!allowed) { results.push({ topic, status: 'forbidden', seq: 0, epoch }); continue }

      let since = item.sinceSeq
      let sinceEpoch = item.epoch
      const owner = cursorOwner(ctx)
      if (since === undefined && request.resume && this.options.cursors && owner) {
        const cursor = await this.options.cursors.load(owner, topic, this.options.policyEpoch ?? 1)
        if (cursor) { since = cursor.seq; sinceEpoch = cursor.epoch }
      }
      // Never attach to a connection that closed while the reads above were pending
      // (its disconnect hook already ran); no await between this check and the insert.
      if (ctx.isCurrent && !ctx.isCurrent()) throw new IdentityDomainError('UNAUTHENTICATED')
      const sub = this.subscriptionFor(ctx)
      if (request.resume === true) sub.resume = true
      if (!sub.topics.has(topic) && sub.topics.size >= this.maxTopics) {
        results.push({ topic, status: 'limit_exceeded', seq: 0, epoch })
        continue
      }
      if (since === undefined) {
        const seq = this.options.bus.latest(ctx.workspaceId, topic)
        const current = this.options.bus.epochOf(ctx.workspaceId)
        sub.topics.set(topic, { lastSeq: seq, epoch: current })
        results.push({ topic, status: 'subscribed', seq, epoch: current })
        continue
      }
      const replay = this.options.bus.replay(ctx.workspaceId, topic, since, sinceEpoch)
      sub.topics.set(topic, { lastSeq: replay.latestSeq, epoch: replay.epoch })
      if (replay.kind === 'snapshot_required') {
        results.push({ topic, status: 'snapshot_required', seq: replay.latestSeq, epoch: replay.epoch })
      } else if (replay.kind === 'events') {
        results.push({ topic, status: 'subscribed', seq: replay.latestSeq, epoch: replay.epoch, frames: replay.frames })
      } else {
        results.push({ topic, status: 'subscribed', seq: replay.latestSeq, epoch: replay.epoch })
      }
    }
    return { topics: results }
  }

  async unsubscribe(ctx: RealtimeClientContext, input: unknown): Promise<{ topics: string[] }> {
    const decoded = decodeRealtimeUnsubscribeRequest(input)
    if (!decoded.ok) throw new IdentityDomainError('INVALID_PAYLOAD')
    const sub = this.clients.get(ctx.clientId)
    if (!sub || sub.workspaceId !== ctx.workspaceId || sub.principalId !== ctx.principalId) return { topics: [] }
    const removed: string[] = []
    for (const topic of decoded.value.topics) {
      const state = sub.topics.get(topic)
      if (!state) continue
      sub.topics.delete(topic)
      removed.push(topic)
      await this.saveCursor(sub, topic, state)
    }
    if (sub.topics.size === 0) this.clients.delete(ctx.clientId)
    return { topics: removed }
  }

  private subscriptionFor(ctx: RealtimeClientContext): Subscription {
    let sub = this.clients.get(ctx.clientId)
    if (!sub || sub.workspaceId !== ctx.workspaceId || sub.principalId !== ctx.principalId) {
      sub = { workspaceId: ctx.workspaceId, principalId: ctx.principalId, deviceKey: ctx.deviceKey, resume: false, topics: new Map(), chain: Promise.resolve() }
      this.clients.set(ctx.clientId, sub)
    }
    return sub
  }

  private fanOut(workspaceId: string, frame: RealtimeEventFrame): void {
    const parsed = parseTopic(frame.topic)
    if (!parsed) return
    const target = topicAclTarget(parsed)
    for (const [clientId, sub] of this.clients) {
      if (sub.workspaceId !== workspaceId || !sub.topics.has(frame.topic)) continue
      sub.chain = sub.chain.then(async () => {
        const state = sub.topics.get(frame.topic)
        if (!state || this.clients.get(clientId) !== sub) return
        const now = this.now()
        const sent = await this.options.transport.pushToWorkspaceClient(clientId, workspaceId, REALTIME_RPC.EVENT, [workspaceId, frame], async actor => {
          if (actor.principalId !== sub.principalId) return false
          if (this.cacheMs > 0 && state.aclCheckedAt !== undefined && now - state.aclCheckedAt < this.cacheMs) return true
          const allowed = (await this.options.authorizer.canReadTopic({ principalId: sub.principalId, workspaceId }, target)) === true
          if (allowed) state.aclCheckedAt = now
          else delete state.aclCheckedAt
          return allowed
        }, this.cacheMs > 0 ? { reuseVerifiedSessionMs: this.cacheMs } : undefined)
        if (sent) {
          // A recreated workspace log (idle drop) starts a new epoch: its seqs restart.
          if (state.epoch !== frame.epoch) { state.epoch = frame.epoch; state.lastSeq = frame.seq }
          else state.lastSeq = Math.max(state.lastSeq, frame.seq)
        }
        else delete state.aclCheckedAt
      }).catch(error => { this.options.onError?.(error) })
    }
  }

  /** Resolves after every queued delivery finished (tests, shutdown). */
  async flush(): Promise<void> {
    await Promise.all([...this.clients.values()].map(sub => sub.chain))
  }

  private async drop(clientId: string): Promise<void> {
    const sub = this.clients.get(clientId)
    if (!sub) return
    this.clients.delete(clientId)
    await sub.chain
    const owner = cursorOwner(sub)
    const cursors = this.options.cursors
    if (!sub.resume || !cursors || !owner || sub.topics.size === 0) return
    const entries = [...sub.topics].map(([topic, state]) => ({ topic, position: { epoch: state.epoch, seq: state.lastSeq } }))
    try {
      if (cursors.saveMany) await cursors.saveMany(owner, entries, this.options.policyEpoch ?? 1)
      else for (const entry of entries) await cursors.save(owner, entry.topic, entry.position, this.options.policyEpoch ?? 1)
    } catch (error) {
      this.options.onError?.(error)
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private isTransient(error: unknown): boolean {
    try { return this.options.isTransientError?.(error) === true } catch { return false }
  }

  private async saveCursor(sub: Subscription, topic: string, state: TopicState): Promise<void> {
    const owner = cursorOwner(sub)
    if (!sub.resume || !this.options.cursors || !owner) return
    try {
      await this.options.cursors.save(owner, topic, { epoch: state.epoch, seq: state.lastSeq }, this.options.policyEpoch ?? 1)
    } catch (error) {
      this.options.onError?.(error)
    }
  }
}

/** Cursors need a device / session key; without one there is no resume (→ snapshot). */
function cursorOwner(source: { workspaceId: string; principalId: string; deviceKey?: string | undefined }): RealtimeCursorOwner | null {
  return source.deviceKey ? { workspaceId: source.workspaceId, principalId: source.principalId, deviceKey: source.deviceKey } : null
}

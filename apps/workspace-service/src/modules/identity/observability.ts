import { createHash } from 'node:crypto'
import { RpcCallCounter } from '../../../../../packages/server-core/src/observability/rpc-call-counter.ts'

export const MAX_RETAINED_CONSUMER_FAILURES = 1024
const COUNTERS = ['projectApplied', 'projectReplayed', 'projectConflicts', 'projectFailed',
  'consumerCommitted', 'consumerFailed', 'consumerRetried', 'consumerEmptyPolls',
  'consumerInboxDeduplicatedPolls', 'retryTrackingEvictions'] as const
export type IdentityCounter = typeof COUNTERS[number]
export type IdentityCounterSnapshot = Readonly<Record<IdentityCounter, number>>

/** Fixed aggregate labels only. No payload, identity, command ID or consumer label leaves this port.
 * Retry attribution is bounded process state; PostgreSQL receipts/inbox remain the durable authority.
 */
export class IdentityObservability {
  private readonly counter = new RpcCallCounter()
  private readonly failed = new Set<string>()

  snapshot(): IdentityCounterSnapshot {
    return Object.freeze({
      projectApplied: this.counter.get('projectApplied'), projectReplayed: this.counter.get('projectReplayed'),
      projectConflicts: this.counter.get('projectConflicts'), projectFailed: this.counter.get('projectFailed'),
      consumerCommitted: this.counter.get('consumerCommitted'), consumerFailed: this.counter.get('consumerFailed'),
      consumerRetried: this.counter.get('consumerRetried'), consumerEmptyPolls: this.counter.get('consumerEmptyPolls'),
      consumerInboxDeduplicatedPolls: this.counter.get('consumerInboxDeduplicatedPolls'),
      retryTrackingEvictions: this.counter.get('retryTrackingEvictions'),
    })
  }
  projectCommitted(outcome: 'applied' | 'replayed'): void {
    this.counter.record(outcome === 'applied' ? 'projectApplied' : 'projectReplayed')
  }
  projectRejected(conflict: boolean): void { this.counter.record(conflict ? 'projectConflicts' : 'projectFailed') }
  attemptKey(consumerId: string, eventId: string): string {
    return createHash('sha256').update(JSON.stringify([consumerId, eventId])).digest('hex')
  }
  wasFailed(key: string): boolean { return this.failed.has(key) }
  consumerCommitted(key: string, retried: boolean): void {
    if (retried) this.counter.record('consumerRetried')
    this.counter.record('consumerCommitted'); this.failed.delete(key)
  }
  consumerRejected(key: string | undefined, retried: boolean): void {
    if (retried) this.counter.record('consumerRetried')
    this.counter.record('consumerFailed')
    if (key && !this.failed.has(key)) {
      if (this.failed.size >= MAX_RETAINED_CONSUMER_FAILURES) {
        const oldest = this.failed.values().next().value
        if (oldest !== undefined) this.failed.delete(oldest)
        this.counter.record('retryTrackingEvictions')
      }
      this.failed.add(key)
    }
  }
  consumerEmpty(deduplicated: boolean): void {
    this.counter.record('consumerEmptyPolls')
    if (deduplicated) this.counter.record('consumerInboxDeduplicatedPolls')
  }
}

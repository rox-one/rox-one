/**
 * W1-09 (#1506) — The workspace notify module.
 *
 * One factory wires everything the module owns: the fan-out (a relay sink),
 * the `notification_pref` store, the email batching worker and the mark-read
 * endpoint. The composition root (`modules/commands/runtime.ts`) adds it to
 * the command bus; the notify HTTP routes are only reachable when it is
 * present, and the `notifications.*` handlers only bind while its host is
 * installed — so an unconfigured service behaves exactly as before.
 */

import type { NotifyCommandHost } from '../../../../../packages/core/src/notify/index.ts'
import type { DomainEvent } from '../../../../../packages/core/src/events/index.ts'
import { NotifyService, createNotifyServiceHost, notifyHttpAuthority, type NotifyServiceOptions, type WorkspaceNotifyHttpAuthority } from './service.ts'
import type { FanoutSummary } from './fanout.ts'

export * from './audience-adapter.ts'
export * from './email-worker.ts'
export * from './fanout.ts'
export * from './routes.ts'
export * from './service.ts'
export * from './store.ts'

export interface NotifyModule {
  service: NotifyService
  /** `notifications.*` host — install with `setNotifyCommandHost(module.host)`. */
  host: NotifyCommandHost
  /** Relay sink: committed domain events in, notifications out. */
  ingest(events: readonly DomainEvent[]): Promise<FanoutSummary>
  /** The authority behind `GET /notifications` and `POST /notifications/read`. */
  http: WorkspaceNotifyHttpAuthority
}

export function createNotifyModule(options: NotifyServiceOptions): NotifyModule {
  const service = new NotifyService(options)
  return {
    service,
    host: createNotifyServiceHost(service),
    ingest: events => service.ingest(events),
    http: notifyHttpAuthority(service),
  }
}
/**
 * W1-03 (#1500) — Composition of the workspace command bus.
 *
 * Opt-in: `createWorkspaceServer({ commandBus: {...} })`. Without it nothing
 * here is constructed, no `realtime:*` channel is registered and
 * `POST /v1/workspaces/{ws}/commands` answers 404 (behaviour identical to
 * main). The Postgres store needs the W1-05 `05-events.sql` tables
 * (`domain_event`, `command_receipt`, `realtime_cursor`).
 */

import type { SQL } from 'bun'
import type { CommandRegistry } from '../../../../../packages/core/src/commands/index.ts'
import { InProcessEventBus } from '../../../../../packages/server-core/src/commands/event-bus.ts'
import type { CommandStore } from '../../../../../packages/server-core/src/commands/store.ts'
import type { WsRpcServer } from '../../../../../packages/server-core/src/transport/server.ts'
import { createWorkspaceAuthorizer, type WorkspaceAuthorizer } from './authorizer.ts'
import { WorkspaceCommandService } from './service.ts'
import { PostgresCommandStore } from './store.ts'
import { DomainEventRelay, type DomainEventSink } from '../events/relay.ts'
import { valkeyEventSink, type ValkeyPublishClient } from '../events/valkey.ts'
import { RealtimeGateway, type RealtimePushTransport } from '../realtime/gateway.ts'
import { PostgresRealtimeCursorStore, type RealtimeCursorStore } from '../realtime/cursor-store.ts'
import { registerRealtimeHandlers } from '../realtime/handlers.ts'

export interface WorkspaceCommandBusConfiguration {
  /** Default: Postgres (`domain_event` / `command_receipt` in the service schema). */
  readonly store?: CommandStore
  readonly registry?: CommandRegistry
  /** Default: STUB(#1501) member authorizer. */
  readonly authorizer?: WorkspaceAuthorizer
  /** Optional multi-instance fan-out (ids only). */
  readonly valkey?: ValkeyPublishClient
  /** Default: Postgres `realtime_cursor`; `null` disables resume cursors. */
  readonly cursors?: RealtimeCursorStore | null
  /** Fan-out revalidation cache (default 5 s, `0` re-checks every delivery). */
  readonly revalidationCacheMs?: number
  /** Relay retry backoff after a sink failure. */
  readonly relayRetryBaseMs?: number
  /** Sweep idle realtime replay windows every this many ms (default 60 s, `0` disables). */
  readonly evictIntervalMs?: number
  readonly onError?: (error: unknown) => void
}

export interface WorkspaceCommandBus {
  readonly service: WorkspaceCommandService
  readonly bus: InProcessEventBus
  readonly relay: DomainEventRelay
  readonly store: CommandStore
  /** Relay watermarks initialised from the store (await before serving). */
  readonly ready: Promise<void>
  /** Attach the realtime gateway to the WS transport (after the server exists). */
  attach(server: WsRpcServer & RealtimePushTransport): RealtimeGateway
  /** Stop timers (relay retries, idle-window sweep); also runs on server shutdown after `attach`. */
  close(): void
}

export function createWorkspaceCommandBus(database: SQL, schema: string, configuration: WorkspaceCommandBusConfiguration): WorkspaceCommandBus {
  const store = configuration.store ?? new PostgresCommandStore(database, schema)
  const authorizer = configuration.authorizer ?? createWorkspaceAuthorizer()
  const bus = new InProcessEventBus({ ...(configuration.onError ? { onListenerError: configuration.onError, onProjectorError: configuration.onError } : {}) })
  const sinks: DomainEventSink[] = [events => { bus.publish(events) }]
  if (configuration.valkey) sinks.push(valkeyEventSink(configuration.valkey))
  const relay = new DomainEventRelay({ store, sinks, ...(configuration.relayRetryBaseMs ? { retryBaseMs: configuration.relayRetryBaseMs } : {}), ...(configuration.onError ? { onError: configuration.onError } : {}) })
  // Watermarks start at the committed maximum (migrations already ran); the
  // server awaits `ready` before it can accept a command.
  const ready = relay.start()
  const service = new WorkspaceCommandService({
    store,
    authorizer,
    publish: relay.publish,
    ...(configuration.registry ? { registry: configuration.registry } : {}),
    ...(configuration.onError ? { onError: configuration.onError } : {}),
  })
  // TopicLog windows are otherwise only evicted lazily on access; sweep them so
  // workspaces that went quiet release their replay buffers.
  const evictIntervalMs = configuration.evictIntervalMs ?? 60_000
  let evictTimer: ReturnType<typeof setInterval> | null = null
  if (evictIntervalMs > 0) {
    evictTimer = setInterval(() => {
      try { bus.evictIdle() } catch (error) { configuration.onError?.(error) }
    }, evictIntervalMs)
    ;(evictTimer as { unref?: () => void }).unref?.()
  }
  const close = () => {
    if (evictTimer) clearInterval(evictTimer)
    evictTimer = null
    relay.close()
  }
  const cursors = configuration.cursors === undefined ? new PostgresRealtimeCursorStore(database, schema) : configuration.cursors
  return {
    service,
    bus,
    relay,
    store,
    ready,
    close,
    attach(server) {
      const gateway = new RealtimeGateway({
        bus,
        transport: server,
        authorizer,
        ...(cursors ? { cursors } : {}),
        ...(configuration.revalidationCacheMs !== undefined ? { revalidationCacheMs: configuration.revalidationCacheMs } : {}),
        ...(store.isTransientError ? { isTransientError: (error: unknown) => store.isTransientError!(error) } : {}),
        ...(configuration.onError ? { onError: configuration.onError } : {}),
      })
      registerRealtimeHandlers(server, gateway)
      server.onShutdown(() => { gateway.close(); close() })
      return gateway
    },
  }
}

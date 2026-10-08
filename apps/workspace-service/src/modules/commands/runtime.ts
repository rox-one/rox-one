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
  readonly onError?: (error: unknown) => void
}

export interface WorkspaceCommandBus {
  readonly service: WorkspaceCommandService
  readonly bus: InProcessEventBus
  readonly relay: DomainEventRelay
  readonly store: CommandStore
  /** Attach the realtime gateway to the WS transport (after the server exists). */
  attach(server: WsRpcServer & RealtimePushTransport): RealtimeGateway
}

export function createWorkspaceCommandBus(database: SQL, schema: string, configuration: WorkspaceCommandBusConfiguration): WorkspaceCommandBus {
  const store = configuration.store ?? new PostgresCommandStore(database, schema)
  const authorizer = configuration.authorizer ?? createWorkspaceAuthorizer()
  const bus = new InProcessEventBus({ ...(configuration.onError ? { onListenerError: configuration.onError } : {}) })
  const sinks: DomainEventSink[] = [events => { bus.publish(events) }]
  if (configuration.valkey) sinks.push(valkeyEventSink(configuration.valkey))
  const relay = new DomainEventRelay({ store, sinks, ...(configuration.onError ? { onError: configuration.onError } : {}) })
  const service = new WorkspaceCommandService({
    store,
    authorizer,
    publish: relay.publish,
    ...(configuration.registry ? { registry: configuration.registry } : {}),
    ...(configuration.onError ? { onError: configuration.onError } : {}),
  })
  const cursors = configuration.cursors === undefined ? new PostgresRealtimeCursorStore(database, schema) : configuration.cursors
  return {
    service,
    bus,
    relay,
    store,
    attach(server) {
      const gateway = new RealtimeGateway({
        bus,
        transport: server,
        authorizer,
        ...(cursors ? { cursors } : {}),
        ...(configuration.onError ? { onError: configuration.onError } : {}),
      })
      registerRealtimeHandlers(server, gateway)
      server.onShutdown(() => gateway.close())
      return gateway
    },
  }
}

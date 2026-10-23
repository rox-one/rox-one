/**
 * W1-15 (issue #2042, feat/team-calls) — the workspace-service `im` relay
 * bridge module.
 *
 * One factory wires the repository, directory, relay client and HTTP
 * authority. It is opt-in: `createImModule` returns `undefined` (routes 404)
 * unless a relay config is injected or resolvable from the environment
 * (`ROX_IM_RELAY_URL` + `ROX_IM_SERVICE_NSEC` / `_FILE`). Nothing here is
 * constructed while the feature is off.
 */

import type { SQL } from 'bun'
import { imHttpAuthority, ImService, type ImFeedPublisher, type WorkspaceImHttpAuthority } from './service.ts'
import { PostgresImDirectory, PostgresImRepository, type ImDirectoryPort, type ImRepository } from './repository.ts'
import { createHttpImRelayClient, resolveImRelayConfig, type ImRelayClient, type ImRelayConfig } from './relay-client.ts'
import { createImMemberRevoker, type ImMemberRevoker } from './service.ts'

export * from './feed.ts'
export * from './relay-client.ts'
export * from './repository.ts'
export * from './routes.ts'
export * from './service.ts'

export interface ImModuleOptions {
  readonly database: SQL
  readonly schema: string
  /** Overrides for tests / composition. Defaults are Postgres-backed. */
  readonly repository?: ImRepository
  readonly directory?: ImDirectoryPort
  readonly relay?: ImRelayClient
  /** Required when `relay` is injected; otherwise resolved from `env`. */
  readonly config?: ImRelayConfig
  /** Per-channel feed fan-out (the composition root wires notify). */
  readonly feed?: ImFeedPublisher
  readonly env?: Record<string, string | undefined>
  readonly readSecretFile?: (path: string) => string
  readonly now?: () => Date
}

export interface ImModule {
  readonly service: ImService
  /** The authority behind `/v1/im/*`. */
  readonly http: WorkspaceImHttpAuthority
  readonly relay: ImRelayClient
  readonly repository: ImRepository
  readonly directory: ImDirectoryPort
  /** Org-removal hook: revoke relay membership and delete the identity. */
  readonly revoker: ImMemberRevoker
}

export function createImModule(options: ImModuleOptions): ImModule | undefined {
  const config = options.config ?? resolveImRelayConfig(options.env ?? process.env, options.readSecretFile)
  if (!config) return undefined
  const relay = options.relay ?? createHttpImRelayClient(config, options.now ? { now: options.now } : {})
  const repository = options.repository ?? new PostgresImRepository(options.database)
  const directory = options.directory ?? new PostgresImDirectory(options.database, options.schema)
  const service = new ImService({
    repository,
    directory,
    relay,
    config,
    ...(options.feed ? { feed: options.feed } : {}),
    ...(options.now ? { now: options.now } : {}),
  })
  return {
    service,
    http: imHttpAuthority(service),
    relay,
    repository,
    directory,
    revoker: createImMemberRevoker({ repository, relay }),
  }
}

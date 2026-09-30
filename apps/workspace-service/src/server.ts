import type { SQL } from 'bun'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WsRpcServer } from '../../../packages/server-core/src/transport/server.ts'
import type { RequestContext, WsRpcServerOptions } from '../../../packages/server-core/src/transport/index.ts'
import {
  DOMAIN_PROJECT_RPC,
  IdentityDomainError,
  type AuthenticatedActor,
  type SharedProjectAuthority,
} from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { createLocalIssuer, type LocalIssuerConfig } from './auth/local-issuer.ts'
import { PostgresIdentityAuth } from './auth/postgres-identity.ts'
import { AuthenticationError, createVerifiedActorResolver, type VerifiedActorConfig, type VerifiedActorInput } from './auth/verified-actor.ts'
import { applyWorkspaceMigrations, migrationFromSource, type WorkspaceMigration } from './database/migrations.ts'
import { createWorkspaceHttpHandler } from './http.ts'
import { IdentityCommands, requireActor, requireUuid } from './modules/identity/commands.ts'
import { IdentityObservability } from './modules/identity/observability.ts'
import { IdentityRepository } from './modules/identity/repository.ts'

const BOOTSTRAP_MIGRATIONS = ['01-domain-contract.sql', '01-local-auth-bootstrap.sql'] as const
const DEFAULT_SCHEMA = 'public'
const DEFAULT_HOST = '127.0.0.1'

export type WorkspaceAuthenticationConfiguration =
  | { readonly mode: 'local-bootstrap'; readonly configuration: LocalIssuerConfig }
  | { readonly mode: 'trusted-issuer'; readonly configuration: VerifiedActorConfig }

/** Runtime admission and completion cover actual database operations, including WS authentication. */
export interface WorkspaceRequestLifecycle {
  begin(): boolean
  end(): void
}

export interface WorkspaceServerConfiguration {
  readonly requestLifecycle?: WorkspaceRequestLifecycle
  readonly database: SQL
  readonly migrations: readonly WorkspaceMigration[]
  readonly authentication: WorkspaceAuthenticationConfiguration
  readonly schema?: string
  readonly host?: string
  readonly port?: number
  readonly tls?: WsRpcServerOptions['tls']
  readonly serverId: string
}

export async function loadWorkspaceBootstrapMigrations(directory: string): Promise<readonly WorkspaceMigration[]> {
  return Promise.all(BOOTSTRAP_MIGRATIONS.map(async name =>
    migrationFromSource(name, await readFile(join(directory, name), 'utf8'))))
}

function canonicalActor(input: VerifiedActorInput): AuthenticatedActor {
  return Object.freeze({
    principalId: input.principalId,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    expiresAt: input.expiresAt,
    authenticatedWorkspaceIds: input.authenticatedWorkspaceIds,
  })
}

/** Each route uses the same authority as HTTP; the transport alone supplies Actor. */
export function registerSharedProjectHandlers(server: WsRpcServer, authority: SharedProjectAuthority, lifecycle?: WorkspaceRequestLifecycle): void {
  const operations = [
    [DOMAIN_PROJECT_RPC.CREATE_SHARED, authority.createSharedProject.bind(authority)],
    [DOMAIN_PROJECT_RPC.GET, authority.getProject.bind(authority)],
    [DOMAIN_PROJECT_RPC.LIST, authority.listProjects.bind(authority)],
    [DOMAIN_PROJECT_RPC.EVENTS, authority.replayEvents.bind(authority)],
  ] as const
  for (const [channel, operation] of operations) {
    server.handle(channel, async (context: RequestContext, ...arguments_: unknown[]) => {
      if (lifecycle && !lifecycle.begin()) throw new IdentityDomainError('PROVIDER_UNAVAILABLE')
      try {
        if (arguments_.length !== 2) throw new IdentityDomainError('INVALID_PAYLOAD')
        const workspaceId = requireUuid(arguments_[0])
        if (context.workspaceId !== workspaceId) throw new IdentityDomainError('WORKSPACE_MISMATCH')
        return await operation(requireActor(context.actor, workspaceId), workspaceId, arguments_[1])
      } finally { lifecycle?.end() }
    }, { access: 'authenticatedWorkspace' })
  }
}

/**
 * Reuses ROX's WS/HTTP listener and one PostgreSQL pool. Startup fails before a
 * listener is exposed when migration history or trusted authentication is invalid.
 * Privileged provisioning ports are returned to the host, never registered as RPC.
 */
export async function createWorkspaceServer(configuration: WorkspaceServerConfiguration) {
  const schema = configuration.schema ?? DEFAULT_SCHEMA
  const host = configuration.host ?? DEFAULT_HOST
  if (!configuration.serverId.trim()) throw new Error('Explicit workspace server identity required')
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !configuration.tls) {
    throw new Error('TLS required for a non-loopback workspace listener')
  }
  const migrations = await applyWorkspaceMigrations(configuration.database, configuration.migrations, schema)
  const issuer = configuration.authentication.configuration.issuer
  const identity = new PostgresIdentityAuth(configuration.database, issuer, schema)
  const localIssuer = configuration.authentication.mode === 'local-bootstrap'
    ? await createLocalIssuer(configuration.authentication.configuration, identity)
    : undefined
  const resolverConfiguration: VerifiedActorConfig = configuration.authentication.mode === 'trusted-issuer'
    ? configuration.authentication.configuration
    : {
        issuer,
        audience: configuration.authentication.configuration.audience,
        algorithms: ['EdDSA'],
        keySource: { jwks: requireLocalIssuer(localIssuer).jwks() },
      }
  const actorResolver = createVerifiedActorResolver(resolverConfiguration, identity, identity, canonicalActor)
  const observability = new IdentityObservability()
  const repository = new IdentityRepository(configuration.database, schema, observability)
  const authority = new IdentityCommands(repository)
  const lifecycle = configuration.requestLifecycle
  const httpHandler = createWorkspaceHttpHandler({
    authority,
    actorResolver,
    ...(localIssuer ? { localIssuer, publicJwks: localIssuer.jwks() } : {}),
  })
  async function authenticationPhase<T>(operation: () => Promise<T>): Promise<T> {
    if (lifecycle && !lifecycle.begin()) throw new AuthenticationError()
    try { return await operation() } finally { lifecycle?.end() }
  }
  const server = new WsRpcServer({
    host,
    port: configuration.port,
    tls: configuration.tls,
    serverId: configuration.serverId,
    workspaceAuthority: {
      authenticate: token => authenticationPhase(() => actorResolver.authenticate(token)),
      revalidate: session => authenticationPhase(() => actorResolver.revalidate(session)),
    },
    httpHandler: (req, res) => {
      if (lifecycle && !lifecycle.begin()) {
        req.resume()
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ error: { code: 'PROVIDER_UNAVAILABLE' } }))
        return
      }
      // Completion follows all accepted I/O even if a client closes its response early.
      void httpHandler(req, res).finally(() => lifecycle?.end()).catch(() => res.destroy())
    },
  })
  registerSharedProjectHandlers(server, authority, lifecycle)
  return { server, authority, repository, identity, actorResolver, migrations, observability: Object.freeze({ snapshot: () => observability.snapshot() }) }
}

function requireLocalIssuer(value: Awaited<ReturnType<typeof createLocalIssuer>> | undefined) {
  if (!value) throw new Error('Explicit local issuer initialization failed')
  return value
}

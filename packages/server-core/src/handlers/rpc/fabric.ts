import { randomUUID } from 'node:crypto'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import {
  revokeConnectionAndRevalidate,
  runGithubVertical,
  type CredentialRefId,
} from '@rox/core/platform'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { getFabricRuntime } from './fabric-runtime'
import { createInfisicalHttpClient } from './infisical-http'
import {
  commitInfisicalImport,
  createFileGithubLinkStore,
  createGithubDeviceLink,
  previewInfisicalAccount,
} from '../../workgraph/index.ts'
import type {
  GithubDeviceLinkPollView,
  GithubDeviceLinkStartView,
  GithubLinkProfileView,
} from '../../workgraph/index.ts'
import type { GithubOAuthHttpClient } from '@rox/shared/credentials'
import {
  isClaimableLive,
  rpcFabricActResult,
  rpcFabricListResult,
  rpcFabricReadResult,
} from '@rox/core/rox2'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.fabric.LIST_CONNECTIONS,
  RPC_CHANNELS.fabric.CREATE_CONNECTION,
  RPC_CHANNELS.fabric.LIST_CREDENTIALS,
  RPC_CHANNELS.fabric.LIST_AUDIT,
  RPC_CHANNELS.fabric.DISCOVER,
  RPC_CHANNELS.fabric.PREVIEW,
  RPC_CHANNELS.fabric.COMMIT_IMPORT,
  RPC_CHANNELS.fabric.LIST_GRANTS,
  RPC_CHANNELS.fabric.PUT_GRANT,
  RPC_CHANNELS.fabric.ACQUIRE_LEASE,
  RPC_CHANNELS.fabric.REVOKE_CONNECTION,
  RPC_CHANNELS.fabric.GITHUB_STATUS,
  RPC_CHANNELS.fabric.GITHUB_LINK_START,
  RPC_CHANNELS.fabric.GITHUB_LINK_POLL,
  RPC_CHANNELS.fabric.GITHUB_LINK_GET,
  RPC_CHANNELS.fabric.INFISICAL_HEALTH,
  RPC_CHANNELS.fabric.INFISICAL_PREVIEW_ACCOUNT,
  RPC_CHANNELS.fabric.INFISICAL_COMMIT_IMPORT,
  RPC_CHANNELS.fabric.INFISICAL_LIST_PATHS,
  RPC_CHANNELS.fabric.INFISICAL_LIST_ITEMS,
  RPC_CHANNELS.fabric.INFISICAL_UPSERT_ITEM,
  RPC_CHANNELS.fabric.INFISICAL_DELETE_ITEM,
] as const

const DEFAULT_WORKSPACE_ID = 'local'
const TOKEN_PATTERN = /ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|glpat-[A-Za-z0-9_-]+|sk-[A-Za-z0-9]+/g

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Accept ElectronAPI positional args or a single object bag. */
function workspaceIdOf(first: unknown, fallback = DEFAULT_WORKSPACE_ID): string {
  const positional = nonEmptyString(first)
  if (positional) return positional
  if (isPlainObject(first)) {
    return nonEmptyString(first.workspaceId) ?? fallback
  }
  return fallback
}

function secondString(first: unknown, second: unknown, key: string): string | undefined {
  const positional = nonEmptyString(second)
  if (positional) return positional
  if (isPlainObject(first)) return nonEmptyString(first[key])
  if (isPlainObject(second)) return nonEmptyString(second[key])
  return undefined
}

function objectArg(first: unknown, second?: unknown): Record<string, unknown> {
  if (typeof first === 'string' && isPlainObject(second)) {
    return { workspaceId: first, ...second }
  }
  if (isPlainObject(first)) return first
  if (isPlainObject(second)) return second
  return {}
}

function stripSecrets<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, inner) => {
      const k = key.toLowerCase()
      if (k === 'value' || k === 'token' || k === 'password' || k === 'ciphertext' || k === 'secret') {
        return undefined
      }
      return inner
    }),
  ) as T
}

function sanitizeReason(error: unknown, redact?: string): string {
  let message = error instanceof Error ? error.message : String(error)
  if (redact && redact.length > 0) {
    message = message.split(redact).join('[redacted]')
  }
  message = message.replace(TOKEN_PATTERN, '[redacted]')
  if (/INFISICAL_TOKEN\s*=/i.test(message)) {
    message = message.replace(/INFISICAL_TOKEN\s*=\s*\S+/gi, 'INFISICAL_TOKEN=[redacted]')
  }
  return message
}

/**
 * Ensure provider.write registers the credential ref into the runtime registry
 * before the broker's acquireLease (resolveRef uses registry.get).
 */
function withRegistrySyncWrite<T>(
  runtime: ReturnType<typeof getFabricRuntime>,
  fn: () => Promise<T>,
): Promise<T> {
  const provider = runtime.provider
  const originalWrite = provider.write.bind(provider)
  provider.write = async (input) => {
    const version = await originalWrite(input)
    if (!runtime.registry.get(version.credentialRefId)) {
      runtime.registry.register({
        id: version.credentialRefId,
        kind: input.kind,
        providerId: provider.id,
        locator: input.locator,
      })
    }
    return version
  }
  return fn().finally(() => {
    provider.write = originalWrite
  })
}

/** Public surface of the device-flow link controller used by the handlers. */
interface GithubLinkFlow {
  start(): Promise<GithubDeviceLinkStartView>
  poll(input: { flowId: string; workspaceId: string }): Promise<GithubDeviceLinkPollView>
  get(input: { workspaceId: string }): Promise<GithubLinkProfileView | null>
}

const defaultGithubOAuthHttp: GithubOAuthHttpClient = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'manual',
  })
  return { status: response.status, body: await response.text() }
}

let cachedGithubLinkFlow: { directory: string; clientId: string; flow: GithubLinkFlow } | null = null

/** Reuse the existing device-flow module (same OAuth client id) in link mode. */
function githubLinkFlow(): GithubLinkFlow {
  const runtime = getFabricRuntime()
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID ?? ''
  if (!cachedGithubLinkFlow || cachedGithubLinkFlow.directory !== runtime.directory || cachedGithubLinkFlow.clientId !== clientId) {
    cachedGithubLinkFlow = {
      directory: runtime.directory,
      clientId,
      flow: createGithubDeviceLink({
        http: defaultGithubOAuthHttp,
        clientId,
        store: createFileGithubLinkStore(runtime.directory),
      }),
    }
  }
  return cachedGithubLinkFlow.flow
}

export function registerFabricHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.fabric.LIST_CONNECTIONS, async (_ctx, workspaceIdOrArgs?: unknown) => {
    const listed = rpcFabricListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    const runtime = getFabricRuntime()
    const workspaceId = workspaceIdOf(workspaceIdOrArgs)
    return stripSecrets(await runtime.graph.listConnections(workspaceId))
  })

  server.handle(RPC_CHANNELS.fabric.CREATE_CONNECTION, async (_ctx, args: unknown) => {
    const act = rpcFabricActResult({ source: 'native', action: 'write', nativeId: 'connection' })
    if (!isClaimableLive(act)) throw new Error('fabric connection write is not live')
    const runtime = getFabricRuntime()
    const bag = objectArg(args)
    return stripSecrets(
      await runtime.graph.createConnection({
        workspaceId: nonEmptyString(bag.workspaceId) ?? DEFAULT_WORKSPACE_ID,
        integrationId: String(bag.integrationId ?? 'import'),
        credentialRefId: bag.credentialRefId as CredentialRefId,
        storageMode: (bag.storageMode as 'reference' | 'copy' | 'mirror' | 'managed' | 'ephemeral') ?? 'reference',
      }),
    )
  })

  server.handle(RPC_CHANNELS.fabric.LIST_CREDENTIALS, async (_ctx, _workspaceIdOrArgs?: unknown) => {
    const runtime = getFabricRuntime()
    return stripSecrets(
      runtime.registry.list().map((ref) => ({
        id: ref.id,
        kind: ref.kind,
        provider: ref.providerId,
        mode: 'reference',
      })),
    )
  })

  server.handle(RPC_CHANNELS.fabric.LIST_AUDIT, async (_ctx, workspaceIdOrArgs?: unknown, maybeConnectionId?: unknown) => {
    const runtime = getFabricRuntime()
    const workspaceId = workspaceIdOf(workspaceIdOrArgs)
    const connectionId =
      secondString(workspaceIdOrArgs, maybeConnectionId, 'connectionId') ??
      (isPlainObject(workspaceIdOrArgs) ? nonEmptyString(workspaceIdOrArgs.connectionId) : undefined)
    if (connectionId) {
      return stripSecrets(await runtime.graph.listConnectionAudit(workspaceId, connectionId))
    }
    const connections = await runtime.graph.listConnections(workspaceId)
    const rows = []
    for (const connection of connections) {
      rows.push(...(await runtime.graph.listConnectionAudit(workspaceId, connection.id)))
    }
    return stripSecrets(rows)
  })

  server.handle(RPC_CHANNELS.fabric.DISCOVER, async (_ctx, workspaceIdOrArgs: unknown, maybeImporterId?: unknown) => {
    const runtime = getFabricRuntime()
    const importerId = secondString(workspaceIdOrArgs, maybeImporterId, 'importerId')
    if (!importerId) throw new Error('fabric.discover: importerId required')
    return stripSecrets(await runtime.importService.discover(importerId))
  })

  server.handle(RPC_CHANNELS.fabric.PREVIEW, async (_ctx, workspaceIdOrArgs: unknown, maybeCandidateId?: unknown) => {
    const runtime = getFabricRuntime()
    const candidateId = secondString(workspaceIdOrArgs, maybeCandidateId, 'candidateId')
    if (!candidateId) throw new Error('fabric.preview: candidateId required')
    runtime.importService.requestAccess(candidateId)
    runtime.importService.grantAccess()
    return stripSecrets(await runtime.importService.preview(runtime.provider.id))
  })

  server.handle(RPC_CHANNELS.fabric.COMMIT_IMPORT, async (_ctx, workspaceIdOrArgs: unknown, maybeCandidateId?: unknown) => {
    const runtime = getFabricRuntime()
    const workspaceId = workspaceIdOf(workspaceIdOrArgs)
    const candidateId = secondString(workspaceIdOrArgs, maybeCandidateId, 'candidateId')
    if (!candidateId) throw new Error('fabric.commitImport: candidateId required')
    const phase = runtime.importService.session.getPhase()
    if (phase === 'candidates_shown' || phase === 'idle') {
      runtime.importService.requestAccess(candidateId)
      runtime.importService.grantAccess()
      await runtime.importService.preview(runtime.provider.id)
    }
    if (runtime.importService.session.getPhase() === 'previewed') {
      runtime.importService.selectMode('copy')
      runtime.importService.checkConflicts()
      await runtime.importService.validate(runtime.provider.id)
    }
    const commit = await runtime.importService.commit(runtime.provider.id)
    const selected = runtime.importService.session.getSelectedCandidate()
    await runtime.graph.createConnection({
      workspaceId,
      integrationId: selected?.sourceId ?? 'import',
      credentialRefId: commit.credentialRefId,
      storageMode: commit.mode,
    })
    return stripSecrets(commit)
  })

  server.handle(RPC_CHANNELS.fabric.LIST_GRANTS, async (_ctx, workspaceIdOrArgs?: unknown) => {
    const runtime = getFabricRuntime()
    return stripSecrets(runtime.grants.listAll(workspaceIdOf(workspaceIdOrArgs)))
  })

  server.handle(RPC_CHANNELS.fabric.PUT_GRANT, async (_ctx, workspaceIdOrArgs: unknown, maybeGrant?: unknown) => {
    const runtime = getFabricRuntime()
    const workspaceId = workspaceIdOf(workspaceIdOrArgs)
    const bag = objectArg(workspaceIdOrArgs, maybeGrant)
    const consumerId = nonEmptyString(bag.consumerId)
    const action = nonEmptyString(bag.action)
    const resource = nonEmptyString(bag.resource)
    if (!consumerId || !action || !resource) {
      throw new Error('fabric.putGrant: consumerId, action, and resource required')
    }
    const refs = runtime.registry.list()
    const credentialRefId = (nonEmptyString(bag.credentialRefId) as CredentialRefId | undefined) ?? refs[0]?.id
    if (!credentialRefId) throw new Error('fabric.putGrant: no credential to attach')
    return stripSecrets(
      runtime.grants.put({
        id: `grant_${randomUUID()}`,
        workspaceId,
        consumerId,
        credentialRefId,
        actions: [action],
        resources: [resource],
        status: 'active',
      }),
    )
  })

  server.handle(RPC_CHANNELS.fabric.ACQUIRE_LEASE, async (_ctx, args: unknown) => {
    const runtime = getFabricRuntime()
    const bag = objectArg(args)
    const workspaceId = nonEmptyString(bag.workspaceId) ?? DEFAULT_WORKSPACE_ID
    const credentialRefId = nonEmptyString(bag.credentialRefId) as CredentialRefId | undefined
    const consumerId = nonEmptyString(bag.consumerId)
    const action = nonEmptyString(bag.action)
    const resource = nonEmptyString(bag.resource)
    if (!credentialRefId || !consumerId || !action || !resource) {
      throw new Error('fabric.acquireLease: credentialRefId, consumerId, action, resource required')
    }
    const lease = await runtime.broker.acquireLease({
      credentialRef: credentialRefId,
      consumer: { kind: 'agent', id: consumerId, workspaceId },
      purpose: action,
      action,
      resources: [resource],
      ttl: 30_000,
    })
    return stripSecrets(lease)
  })

  server.handle(RPC_CHANNELS.fabric.REVOKE_CONNECTION, async (_ctx, args: unknown) => {
    const runtime = getFabricRuntime()
    const bag = objectArg(args)
    const workspaceId = nonEmptyString(bag.workspaceId) ?? DEFAULT_WORKSPACE_ID
    const connectionId = nonEmptyString(bag.connectionId)
    if (!connectionId) throw new Error('fabric.revokeConnection: connectionId required')
    const act = rpcFabricActResult({ source: 'native', action: 'destroy', granted: true, nativeId: connectionId })
    if (!isClaimableLive(act)) throw new Error('fabric connection destroy is not live')
    return stripSecrets(
      await revokeConnectionAndRevalidate({
        kernel: runtime.graph,
        broker: runtime.broker,
        provider: runtime.provider,
        workspaceId,
        connectionId,
        reason: 'operator',
      }),
    )
  })

  server.handle(RPC_CHANNELS.fabric.GITHUB_STATUS, async (_ctx, args?: unknown) => {
    const read = rpcFabricReadResult({ source: 'native', nativeId: 'github' })
    if (!isClaimableLive(read.result)) return { available: false, reason: 'not-live' }
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
    if (!token) return { available: false, reason: 'not-configured' }

    const probe = isPlainObject(args) && args.probe === true
    if (!probe) return { available: true, reason: 'env' }

    const runtime = getFabricRuntime()
    try {
      const result = await withRegistrySyncWrite(runtime, () =>
        runGithubVertical({
          workspaceId: DEFAULT_WORKSPACE_ID,
          requestedBy: 'operator',
          consumer: { kind: 'agent', id: 'fabric-github-status', workspaceId: DEFAULT_WORKSPACE_ID },
          stack: { provider: runtime.provider, importers: runtime.importers },
          graph: runtime.graph,
          grants: runtime.grants,
          broker: runtime.broker,
          injectedToken: token,
          fetch: globalThis.fetch.bind(globalThis),
        }),
      )
      return stripSecrets({
        available: true,
        login: result.login,
        connectionId: result.connectionId,
        leaseId: result.leaseId,
        credentialRefId: result.credentialRefId,
      })
    } catch (error) {
      return {
        available: false,
        reason: sanitizeReason(error, token),
      }
    }
  })

  // Onboarding «Привязать GitHub» — the existing device flow in link mode. The
  // start view carries only the public codes; the poll returns the linked
  // profile and never the access token; the get reloads a stored link.
  server.handle(RPC_CHANNELS.fabric.GITHUB_LINK_START, async () => {
    const view: GithubDeviceLinkStartView = await githubLinkFlow().start()
    return stripSecrets(view)
  })

  server.handle(RPC_CHANNELS.fabric.GITHUB_LINK_POLL, async (_ctx, args: unknown) => {
    const bag = objectArg(args)
    const flowId = nonEmptyString(bag.flowId)
    if (!flowId) throw new Error('fabric.githubLinkPoll: flowId required')
    const view: GithubDeviceLinkPollView = await githubLinkFlow().poll({
      flowId,
      workspaceId: nonEmptyString(bag.workspaceId) ?? DEFAULT_WORKSPACE_ID,
    })
    return stripSecrets(view)
  })

  server.handle(RPC_CHANNELS.fabric.GITHUB_LINK_GET, async (_ctx, args?: unknown) => {
    const profile: GithubLinkProfileView | null = await githubLinkFlow().get({
      workspaceId: workspaceIdOf(args),
    })
    return profile ? stripSecrets(profile) : null
  })

  server.handle(RPC_CHANNELS.fabric.INFISICAL_HEALTH, async () => {
    const runtime = getFabricRuntime()
    try {
      const account = await runtime.infisical.discoverAccount({ workspaceId: DEFAULT_WORKSPACE_ID })
      return stripSecrets({ available: account.status === 'connected', providerId: runtime.infisical.id })
    } catch (error) {
      return {
        available: false,
        reason: sanitizeReason(error, process.env.INFISICAL_TOKEN),
      }
    }
  })

  // Value-free account preview: validates the locator + https site before any
  // network call; clientSecret is accepted only so the leak guard can reject it.
  server.handle(RPC_CHANNELS.fabric.INFISICAL_PREVIEW_ACCOUNT, async (_ctx, args: unknown) => {
    const bag = objectArg(args)
    return stripSecrets(previewInfisicalAccount({
      siteUrl: String(bag.siteUrl ?? ''),
      clientId: String(bag.clientId ?? ''),
      projectId: String(bag.projectId ?? ''),
      environment: String(bag.environment ?? ''),
      secretPath: String(bag.secretPath ?? ''),
      secretKey: String(bag.secretKey ?? ''),
      ...(nonEmptyString(bag.clientSecret) ? { clientSecret: bag.clientSecret as string } : {}),
    }))
  })

  // Reference-only account connection: logs in, confirms workspace access,
  // inspects the secret, then records a Connection. No secret value is returned.
  server.handle(RPC_CHANNELS.fabric.INFISICAL_COMMIT_IMPORT, async (_ctx, args: unknown) => {
    const act = rpcFabricActResult({ source: 'native', action: 'write', nativeId: 'infisical-connection' })
    if (!isClaimableLive(act)) throw new Error('fabric infisical import is not live')
    const bag = objectArg(args)
    const runtime = getFabricRuntime()
    const connection = await commitInfisicalImport({
      siteUrl: String(bag.siteUrl ?? ''),
      clientId: String(bag.clientId ?? ''),
      clientSecret: String(bag.clientSecret ?? ''),
      projectId: String(bag.projectId ?? ''),
      environment: String(bag.environment ?? ''),
      secretPath: String(bag.secretPath ?? ''),
      secretKey: String(bag.secretKey ?? ''),
      http: createInfisicalHttpClient(),
      kernel: runtime.graph,
      workspaceId: nonEmptyString(bag.workspaceId) ?? DEFAULT_WORKSPACE_ID,
      requestedBy: 'operator',
      registry: runtime.registry,
    })
    return stripSecrets({ id: connection.id })
  })

  // Keeper item management («Секреты» vault UI). These are the only fabric RPCs
  // where secret values may cross to the renderer: listItems returns item
  // payloads verbatim (NOT through stripSecrets, which would drop user keys
  // named "value") and upsertItem accepts a value payload. Values are never
  // logged, never echoed in errors, and every call is gated like preview/commit.
  server.handle(RPC_CHANNELS.fabric.INFISICAL_LIST_PATHS, async (_ctx, args: unknown) => {
    const read = rpcFabricReadResult({ source: 'native', nativeId: 'infisical-paths' })
    if (!isClaimableLive(read.result)) return { paths: [] }
    const bag = objectArg(args)
    const runtime = getFabricRuntime()
    return runtime.infisical.listPaths({
      projectId: String(bag.projectId ?? ''),
      environment: String(bag.environment ?? ''),
    })
  })

  server.handle(RPC_CHANNELS.fabric.INFISICAL_LIST_ITEMS, async (_ctx, args: unknown) => {
    const read = rpcFabricReadResult({ source: 'native', nativeId: 'infisical-items' })
    if (!isClaimableLive(read.result)) return { items: [] }
    const bag = objectArg(args)
    const runtime = getFabricRuntime()
    return runtime.infisical.listItems({
      projectId: String(bag.projectId ?? ''),
      environment: String(bag.environment ?? ''),
      secretPath: String(bag.secretPath ?? '/'),
    })
  })

  server.handle(RPC_CHANNELS.fabric.INFISICAL_UPSERT_ITEM, async (_ctx, args: unknown) => {
    const act = rpcFabricActResult({ source: 'native', action: 'write', nativeId: 'infisical-item' })
    if (!isClaimableLive(act)) throw new Error('fabric infisical item write is not live')
    const bag = objectArg(args)
    const key = nonEmptyString(bag.key)
    if (!key) throw new Error('fabric.infisical.upsertItem: key required')
    if (!('valueJson' in bag)) throw new Error('fabric.infisical.upsertItem: valueJson required')
    const runtime = getFabricRuntime()
    return runtime.infisical.upsertItem({
      projectId: String(bag.projectId ?? ''),
      environment: String(bag.environment ?? ''),
      secretPath: String(bag.secretPath ?? '/'),
      key,
      valueJson: bag.valueJson,
    })
  })

  server.handle(RPC_CHANNELS.fabric.INFISICAL_DELETE_ITEM, async (_ctx, args: unknown) => {
    const act = rpcFabricActResult({ source: 'native', action: 'destroy', granted: true, nativeId: 'infisical-item' })
    if (!isClaimableLive(act)) throw new Error('fabric infisical item delete is not live')
    const bag = objectArg(args)
    const key = nonEmptyString(bag.key)
    if (!key) throw new Error('fabric.infisical.deleteItem: key required')
    const runtime = getFabricRuntime()
    return runtime.infisical.deleteItem({
      projectId: String(bag.projectId ?? ''),
      environment: String(bag.environment ?? ''),
      secretPath: String(bag.secretPath ?? '/'),
      key,
    })
  })
}

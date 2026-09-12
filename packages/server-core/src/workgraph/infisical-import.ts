import { CredentialRefRegistry } from '@craft-agent/core/platform'
import {
  InfisicalProviderError,
  InfisicalSecretProvider,
  type InfisicalHttpClient,
  type InProcessCredentialBroker,
  type LocalFileSecretProvider,
} from '@craft-agent/shared/credentials'

import type { ConnectionRecord, WorkGraphKernel } from './index'

export interface InfisicalAccountPreview {
  readonly label: string
  readonly siteUrl: string
  readonly clientId: string
  readonly projectId: string
  readonly environment: string
  readonly secretPath: string
  readonly secretKey: string
  readonly locator: {
    readonly type: 'infisical'
    readonly projectId: string
    readonly environment: string
    readonly secretPath: string
    readonly secretKey: string
  }
}

export interface PreviewInfisicalAccountInput {
  readonly siteUrl: string
  readonly clientId: string
  readonly projectId: string
  readonly environment: string
  readonly secretPath: string
  readonly secretKey: string
  /** Must never appear in preview JSON even if accidentally passed. */
  readonly clientSecret?: string
}

export function previewInfisicalAccount(input: PreviewInfisicalAccountInput): InfisicalAccountPreview {
  requireHttpsSiteUrl(input.siteUrl)
  requireNonEmpty(input.clientId, 'clientId')
  requireNonEmpty(input.projectId, 'projectId')
  requireNonEmpty(input.environment, 'environment')
  requireNonEmpty(input.secretPath, 'secretPath')
  requireNonEmpty(input.secretKey, 'secretKey')

  const preview: InfisicalAccountPreview = {
    label: 'Infisical',
    siteUrl: input.siteUrl,
    clientId: input.clientId,
    projectId: input.projectId,
    environment: input.environment,
    secretPath: input.secretPath,
    secretKey: input.secretKey,
    locator: {
      type: 'infisical',
      projectId: input.projectId,
      environment: input.environment,
      secretPath: input.secretPath,
      secretKey: input.secretKey,
    },
  }
  const json = JSON.stringify(preview)
  if (input.clientSecret && json.includes(input.clientSecret)) {
    throw new Error('Import candidate leaked a secret')
  }
  if (/"clientSecret"\s*:/i.test(json) || /"client_secret"\s*:/i.test(json)) {
    throw new Error('Import candidate leaked a secret')
  }
  return preview
}

export async function commitInfisicalImport(input: {
  readonly siteUrl: string
  readonly clientId: string
  readonly clientSecret: string
  readonly projectId: string
  readonly environment: string
  readonly secretPath: string
  readonly secretKey: string
  readonly http: InfisicalHttpClient
  readonly kernel: Pick<WorkGraphKernel, 'createConnection' | 'bindConsumer'>
  readonly workspaceId: string
  readonly requestedBy: string
  readonly registry?: CredentialRefRegistry
  /** Optional local provider when mirroring a copy is requested later; reference mode does not use it. */
  readonly provider?: LocalFileSecretProvider
  readonly broker?: InProcessCredentialBroker
  readonly integrationId?: string
  readonly scopes?: readonly string[]
}): Promise<ConnectionRecord> {
  requireHttpsSiteUrl(input.siteUrl)
  requireNonEmpty(input.clientId, 'clientId')
  requireNonEmpty(input.clientSecret, 'clientSecret')
  requireNonEmpty(input.projectId, 'projectId')
  requireNonEmpty(input.environment, 'environment')
  requireNonEmpty(input.secretPath, 'secretPath')
  requireNonEmpty(input.secretKey, 'secretKey')

  const registry = input.registry ?? new CredentialRefRegistry()
  const infisical = new InfisicalSecretProvider({
    registry,
    http: input.http,
    siteUrl: input.siteUrl,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    tenantProjectId: input.projectId,
  })

  const health = await infisical.health()
  if (health.status !== 'healthy') {
    throw new InfisicalProviderError(health.code ?? 'auth')
  }

  const locator = {
    type: 'infisical' as const,
    projectId: input.projectId,
    environment: input.environment,
    secretPath: input.secretPath,
    secretKey: input.secretKey,
  }

  const ref = registry.register({
    kind: 'api_key',
    providerId: infisical.id,
    locator,
  })

  const inspected = await infisical.inspect(ref)
  if (inspected.status !== 'active') {
    throw new Error(inspected.status === 'missing' ? 'secret_missing' : 'secret_unavailable')
  }

  registry.registerVersion({
    credentialRefId: ref.id,
    codec: 'stored-credential/v1',
    fingerprint: inspected.fingerprint,
  })

  const scopes = input.scopes ?? ['infisical:secret']
  const connection = await input.kernel.createConnection({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId ?? 'infisical',
    credentialRefId: ref.id,
    storageMode: 'reference',
    scopes,
  })

  const leakHaystack = JSON.stringify({
    connection,
    locator,
    preview: previewInfisicalAccount({
      siteUrl: input.siteUrl,
      clientId: input.clientId,
      projectId: input.projectId,
      environment: input.environment,
      secretPath: input.secretPath,
      secretKey: input.secretKey,
      clientSecret: input.clientSecret,
    }),
  })
  if (leakHaystack.includes(input.clientSecret)) {
    throw new Error('Import candidate leaked a secret')
  }

  if (!input.broker) return connection
  await input.kernel.bindConsumer({
    workspaceId: input.workspaceId,
    connectionId: connection.id,
    consumerId: input.requestedBy,
    purpose: 'infisical.secret',
    allowedActions: ['infisical.read'],
    resources: scopes,
  })
  input.broker.grant({
    workspaceId: input.workspaceId,
    consumerId: input.requestedBy,
    credentialRefId: ref.id,
    actions: ['infisical.read'],
    resources: scopes,
  })
  return connection
}

function requireHttpsSiteUrl(siteUrl: string): URL {
  let origin: URL
  try {
    origin = new URL(siteUrl)
  } catch {
    throw new InfisicalProviderError('tls')
  }
  if (origin.protocol !== 'https:') throw new InfisicalProviderError('tls')
  return origin
}

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing_${field}`)
  }
}

import {
  GithubOAuthImporter,
  pollDeviceLogin,
  startDeviceLogin,
  type GithubOAuthHttpClient,
  type InProcessCredentialBroker,
  type LocalFileSecretProvider,
} from '@craft-agent/shared/credentials'

import type { ConnectionRecord, WorkGraphKernel } from './index'

export interface GithubOAuthImportPreview {
  readonly candidateId: string
  readonly label: string
  readonly maskedSummary: string
}

export async function previewGithubOAuthImport(input: {
  readonly accessToken: string
  readonly provider: LocalFileSecretProvider
}): Promise<GithubOAuthImportPreview> {
  const importer = new GithubOAuthImporter({
    provider: input.provider,
    accessToken: input.accessToken,
  })
  const [candidate] = await importer.discover()
  if (!candidate) throw new Error('unknown_candidate')
  const preview = await importer.preview({ candidateId: candidate.id })
  const out: GithubOAuthImportPreview = {
    candidateId: candidate.id,
    label: candidate.label,
    maskedSummary: preview.maskedSummary,
  }
  if (JSON.stringify(out).includes(input.accessToken)) {
    throw new Error('Import candidate leaked a secret')
  }
  return out
}

export async function commitGithubOAuthImport(input: {
  readonly accessToken: string
  readonly provider: LocalFileSecretProvider
  readonly kernel: Pick<WorkGraphKernel, 'createConnection' | 'bindConsumer'>
  readonly workspaceId: string
  readonly requestedBy: string
  readonly broker?: InProcessCredentialBroker
}): Promise<ConnectionRecord> {
  const importer = new GithubOAuthImporter({
    provider: input.provider,
    accessToken: input.accessToken,
  })
  await importer.discover()
  const committed = await importer.commit({
    candidateId: 'github-oauth',
    targetProviderId: input.provider.id,
    mode: 'copy',
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
  })
  const connection = await input.kernel.createConnection({
    workspaceId: input.workspaceId,
    integrationId: 'github',
    credentialRefId: committed.credentialRefId,
    storageMode: 'copy',
    scopes: ['github:user'],
  })
  if (JSON.stringify(connection).includes(input.accessToken)) {
    throw new Error('Import candidate leaked a secret')
  }
  if (!input.broker) return connection
  await input.kernel.bindConsumer({
    workspaceId: input.workspaceId,
    connectionId: connection.id,
    consumerId: input.requestedBy,
    purpose: 'github.user',
    allowedActions: ['github.api'],
    resources: ['github:user'],
  })
  input.broker.grant({
    workspaceId: input.workspaceId,
    consumerId: input.requestedBy,
    credentialRefId: committed.credentialRefId,
    actions: ['github.api'],
    resources: ['github:user'],
  })
  return connection
}

export interface GithubDeviceStartView {
  readonly flowId: string
  readonly userCode: string
  readonly verificationUri: string
  readonly interval: number
  readonly expiresIn?: number
}

export type GithubDevicePollView =
  | { readonly status: 'pending'; readonly interval?: number }
  | { readonly status: 'slow_down'; readonly interval?: number }
  | { readonly status: 'denied' }
  | { readonly status: 'expired' }
  | { readonly status: 'imported'; readonly connectionId: string }

export function createGithubDeviceFlow(deps: {
  readonly http: GithubOAuthHttpClient
  readonly clientId: string
  readonly provider: LocalFileSecretProvider
  readonly kernel: Pick<WorkGraphKernel, 'createConnection' | 'bindConsumer'>
  readonly broker?: InProcessCredentialBroker
  readonly requestedBy?: string
  readonly start?: typeof startDeviceLogin
  readonly poll?: typeof pollDeviceLogin
  readonly commit?: typeof commitGithubOAuthImport
  readonly newId?: () => string
}) {
  const flows = new Map<string, { deviceCode: string }>()
  const start = deps.start ?? startDeviceLogin
  const poll = deps.poll ?? pollDeviceLogin
  const commit = deps.commit ?? commitGithubOAuthImport
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID())
  return {
    async start(): Promise<GithubDeviceStartView> {
      if (!deps.clientId) throw new Error('missing_client_id')
      const started = await start(deps.http, { clientId: deps.clientId, scope: 'read:user' })
      const flowId = newId()
      flows.set(flowId, { deviceCode: started.deviceCode })
      const view: GithubDeviceStartView = {
        flowId,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        interval: started.interval,
        ...(started.expiresIn !== undefined ? { expiresIn: started.expiresIn } : {}),
      }
      if ('deviceCode' in view || 'accessToken' in view) {
        throw new Error('Import candidate leaked a secret')
      }
      return view
    },
    async poll(input: { flowId: string; workspaceId: string }): Promise<GithubDevicePollView> {
      const flow = flows.get(input.flowId)
      if (!flow) throw new Error('unknown_flow')
      const result = await poll(deps.http, { clientId: deps.clientId, deviceCode: flow.deviceCode })
      if (result.status === 'approved') {
        flows.delete(input.flowId)
        const connection = await commit({
          accessToken: result.accessToken,
          provider: deps.provider,
          kernel: deps.kernel,
          workspaceId: input.workspaceId,
          requestedBy: deps.requestedBy ?? 'owner',
          broker: deps.broker,
        })
        return { status: 'imported', connectionId: connection.id }
      }
      if (result.status === 'denied' || result.status === 'expired') {
        flows.delete(input.flowId)
        return { status: result.status }
      }
      return {
        status: result.status,
        ...(result.interval !== undefined ? { interval: result.interval } : {}),
      }
    },
  }
}

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  GithubOAuthImporter,
  pollDeviceLogin,
  startDeviceLogin,
  type GithubDeviceLoginPollResult,
  type GithubOAuthHttpClient,
  type InProcessCredentialBroker,
  type LocalFileSecretProvider,
} from '@rox/shared/credentials'

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
  const flows = new Map<string, { deviceCode: string; polling: boolean; committing: boolean }>()
  const start = deps.start ?? startDeviceLogin
  const poll = deps.poll ?? pollDeviceLogin
  const commit = deps.commit ?? commitGithubOAuthImport
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID())
  return {
    async start(): Promise<GithubDeviceStartView> {
      if (!deps.clientId) throw new Error('missing_client_id')
      const started = await start(deps.http, { clientId: deps.clientId, scope: 'read:user' })
      const flowId = newId()
      flows.set(flowId, { deviceCode: started.deviceCode, polling: false, committing: false })
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
      if (flow.polling || flow.committing) throw new Error('poll_in_progress')
      flow.polling = true
      let result: Awaited<ReturnType<typeof poll>>
      try {
        result = await poll(deps.http, { clientId: deps.clientId, deviceCode: flow.deviceCode })
      } finally {
        flow.polling = false
      }
      if (flows.get(input.flowId) !== flow) throw new Error('unknown_flow')
      if (result.status === 'approved') {
        flow.committing = true
        try {
          const connection = await commit({
            accessToken: result.accessToken,
            provider: deps.provider,
            kernel: deps.kernel,
            workspaceId: input.workspaceId,
            requestedBy: deps.requestedBy ?? 'owner',
            broker: deps.broker,
          })
          return { status: 'imported', connectionId: connection.id }
        } finally {
          flows.delete(input.flowId)
        }
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
    async cancel(flowId: string): Promise<{ cancelled: true }> {
      if (flows.get(flowId)?.committing) throw new Error('commit_in_progress')
      flows.delete(flowId)
      const out = { cancelled: true as const }
      if ('deviceCode' in out || 'accessToken' in out) {
        throw new Error('Import candidate leaked a secret')
      }
      return out
    },
  }
}

// ---------------------------------------------------------------------------
// Account linking («Привязать GitHub», owner onboarding).
//
// Identical device flow to the credential import, but on approval it reads the
// public GitHub profile (GET /user: login/id/name/avatar_url) with the freshly
// minted token and records a workspace-scoped link. The token is used for that
// single call and is never stored, returned or logged; only the profile is.
// ---------------------------------------------------------------------------

/** Public profile recorded for a workspace once GitHub is linked. */
export interface GithubLinkProfileView {
  readonly githubLogin: string
  readonly githubId: number
  readonly avatarUrl: string
  /** Epoch milliseconds when the link landed. */
  readonly linkedAt: number
}

/** Workspace-scoped link store; the host owns persistence. */
export interface GithubLinkStore {
  get(workspaceId: string): GithubLinkProfileView | null
  set(workspaceId: string, record: GithubLinkProfileView): void
}

export interface GithubDeviceLinkStartView {
  readonly flowId: string
  readonly userCode: string
  readonly verificationUri: string
  readonly interval: number
  readonly expiresIn?: number
}

export type GithubDeviceLinkPollView =
  | { readonly status: 'pending'; readonly interval?: number }
  | { readonly status: 'slow_down'; readonly interval?: number }
  | { readonly status: 'denied' }
  | { readonly status: 'expired' }
  | { readonly status: 'linked'; readonly profile: GithubLinkProfileView }

export interface GithubProfile {
  readonly login: string
  readonly id: number
  readonly name?: string
  readonly avatarUrl: string
}

const GITHUB_USER_URL = 'https://api.github.com/user'

/**
 * GET /user with the device-flow token. Minimal fields only; the caller must
 * never place the token on a returned view.
 */
export async function fetchGithubProfile(
  http: GithubOAuthHttpClient,
  accessToken: string,
): Promise<GithubProfile> {
  if (!accessToken) throw new Error('missing_access_token')
  const response = await http({
    method: 'GET',
    url: GITHUB_USER_URL,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'rox-fabric',
    },
  })
  if (response.status < 200 || response.status >= 300) throw new Error('github_profile_failed')
  if (response.body.includes(accessToken)) {
    throw new Error('github profile leaked a secret')
  }
  const parsed = parseJsonObject(response.body)
  const login = stringValue(parsed.login)
  const id = numberValue(parsed.id)
  const avatarUrl = stringValue(parsed.avatar_url)
  if (!login || id === undefined || !avatarUrl) throw new Error('github_profile_invalid_response')
  const name = stringValue(parsed.name)
  const profile: GithubProfile = { login, id, avatarUrl, ...(name ? { name } : {}) }
  if (JSON.stringify(profile).includes(accessToken)) {
    throw new Error('Import candidate leaked a secret')
  }
  return profile
}

/**
 * Device-flow link controller. `start` hands out the public codes only; `poll`
 * links the workspace on approval; `get` reads the recorded link for reload.
 */
export function createGithubDeviceLink(deps: {
  readonly http: GithubOAuthHttpClient
  readonly clientId: string
  readonly store: GithubLinkStore
  readonly start?: typeof startDeviceLogin
  readonly poll?: typeof pollDeviceLogin
  readonly fetchProfile?: typeof fetchGithubProfile
  readonly newId?: () => string
  readonly now?: () => number
}) {
  const flows = new Map<string, { deviceCode: string; polling: boolean; linking: boolean }>()
  const start = deps.start ?? startDeviceLogin
  const poll = deps.poll ?? pollDeviceLogin
  const fetchProfile = deps.fetchProfile ?? fetchGithubProfile
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID())
  const now = deps.now ?? Date.now
  return {
    async start(): Promise<GithubDeviceLinkStartView> {
      if (!deps.clientId) throw new Error('missing_client_id')
      const started = await start(deps.http, { clientId: deps.clientId, scope: 'read:user' })
      const flowId = newId()
      flows.set(flowId, { deviceCode: started.deviceCode, polling: false, linking: false })
      const view: GithubDeviceLinkStartView = {
        flowId,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        interval: started.interval,
        ...(started.expiresIn !== undefined ? { expiresIn: started.expiresIn } : {}),
      }
      assertNoLinkSecret(view)
      return view
    },
    async poll(input: { flowId: string; workspaceId: string }): Promise<GithubDeviceLinkPollView> {
      const flow = flows.get(input.flowId)
      if (!flow) throw new Error('unknown_flow')
      if (flow.polling || flow.linking) throw new Error('poll_in_progress')
      flow.polling = true
      let result: GithubDeviceLoginPollResult
      try {
        result = await poll(deps.http, { clientId: deps.clientId, deviceCode: flow.deviceCode })
      } finally {
        flow.polling = false
      }
      if (flows.get(input.flowId) !== flow) throw new Error('unknown_flow')
      if (result.status === 'approved') {
        flow.linking = true
        try {
          const profile = await fetchProfile(deps.http, result.accessToken)
          const record: GithubLinkProfileView = {
            githubLogin: profile.login,
            githubId: profile.id,
            avatarUrl: profile.avatarUrl,
            linkedAt: now(),
          }
          deps.store.set(input.workspaceId, record)
          const linked: GithubDeviceLinkPollView = { status: 'linked', profile: record }
          assertNoLinkSecret(linked, result.accessToken)
          return linked
        } finally {
          flows.delete(input.flowId)
        }
      }
      if (result.status === 'denied' || result.status === 'expired') {
        flows.delete(input.flowId)
        return { status: result.status }
      }
      const pending: GithubDeviceLinkPollView = {
        status: result.status,
        ...(result.interval !== undefined ? { interval: result.interval } : {}),
      }
      assertNoLinkSecret(pending)
      return pending
    },
    async get(input: { workspaceId: string }): Promise<GithubLinkProfileView | null> {
      return deps.store.get(input.workspaceId)
    },
  }
}

/** File-backed link store: one JSON map of workspaceId → profile. */
export function createFileGithubLinkStore(directory: string): GithubLinkStore {
  const file = join(directory, 'github-links.json')
  let cache: Record<string, GithubLinkProfileView> | null = null
  const read = (): Record<string, GithubLinkProfileView> => {
    if (cache) return cache
    let parsed: unknown = null
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      parsed = null
    }
    cache = parseLinkRecords(parsed)
    return cache
  }
  return {
    get(workspaceId) {
      return read()[workspaceId] ?? null
    },
    set(workspaceId, record) {
      const all = read()
      all[workspaceId] = record
      mkdirSync(directory, { recursive: true })
      const temp = `${file}.tmp`
      writeFileSync(temp, JSON.stringify(all, null, 2))
      renameSync(temp, file)
    },
  }
}

function parseLinkRecords(value: unknown): Record<string, GithubLinkProfileView> {
  if (!isJsonObject(value)) return {}
  const out: Record<string, GithubLinkProfileView> = {}
  for (const [workspaceId, raw] of Object.entries(value)) {
    if (!isJsonObject(raw)) continue
    const githubLogin = stringValue(raw.githubLogin)
    const githubId = numberValue(raw.githubId)
    const avatarUrl = stringValue(raw.avatarUrl)
    const linkedAt = numberValue(raw.linkedAt)
    if (!githubLogin || githubId === undefined || !avatarUrl || linkedAt === undefined) continue
    out[workspaceId] = { githubLogin, githubId, avatarUrl, linkedAt }
  }
  return out
}

function parseJsonObject(body: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body)
    return isJsonObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function assertNoLinkSecret(value: unknown, secret?: string): void {
  const json = JSON.stringify(value)
  if (
    /"access_token"\s*:/i.test(json)
    || /"accessToken"\s*:/i.test(json)
    || /"device_code"\s*:/i.test(json)
    || /"deviceCode"\s*:/i.test(json)
  ) {
    throw new Error('Import candidate leaked a secret')
  }
  if (secret && json.includes(secret)) throw new Error('Import candidate leaked a secret')
}

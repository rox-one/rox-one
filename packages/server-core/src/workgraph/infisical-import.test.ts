import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'bun:test'
import { CredentialRefRegistry } from '@craft-agent/core/platform'
import type { CredentialBackend } from '@craft-agent/shared/credentials'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'
import {
  credentialIdToAccount,
  InfisicalProviderError,
  type InfisicalHttpClient,
  type InfisicalHttpRequest,
  type InfisicalHttpResponse,
  LocalFileSecretProvider,
} from '@craft-agent/shared/credentials'

import { createWorkGraphKernel } from './index'
import { commitInfisicalImport, previewInfisicalAccount } from './infisical-import.ts'

const SECRET = 'super-secret-infisical-value'
const CLIENT_SECRET = 'test-client-secret'
const CLIENT_ID = 'test-client-id'
const ACCESS_TOKEN = 'test-access-token'
const SITE_URL = 'https://infisical.example.test'
const TENANT_PROJECT_ID = 'proj_test'
const ENVIRONMENT = 'prod'
const SECRET_PATH = '/github'
const SECRET_KEY = 'token'

const roots: string[] = []
const nativeIt = process.platform === 'darwin' && process.arch === 'arm64' ? it : it.skip

class MemoryBackend implements CredentialBackend {
  readonly name = 'memory'
  readonly priority = 1
  readonly store = new Map<string, StoredCredential>()
  async isAvailable(): Promise<boolean> { return true }
  async get(id: CredentialId): Promise<StoredCredential | null> {
    return this.store.get(credentialIdToAccount(id)) ?? null
  }
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    this.store.set(credentialIdToAccount(id), credential)
  }
  async delete(id: CredentialId): Promise<boolean> {
    return this.store.delete(credentialIdToAccount(id))
  }
  async list(): Promise<CredentialId[]> { return [] }
}

type SecretRecord = {
  projectId: string
  environment: string
  secretPath: string
  secretKey: string
  secretValue: string
  version: number
}

class FakeInfisical {
  readonly calls: InfisicalHttpRequest[] = []
  readonly secrets = new Map<string, SecretRecord>()
  fail: 'tls' | 'auth' | 'tenant' | undefined

  private keyOf(projectId: string, environment: string, secretPath: string, secretKey: string): string {
    return `${projectId}\0${environment}\0${secretPath}\0${secretKey}`
  }

  seed(): void {
    this.secrets.set(this.keyOf(TENANT_PROJECT_ID, ENVIRONMENT, SECRET_PATH, SECRET_KEY), {
      projectId: TENANT_PROJECT_ID,
      environment: ENVIRONMENT,
      secretPath: SECRET_PATH,
      secretKey: SECRET_KEY,
      secretValue: SECRET,
      version: 1,
    })
  }

  readonly http: InfisicalHttpClient = async (request) => {
    this.calls.push(request)
    if (this.fail === 'tls') {
      throw Object.assign(new Error('unable to verify the first certificate'), {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      })
    }

    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/api/v1/auth/universal-auth/login') {
      if (this.fail === 'auth') return json(401, { message: 'Unauthorized' })
      const body = parseBody(request.body)
      if (body.clientId !== CLIENT_ID || body.clientSecret !== CLIENT_SECRET) {
        return json(401, { message: 'Unauthorized' })
      }
      return json(200, { accessToken: ACCESS_TOKEN, tokenType: 'Bearer' })
    }

    const authorization = header(request, 'authorization')
    if (authorization !== `Bearer ${ACCESS_TOKEN}`) {
      return json(401, { message: 'Unauthorized' })
    }
    if (this.fail === 'auth') return json(401, { message: 'Unauthorized' })

    const workspaceMatch = url.pathname.match(/^\/api\/v1\/workspace\/([^/]+)$/)
    if (request.method === 'GET' && workspaceMatch) {
      const projectId = decodeURIComponent(workspaceMatch[1] ?? '')
      if (this.fail === 'tenant' || projectId !== TENANT_PROJECT_ID) {
        return json(403, { message: 'Project access denied' })
      }
      return json(200, { workspace: { id: projectId } })
    }

    const secretMatch = url.pathname.match(/^\/api\/v3\/secrets\/raw\/([^/]+)$/)
    if (secretMatch && request.method === 'GET') {
      const secretKey = decodeURIComponent(secretMatch[1] ?? '')
      const projectId = url.searchParams.get('workspaceId') ?? ''
      const environment = url.searchParams.get('environment') ?? ''
      const secretPath = url.searchParams.get('secretPath') ?? ''
      if (this.fail === 'tenant' || projectId !== TENANT_PROJECT_ID) {
        return json(403, { message: 'Tenant project mismatch' })
      }
      const record = this.secrets.get(this.keyOf(projectId, environment, secretPath, secretKey))
      if (!record) return json(404, { message: 'Secret not found' })
      return json(200, {
        secret: {
          workspace: record.projectId,
          environment: record.environment,
          secretPath: record.secretPath,
          secretKey: record.secretKey,
          secretValue: record.secretValue,
          version: record.version,
        },
      })
    }

    return json(404, { message: 'Not found' })
  }
}

function json(status: number, body: unknown): InfisicalHttpResponse {
  return { status, body: JSON.stringify(body) }
}

function parseBody(body: string | undefined): Record<string, unknown> {
  if (!body) return {}
  try {
    const parsed: unknown = JSON.parse(body)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function header(request: InfisicalHttpRequest, name: string): string | undefined {
  if (!request.headers) return undefined
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === target) return value
  }
  return undefined
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CF Infisical native import', () => {
  it('previewInfisicalAccount returns locator metadata without clientSecret', () => {
    const preview = previewInfisicalAccount({
      siteUrl: SITE_URL,
      clientId: CLIENT_ID,
      projectId: TENANT_PROJECT_ID,
      environment: ENVIRONMENT,
      secretPath: SECRET_PATH,
      secretKey: SECRET_KEY,
      clientSecret: CLIENT_SECRET,
    })
    expect(preview.label).toBe('Infisical')
    expect(preview.locator).toEqual({
      type: 'infisical',
      projectId: TENANT_PROJECT_ID,
      environment: ENVIRONMENT,
      secretPath: SECRET_PATH,
      secretKey: SECRET_KEY,
    })
    expect(JSON.stringify(preview)).not.toContain(CLIENT_SECRET)
    expect(preview).not.toHaveProperty('clientSecret')
    expect(preview).not.toHaveProperty('secretValue')
  })

  it('previewInfisicalAccount rejects non-https siteUrl as tls', () => {
    expect(() => previewInfisicalAccount({
      siteUrl: 'http://infisical.example.test',
      clientId: CLIENT_ID,
      projectId: TENANT_PROJECT_ID,
      environment: ENVIRONMENT,
      secretPath: SECRET_PATH,
      secretKey: SECRET_KEY,
    })).toThrow(InfisicalProviderError)
    try {
      previewInfisicalAccount({
        siteUrl: 'http://infisical.example.test',
        clientId: CLIENT_ID,
        projectId: TENANT_PROJECT_ID,
        environment: ENVIRONMENT,
        secretPath: SECRET_PATH,
        secretKey: SECRET_KEY,
      })
    } catch (error) {
      expect(error).toMatchObject({ code: 'tls' })
    }
  })

  nativeIt('commitInfisicalImport stores a reference Connection after inspect succeeds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-infisical-import-'))
    roots.push(root)
    const fake = new FakeInfisical()
    fake.seed()
    const registry = new CredentialRefRegistry()
    const backend = new MemoryBackend()
    const provider = new LocalFileSecretProvider(backend, registry)
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()

    const connection = await commitInfisicalImport({
      siteUrl: SITE_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      projectId: TENANT_PROJECT_ID,
      environment: ENVIRONMENT,
      secretPath: SECRET_PATH,
      secretKey: SECRET_KEY,
      http: fake.http,
      registry,
      provider,
      kernel,
      workspaceId: 'workspace_a',
      requestedBy: 'owner',
    })

    expect(connection.integrationId).toBe('infisical')
    expect(connection.storageMode).toBe('reference')
    expect(connection.credentialRefId).toMatch(/^cred_/)
    expect(JSON.stringify(connection)).not.toContain(CLIENT_SECRET)
    expect(JSON.stringify(connection)).not.toContain(SECRET)
    expect(JSON.stringify(connection)).not.toContain(ACCESS_TOKEN)

    const ref = registry.get(connection.credentialRefId)
    expect(ref?.providerId).toBe('infisical')
    expect(ref?.locator).toEqual({
      type: 'infisical',
      projectId: TENANT_PROJECT_ID,
      environment: ENVIRONMENT,
      secretPath: SECRET_PATH,
      secretKey: SECRET_KEY,
    })
    // Reference import must not copy the secret into the local provider backend.
    expect(backend.store.size).toBe(0)
    expect(fake.calls.some((call) => call.url.includes('/api/v1/auth/universal-auth/login'))).toBe(true)
    expect(fake.calls.every((call) => call.url.startsWith(`${SITE_URL}/`))).toBe(true)
    for (const call of fake.calls) {
      expect(call.url).not.toContain(CLIENT_SECRET)
      expect(call.url).not.toContain(SECRET)
    }
    await kernel.close()
  })

  nativeIt('commitInfisicalImport fails closed on auth and does not create a connection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-infisical-auth-'))
    roots.push(root)
    const fake = new FakeInfisical()
    fake.seed()
    fake.fail = 'auth'
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    await expect(commitInfisicalImport({
      siteUrl: SITE_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      projectId: TENANT_PROJECT_ID,
      environment: ENVIRONMENT,
      secretPath: SECRET_PATH,
      secretKey: SECRET_KEY,
      http: fake.http,
      kernel,
      workspaceId: 'workspace_a',
      requestedBy: 'owner',
    })).rejects.toMatchObject({ code: 'auth' })
    expect(await kernel.listConnections('workspace_a')).toEqual([])
    await kernel.close()
  })

  it('commitInfisicalImport fails closed on tls before any network call', async () => {
    const fake = new FakeInfisical()
    fake.seed()
    const kernel = {
      async createConnection() {
        throw new Error('should not create')
      },
      async bindConsumer() {
        throw new Error('should not bind')
      },
    }
    await expect(commitInfisicalImport({
      siteUrl: 'http://infisical.example.test',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      projectId: TENANT_PROJECT_ID,
      environment: ENVIRONMENT,
      secretPath: SECRET_PATH,
      secretKey: SECRET_KEY,
      http: fake.http,
      kernel,
      workspaceId: 'workspace_a',
      requestedBy: 'owner',
    })).rejects.toMatchObject({ code: 'tls' })
    expect(fake.calls).toEqual([])
  })
})

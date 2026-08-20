import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'bun:test'
import { CredentialRefRegistry } from '@craft-agent/core/platform'
import type { CredentialBackend } from '@craft-agent/shared/credentials'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'
import {
  credentialIdToAccount,
  InProcessCredentialBroker,
  LocalFileSecretProvider,
  maskSecret,
} from '@craft-agent/shared/credentials'

import { createWorkGraphKernel } from './index'
import { commitGithubOAuthImport, createGithubDeviceFlow, previewGithubOAuthImport } from './github-oauth-import.ts'

const ACCESS_TOKEN = 'gho_super-secret-oauth-token'
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

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CF GitHub OAuth import (workgraph)', () => {
  it('previews GitHub OAuth without leaking the access token', async () => {
    const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry())
    const preview = await previewGithubOAuthImport({ accessToken: ACCESS_TOKEN, provider })
    expect(preview.label).toBe('GitHub OAuth')
    expect(preview.maskedSummary).toBe(maskSecret(ACCESS_TOKEN))
    expect(JSON.stringify(preview)).not.toContain(ACCESS_TOKEN)
    expect(preview).not.toHaveProperty('accessToken')
    expect(preview).not.toHaveProperty('value')
  })

  nativeIt('commits a github Connection and grants without exposing the token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-gh-oauth-'))
    roots.push(root)
    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id))
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    const connection = await commitGithubOAuthImport({
      accessToken: ACCESS_TOKEN,
      provider,
      kernel,
      broker,
      workspaceId: 'workspace_a',
      requestedBy: 'owner',
    })
    expect(connection.integrationId).toBe('github')
    expect(connection.storageMode).toBe('copy')
    expect(connection.credentialRefId).toMatch(/^cred_/)
    expect(JSON.stringify(connection)).not.toContain(ACCESS_TOKEN)

    const lease = await broker.acquireLease({
      credentialRef: connection.credentialRefId,
      consumer: { kind: 'human', id: 'owner', workspaceId: 'workspace_a' },
      purpose: 'github.user',
      action: 'github.api',
      resources: ['github:user'],
      audience: 'local-broker',
      ttl: 5_000,
    })
    expect(lease.status).toBe('active')
    expect(lease).not.toHaveProperty('payload')
    expect(JSON.stringify(lease)).not.toContain(ACCESS_TOKEN)
    await kernel.close()
  })

  it('starts device login without returning device code or access token', async () => {
    const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry())
    const flow = createGithubDeviceFlow({
      http: async () => ({
        status: 200,
        body: JSON.stringify({
          device_code: 'hidden-device-code',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          interval: 5,
          expires_in: 900,
        }),
      }),
      clientId: 'client',
      provider,
      kernel: { createConnection: async () => { throw new Error('unused') }, bindConsumer: async () => { throw new Error('unused') } },
      newId: () => 'flow_1',
    })
    const started = await flow.start()
    expect(started).toEqual({
      flowId: 'flow_1',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      interval: 5,
      expiresIn: 900,
    })
    expect(JSON.stringify(started)).not.toContain('hidden-device-code')
    expect(JSON.stringify(started)).not.toContain(ACCESS_TOKEN)
    expect(started).not.toHaveProperty('accessToken')
    expect(started).not.toHaveProperty('deviceCode')
  })

  it('polls pending without leaking a bearer', async () => {
    const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry())
    let calls = 0
    const flow = createGithubDeviceFlow({
      http: async () => {
        calls += 1
        if (calls === 1) {
          return {
            status: 200,
            body: JSON.stringify({
              device_code: 'hidden-device-code',
              user_code: 'ABCD-1234',
              verification_uri: 'https://github.com/login/device',
              interval: 5,
            }),
          }
        }
        return { status: 200, body: JSON.stringify({ error: 'authorization_pending' }) }
      },
      clientId: 'client',
      provider,
      kernel: { createConnection: async () => { throw new Error('unused') }, bindConsumer: async () => { throw new Error('unused') } },
      newId: () => 'flow_1',
    })
    await flow.start()
    const polled = await flow.poll({ flowId: 'flow_1', workspaceId: 'workspace_a' })
    expect(polled.status).toBe('pending')
    expect(JSON.stringify(polled)).not.toContain(ACCESS_TOKEN)
    expect(JSON.stringify(polled)).not.toContain('hidden-device-code')
  })

  it('fails closed without a GitHub OAuth client id', async () => {
    const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry())
    const flow = createGithubDeviceFlow({
      http: async () => {
        throw new Error('http_should_not_run')
      },
      clientId: '',
      provider,
      kernel: { createConnection: async () => { throw new Error('unused') }, bindConsumer: async () => { throw new Error('unused') } },
    })
    await expect(flow.start()).rejects.toThrow(/missing_client_id/)
  })

  it('imports on approved poll without leaking the access token or device code', async () => {
    const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry())
    let calls = 0
    const flow = createGithubDeviceFlow({
      http: async () => {
        calls += 1
        if (calls === 1) {
          return {
            status: 200,
            body: JSON.stringify({
              device_code: 'hidden-device-code',
              user_code: 'ABCD-1234',
              verification_uri: 'https://github.com/login/device',
              interval: 5,
            }),
          }
        }
        return {
          status: 200,
          body: JSON.stringify({ access_token: ACCESS_TOKEN, token_type: 'bearer', scope: 'read:user' }),
        }
      },
      clientId: 'client',
      provider,
      kernel: {
        createConnection: async (input) => ({
          id: 'conn_1',
          workspaceId: input.workspaceId,
          integrationId: input.integrationId,
          credentialRefId: input.credentialRefId,
          storageMode: input.storageMode,
          scopes: input.scopes ?? [],
          createdAt: 1,
          updatedAt: 1,
        }),
        bindConsumer: async () => ({ id: 'bind_1' }),
      },
      newId: () => 'flow_1',
    })
    await flow.start()
    const polled = await flow.poll({ flowId: 'flow_1', workspaceId: 'workspace_a' })
    expect(polled).toEqual({ status: 'imported', connectionId: 'conn_1' })
    expect(JSON.stringify(polled)).not.toContain(ACCESS_TOKEN)
    expect(JSON.stringify(polled)).not.toContain('hidden-device-code')
    expect(polled).not.toHaveProperty('accessToken')
    expect(polled).not.toHaveProperty('deviceCode')
  })

  it('cancels a device flow so later polls fail closed', async () => {
    const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry())
    const flow = createGithubDeviceFlow({
      http: async () => ({
        status: 200,
        body: JSON.stringify({
          device_code: 'hidden-device-code',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          interval: 5,
        }),
      }),
      clientId: 'client',
      provider,
      kernel: { createConnection: async () => { throw new Error('unused') }, bindConsumer: async () => { throw new Error('unused') } },
      newId: () => 'flow_1',
    })
    await flow.start()
    const cancelled = await flow.cancel('flow_1')
    expect(cancelled).toEqual({ cancelled: true })
    expect(JSON.stringify(cancelled)).not.toContain('hidden-device-code')
    expect(cancelled).not.toHaveProperty('deviceCode')
    expect(cancelled).not.toHaveProperty('accessToken')
    await expect(flow.poll({ flowId: 'flow_1', workspaceId: 'workspace_a' })).rejects.toThrow(/unknown_flow/)
  })

  it('cancels an unknown device flow without leaking a bearer', async () => {
    const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry())
    const flow = createGithubDeviceFlow({
      http: async () => ({ status: 500, body: '' }),
      clientId: 'client',
      provider,
      kernel: { createConnection: async () => { throw new Error('unused') }, bindConsumer: async () => { throw new Error('unused') } },
    })
    const cancelled = await flow.cancel('missing')
    expect(cancelled).toEqual({ cancelled: true })
    expect(cancelled).not.toHaveProperty('deviceCode')
    expect(cancelled).not.toHaveProperty('accessToken')
    await expect(flow.poll({ flowId: 'missing', workspaceId: 'workspace_a' })).rejects.toThrow(/unknown_flow/)
  })
})

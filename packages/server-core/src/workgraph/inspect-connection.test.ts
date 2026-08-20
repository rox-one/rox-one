import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'bun:test'
import { CredentialRefRegistry } from '@craft-agent/core/platform'
import type { CredentialBackend } from '@craft-agent/shared/credentials'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'
import { credentialIdToAccount } from '@craft-agent/shared/credentials'
import { LocalFileSecretProvider } from '@craft-agent/shared/credentials'

import { createWorkGraphKernel } from './index'
import { inspectConnectionMetadata } from './inspect-connection.ts'

const roots: string[] = []
const nativeIt = process.platform === 'darwin' && process.arch === 'arm64' ? it : it.skip

class MemoryBackend implements CredentialBackend {
  constructor(readonly name = 'memory') {}
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

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-workgraph-inspect-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('inspectConnectionMetadata', () => {
  nativeIt('returns health, expiry, provenance, and fingerprint without the payload', async () => {
    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const expiresAt = Date.UTC(2027, 0, 15)
    const written = await provider.write({
      kind: 'bearer_token',
      locator: { type: 'local', key: 'github/default' },
      payload: { value: 'super-secret' },
      expiresAt,
    })
    const kernel = createWorkGraphKernel({
      configDir: createRoot(),
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    const connection = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: written.ref.id,
      storageMode: 'copy',
    })

    const inspected = await inspectConnectionMetadata({
      kernel,
      provider,
      workspaceId: 'workspace_a',
      connectionId: connection.id,
    })

    expect(inspected.connectionId).toBe(connection.id)
    expect(inspected.credentialRefId).toBe(written.ref.id)
    expect(inspected.health).toBe('healthy')
    expect(inspected.expiry).toBe(new Date(expiresAt).toISOString())
    expect(inspected.provenance).toBe('local-file/memory')
    expect(inspected.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(inspected.kind).toBe('bearer_token')
    expect(inspected.versionId).toMatch(/^ver_/)
    expect(JSON.stringify(inspected)).not.toContain('super-secret')
    expect(JSON.stringify(inspected)).not.toMatch(/"token"|"secret"|"payload"|"value"/i)
    await kernel.close()
  })

  nativeIt('marks a missing copy as missing without leaking fields', async () => {
    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const written = await provider.write({
      kind: 'bearer_token',
      locator: { type: 'local', key: 'github/default' },
      payload: { value: 'super-secret' },
    })
    await provider.dropCopy(written.ref)
    const kernel = createWorkGraphKernel({
      configDir: createRoot(),
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    const connection = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: written.ref.id,
      storageMode: 'reference',
    })
    const inspected = await inspectConnectionMetadata({
      kernel,
      provider,
      workspaceId: 'workspace_a',
      connectionId: connection.id,
    })
    expect(inspected.health).toBe('missing')
    expect(inspected.expiry).toBe('—')
    expect(inspected.provenance).toBe('local-file/—')
    expect(JSON.stringify(inspected)).not.toContain('super-secret')
    await kernel.close()
  })

  nativeIt('rejects an unknown connection', async () => {
    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const kernel = createWorkGraphKernel({
      configDir: createRoot(),
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    await expect(inspectConnectionMetadata({
      kernel,
      provider,
      workspaceId: 'workspace_a',
      connectionId: 'missing-connection',
    })).rejects.toThrow(/not found/i)
    await kernel.close()
  })
})

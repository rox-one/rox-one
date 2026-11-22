/**
 * Provider images: Daytona snapshots mapped to the contract and served by the
 * API route through the customer's own key or the platform key.
 */

import { describe, expect, test } from 'bun:test'

import type { ProviderImage, SandboxProvider } from '../../../../packages/cloud-runner/src/sandbox.ts'
import { createDaytonaProvider } from '../../../../packages/providers/src/daytona.ts'
import { createApp } from '../app.ts'
import type { CloudApp, DeclaredCapabilities } from '../app.ts'
import { generateApiKey } from '../auth.ts'
import { createMemoryStore, nextId } from '../store.ts'

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)
const API_URL = 'https://daytona.test/api'
const KEY = 'dt_super_secret_key_9876'

const CAPS: DeclaredCapabilities = {
  id: 'daytona',
  os: ['linux', 'windows'],
  gpu: true,
  pause: true,
  snapshot: true,
  volume: true,
  streaming: 'none',
  maxTtlSec: 86_400,
  regions: ['us', 'us-west-4'],
}

function daytonaFetch(items: unknown[], status = 200): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    expect(url).toBe(`${API_URL}/snapshots`)
    return new Response(JSON.stringify({ items }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

describe('Daytona snapshots', () => {
  test('maps active snapshots and drops the rest', async () => {
    const provider = createDaytonaProvider({
      id: 'daytona',
      apiUrl: API_URL,
      apiKey: KEY,
      fetch: daytonaFetch([
        { id: 'snap-1', name: 'daytona-medium', state: 'active', cpu: 2, mem: 4, disk: 8 },
        {
          id: 'snap-2',
          name: 'windows-large',
          state: 'active',
          cpu: 4,
          mem: 16,
          disk: 50,
          windowsBuild: '10',
        },
        {
          id: 'snap-3',
          name: 'daytona-gpu',
          state: 'active',
          cpu: 16,
          mem: 100,
          disk: 400,
          gpuType: 'h100',
          gpuCount: 1,
        },
        { id: 'snap-4', name: 'building-one', state: 'building', cpu: 1, mem: 1, disk: 3 },
      ]),
      now: () => NOW,
    })

    const images = await provider.listImages?.()
    expect(images).toHaveLength(3)
    expect(images?.[0]).toMatchObject({
      id: 'snap-1',
      name: 'daytona-medium',
      os: 'linux',
      cpu: 2,
      memoryGb: 4,
      diskGb: 8,
      state: 'active',
    })
    expect(images?.[0]?.gpu).toBeUndefined()
    expect(images?.[1]).toMatchObject({ os: 'windows', cpu: 4, memoryGb: 16, diskGb: 50 })
    expect(images?.[2]?.gpu).toEqual({ type: 'h100', count: 1 })
    expect(images?.[2]?.label).toContain('H100')
  })

  test('a failed list is provider_error and never leaks the key', async () => {
    const provider = createDaytonaProvider({
      id: 'daytona',
      apiUrl: API_URL,
      apiKey: KEY,
      fetch: daytonaFetch([], 500),
      now: () => NOW,
    })
    let caught: unknown
    try {
      await provider.listImages?.()
    } catch (error) {
      caught = error
    }
    expect((caught as { code?: string }).code).toBe('provider_error')
    expect((caught as Error).message).not.toContain(KEY)
  })
})

class ImageProvider implements SandboxProvider {
  readonly providerId = 'daytona'
  readonly images: ProviderImage[] = [
    {
      id: 'daytona-medium',
      name: 'daytona-medium',
      label: 'Linux · 2 CPU · 4 ГБ',
      os: 'linux',
      cpu: 2,
      memoryGb: 4,
      diskGb: 8,
      state: 'active',
    },
  ]
  async listImages(): Promise<ProviderImage[]> {
    return this.images
  }
  async create(): Promise<never> {
    throw new Error('not used')
  }
  async get(): Promise<never> {
    throw new Error('not used')
  }
  async exec(): Promise<never> {
    throw new Error('not used')
  }
  async readFile(): Promise<never> {
    throw new Error('not used')
  }
  async writeFile(): Promise<void> {}
  async stop(): Promise<void> {}
  async destroy(): Promise<void> {}
}

function harness(mode: 'byok' | 'managed') {
  const store = createMemoryStore()
  const tenant = store.addTenant('Images Co')
  const generated = generateApiKey()
  store.addApiKey({
    id: nextId('key_'),
    tenantId: tenant.id,
    prefix: generated.prefix,
    last4: generated.last4,
    hash: generated.hash,
    scopes: ['sandboxes:read'],
    createdAt: NOW,
  })
  const provider = new ImageProvider()
  const app = createApp({
    store,
    resolveProvider: () => provider,
    resolveLease: () => ({ provider, mode }),
    listCapabilities: () => [CAPS],
    defaultProvider: 'daytona',
    now: () => NOW,
  })
  return { app, secret: generated.secret }
}

describe('GET /v1/providers/:id/images', () => {
  test('returns the images with the mode that answered', async () => {
    const { app, secret } = harness('byok')
    const response = await app.handle(
      new Request('http://api.test/v1/providers/daytona/images', {
        headers: { authorization: `Bearer ${secret}` },
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      object: string
      provider: string
      mode: string
      data: Array<{ id: string; label: string; cpu: number; gpu: null }>
    }
    expect(body).toMatchObject({ object: 'list', provider: 'daytona', mode: 'byok' })
    expect(body.data[0]).toMatchObject({
      id: 'daytona-medium',
      label: 'Linux · 2 CPU · 4 ГБ',
      cpu: 2,
      gpu: null,
    })
  })

  test('reports managed when the platform key answered', async () => {
    const { app, secret } = await harness('managed')
    const response = await app.handle(
      new Request('http://api.test/v1/providers/daytona/images', {
        headers: { authorization: `Bearer ${secret}` },
      }),
    )
    expect(((await response.json()) as { mode: string }).mode).toBe('managed')
  })

  test('an unknown provider is 400 and a key is required', async () => {
    const { app, secret } = harness('byok')
    const unknown = await app.handle(
      new Request('http://api.test/v1/providers/modal/images', {
        headers: { authorization: `Bearer ${secret}` },
      }),
    )
    expect(unknown.status).toBe(400)
    const anonymous = await app.handle(new Request('http://api.test/v1/providers/daytona/images'))
    expect(anonymous.status).toBe(401)
  })
})

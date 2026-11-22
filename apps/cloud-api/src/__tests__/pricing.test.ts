/**
 * Priced machines: the quote comes from the resolved image and the payer mode,
 * never from numbers the caller invented next to a snapshot.
 */

import { describe, expect, test } from 'bun:test'

import { DEFAULT_PRODUCTS } from '../../../../packages/cloud-pricing/src/index.ts'
import type {
  ProviderImage,
  SandboxExecResult,
  SandboxProvider,
  SandboxSpec,
  SandboxStatus,
} from '../../../../packages/cloud-runner/src/sandbox.ts'
import { createApp, DEFAULT_PRICE_SHEET } from '../app.ts'
import type { CloudApp, DeclaredCapabilities, ProviderLease } from '../app.ts'
import { generateApiKey } from '../auth.ts'
import { createMemoryStore, nextId } from '../store.ts'

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)

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

const IMAGES: ProviderImage[] = [
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
  {
    id: 'daytona-gpu',
    name: 'daytona-gpu',
    os: 'linux',
    cpu: 16,
    memoryGb: 100,
    diskGb: 400,
    gpu: { type: 'h100', count: 1 },
    state: 'active',
  },
]

class FakeProvider implements SandboxProvider {
  readonly providerId = 'daytona'
  readonly created: SandboxSpec[] = []
  async listImages(): Promise<ProviderImage[]> {
    return IMAGES
  }
  async create(spec: SandboxSpec): Promise<SandboxStatus> {
    this.created.push(spec)
    return { id: spec.id, provider: this.providerId, state: 'running', createdAt: NOW }
  }
  async get(id: string): Promise<SandboxStatus> {
    return { id, provider: this.providerId, state: 'running', createdAt: NOW }
  }
  async exec(): Promise<SandboxExecResult> {
    return { stdout: '', stderr: '', exitCode: 0 }
  }
  async readFile(): Promise<Uint8Array> {
    return new Uint8Array()
  }
  async writeFile(): Promise<void> {}
  async stop(): Promise<void> {}
  async destroy(): Promise<void> {}
}

interface Harness {
  app: CloudApp
  secret: string
  provider: FakeProvider
  created: () => SandboxSpec[]
}

function harness(mode: 'byok' | 'managed', withPricing = true): Harness {
  const store = createMemoryStore()
  const tenant = store.addTenant('Pricing Co')
  const generated = generateApiKey()
  store.addApiKey({
    id: nextId('key_'),
    tenantId: tenant.id,
    prefix: generated.prefix,
    last4: generated.last4,
    hash: generated.hash,
    // The invoice test reads `/v1/usage`, which needs `billing:read`; the
    // machine itself still needs only the sandbox scopes.
    scopes: ['sandboxes:read', 'sandboxes:write', 'billing:read'],
    createdAt: NOW,
  })
  const provider = new FakeProvider()
  const lease: ProviderLease = { provider, mode }
  const app = createApp({
    store,
    resolveProvider: () => provider,
    resolveLease: () => lease,
    listCapabilities: () => [CAPS],
    defaultProvider: 'daytona',
    ...(withPricing ? { pricing: DEFAULT_PRICE_SHEET } : {}),
    now: () => NOW,
  })
  return { app, secret: generated.secret, provider, created: () => provider.created }
}

interface Billing {
  mode: string
  rate_cents_per_hour: number | null
  retail_cents_per_hour: number | null
  service_fee_cents_per_hour: number | null
}

async function create(h: Harness, body: unknown): Promise<Response> {
  return h.app.handle(
    new Request('http://api.test/v1/sandboxes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${h.secret}`,
        'content-type': 'application/json',
        'idempotency-key': `key-${Math.random()}`,
      },
      body: JSON.stringify(body),
    }),
  )
}

describe('priced creation', () => {
  test('a managed product is sold at retail and reported with the fee', async () => {
    const h = harness('managed')
    const response = await create(h, { product: 'linux-pro' })
    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      spec: { cpu: number; memoryGb: number; snapshot: string }
      billing: Billing
    }
    expect(body.spec).toMatchObject({ cpu: 2, memoryGb: 4, snapshot: 'rox-cloud-medium-2x4' })
    expect(body.billing).toEqual({
      mode: 'managed',
      rate_cents_per_hour: 36,
      retail_cents_per_hour: 36,
      service_fee_cents_per_hour: 5,
    })
    expect(h.created()[0]).toMatchObject({ cpu: 2, memoryGb: 4, snapshot: 'rox-cloud-medium-2x4' })
  })

  test('the same product on the customer key is sold at the service fee only', async () => {
    const h = harness('byok')
    const body = (await (await create(h, { product: 'linux-large' })).json()) as { billing: Billing }
    expect(body.billing).toEqual({
      mode: 'byok',
      rate_cents_per_hour: 9,
      retail_cents_per_hour: 60,
      service_fee_cents_per_hour: 9,
    })
  })

  test('every sellable catalog product costs what the package says', async () => {
    for (const product of DEFAULT_PRODUCTS.filter((entry) => entry.available !== false)) {
      const h = harness('managed')
      const body = (await (await create(h, { product: product.id })).json()) as { billing: Billing }
      expect({ id: product.id, rate: body.billing.rate_cents_per_hour }).toEqual({
        id: product.id,
        rate: product.centsPerHour,
      })
    }
  })

  test('a GPU snapshot is priced at 786 even when one core is asked for', async () => {
    const h = harness('managed')
    const spoof = await create(h, { snapshot: 'daytona-gpu', cpu: 1 })
    expect(spoof.status).toBe(400)
    expect(((await spoof.json()) as { error: { code: string } }).error.code).toBe('invalid_request')
    expect(h.created()).toHaveLength(0)

    const honest = await create(h, { snapshot: 'daytona-gpu' })
    expect(honest.status).toBe(201)
    const body = (await honest.json()) as { billing: Billing; spec: { cpu: number } }
    expect(body.spec.cpu).toBe(16)
    expect(body.billing.rate_cents_per_hour).toBe(786)
    expect(body.billing.retail_cents_per_hour).toBe(786)
  })

  test('a product this account cannot boot is refused with the vendor reason', async () => {
    const h = harness('managed')
    const windows = await create(h, { product: 'windows-pro' })
    expect(windows.status).toBe(400)
    const windowError = (await windows.json()) as { error: { code: string; message: string } }
    expect(windowError.error.code).toBe('capability_unavailable')
    expect(windowError.error.message).toContain('Windows')

    const gpu = await create(h, { product: 'gpu-h100' })
    expect(gpu.status).toBe(400)
    const gpuError = (await gpu.json()) as { error: { code: string; message: string } }
    expect(gpuError.error.code).toBe('capability_unavailable')
    expect(gpuError.error.message).toContain('GPU')
    // Nothing booted, nothing held: the provider was never asked.
    expect(h.created()).toHaveLength(0)
  })

  test('an unknown product or snapshot is refused before any reservation', async () => {
    const h = harness('managed')
    expect((await create(h, { product: 'windows-max' })).status).toBe(400)
    expect((await create(h, { snapshot: 'nope' })).status).toBe(400)
    expect(h.created()).toHaveLength(0)
  })

  test('the region travels into the spec and the answer', async () => {
    const h = harness('managed')
    const body = (await (await create(h, { product: 'linux-start', region: 'us-west-4' })).json()) as {
      region: string
      spec: { region: string }
    }
    expect(body.region).toBe('us-west-4')
    expect(body.spec.region).toBe('us-west-4')
    expect(h.created()[0]?.region).toBe('us-west-4')

    const bad = await create(h, { product: 'linux-start', region: 'mars' })
    expect(bad.status).toBe(400)
  })

  test('without a price list the old flat rate and byok mode stay', async () => {
    const h = harness('byok', false)
    const body = (await (await create(h, { os: 'linux', cpu: 1, memoryGb: 1 })).json()) as {
      billing: Billing
    }
    expect(body.billing).toEqual({
      mode: 'byok',
      rate_cents_per_hour: null,
      retail_cents_per_hour: null,
      service_fee_cents_per_hour: null,
    })
  })
})


describe('invoice after delete', () => {
  test('the usage line keeps the composition, mode and rate after the machine is gone', async () => {
    const h = harness('managed')
    const created = (await (await create(h, { product: 'linux-pro', region: 'us' })).json()) as {
      id: string
    }
    const deleted = await h.app.handle(
      new Request(`http://api.test/v1/sandboxes/${created.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${h.secret}` },
      }),
    )
    expect(deleted.status).toBe(204)

    const usage = await h.app.handle(
      new Request('http://api.test/v1/usage', { headers: { authorization: `Bearer ${h.secret}` } }),
    )
    expect(usage.status).toBe(200)
    const body = (await usage.json()) as {
      data: Array<{
        ref: string
        label: string | null
        snapshot: string | null
        billing_mode: string
        rate_cents_per_hour: number | null
        retail_cents_per_hour: number | null
        service_fee_cents_per_hour: number | null
      }>
    }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      ref: created.id,
      label: 'Стандарт',
      snapshot: 'rox-cloud-medium-2x4',
      billing_mode: 'managed',
      rate_cents_per_hour: 36,
      retail_cents_per_hour: 36,
      service_fee_cents_per_hour: 5,
    })
  })
})

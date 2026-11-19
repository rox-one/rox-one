/**
 * Contract tests for the public demo front door.
 *
 * The demo has no API key and no wallet, so what has to be proven here is the
 * guard rails: one run per address per day, a machine that always goes away, a
 * closed door when the demo tenant has no credential, and an answer that never
 * carries a provider id or a secret.
 */

import { describe, expect, test } from 'bun:test'

import type {
  SandboxExecResult,
  SandboxProvider,
  SandboxSpec,
  SandboxStatus,
} from '../../../../packages/cloud-runner/src/sandbox.ts'
import { CloudRunnerError } from '../../../../packages/cloud-runner/src/types.ts'
import { createDemo } from '../demo.ts'
import type { DemoApp } from '../demo.ts'
import { createMemoryStore } from '../store.ts'

// ============================================================
// Fixtures
// ============================================================

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)
const TENANT_ID = 'ten_demo'
const RATE = 6000

class FakeProvider implements SandboxProvider {
  readonly providerId = 'daytona'
  readonly created: SandboxSpec[] = []
  readonly destroyed: string[] = []
  readonly alive = new Set<string>()
  failExec = false

  async create(spec: SandboxSpec): Promise<SandboxStatus> {
    this.created.push(spec)
    this.alive.add(spec.id)
    return { id: spec.id, provider: this.providerId, state: 'running', createdAt: NOW }
  }

  async get(id: string): Promise<SandboxStatus> {
    if (!this.alive.has(id)) throw new CloudRunnerError('unknown sandbox', 'not_found')
    return { id, provider: this.providerId, state: 'running', createdAt: NOW }
  }

  async exec(id: string, command: string): Promise<SandboxExecResult> {
    if (this.failExec) throw new CloudRunnerError('exec failed at provider', 'provider_error')
    if (!this.alive.has(id)) throw new CloudRunnerError('unknown sandbox', 'not_found')
    return { stdout: `выполнено: ${command}`, stderr: '', exitCode: 0 }
  }

  async readFile(): Promise<Uint8Array> {
    throw new CloudRunnerError('no files in the demo', 'not_found')
  }

  async writeFile(): Promise<void> {
    throw new CloudRunnerError('read-only demo', 'capability_unavailable')
  }

  async stop(id: string): Promise<void> {
    this.alive.delete(id)
  }

  async destroy(id: string): Promise<void> {
    this.alive.delete(id)
    this.destroyed.push(id)
  }
}

interface Harness {
  demo: DemoApp
  provider: FakeProvider
  usageCents: () => number
}

interface HarnessOptions {
  /** Return null to model a demo tenant without a provider credential. */
  withCredential?: boolean
  /** Clock advanced by this many milliseconds on every read. */
  stepMs?: number
}

function harness(options: HarnessOptions = {}): Harness {
  const store = createMemoryStore()
  const provider = new FakeProvider()
  const withCredential = options.withCredential ?? true
  let clock = NOW
  const demo = createDemo({
    store,
    tenantId: TENANT_ID,
    rateCentsPerHour: RATE,
    resolveProvider: (_tenantId, providerId) =>
      withCredential && providerId === 'daytona' ? provider : null,
    now: () => {
      const at = clock
      clock += options.stepMs ?? 0
      return at
    },
  })
  return {
    demo,
    provider,
    usageCents: () => store.usage.reduce((sum, row) => sum + row.cents, 0),
  }
}

interface DemoBody {
  stdout: string
  stderr: string
  exit_code: number
  cost_cents: number
  sandbox_id: string
}

interface DemoErrorBody {
  error: { type: string; code: string; message: string; request_id: string }
}

interface PostOptions {
  body?: unknown
  ip?: string
  method?: string
  headers?: Record<string, string>
}

function post(demo: DemoApp, options: PostOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers }
  const ip = options.ip ?? '203.0.113.7'
  if (ip.length > 0) headers['x-forwarded-for'] = ip
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  if (body !== undefined) headers['content-type'] = 'application/json'
  return demo.handle(
    new Request('http://api.test/v1/demo', { method: options.method ?? 'POST', headers, body }),
  )
}

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

// ============================================================
// The happy path
// ============================================================

describe('a visitor runs one command', () => {
  test('the answer carries stdout, a zero exit code, one sandbox id and a positive price', async () => {
    // A minute of wall clock at 6000 cents per hour is 6000 / 60 = 100 cents.
    const { demo, provider, usageCents } = harness({ stepMs: 60_000 })
    const response = await post(demo, { body: { command: 'print("привет")' } })
    expect(response.status).toBe(200)
    const body = await bodyOf<DemoBody>(response)

    expect(body.stdout).toBe('выполнено: print("привет")')
    expect(body.stderr).toBe('')
    expect(body.exit_code).toBe(0)
    expect(body.cost_cents).toBe(100)
    expect(body.sandbox_id.startsWith('sbx_')).toBe(true)
    expect(usageCents()).toBe(100)

    const spec = provider.created[0]
    expect(spec.os).toBe('linux')
    expect(spec.cpu).toBe(1)
    expect(spec.memoryGb).toBe(1)
    expect(spec.ttlSec).toBe(60)
    expect(spec.metadata?.demo).toBe('true')
  })

  test('the price never drops below one cent', async () => {
    const { demo } = harness({ stepMs: 0 })
    const body = await bodyOf<DemoBody>(await post(demo, { body: { command: 'true' } }))
    expect(body.cost_cents).toBe(1)
  })

  test('the response carries no provider id and no secret', async () => {
    const { demo } = harness()
    const response = await post(demo, { body: { command: 'print(1)' } })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text.includes('daytona')).toBe(false)
    expect(text.includes('provider')).toBe(false)
    expect(response.headers.get('x-request-id')).toMatch(/^req_[0-9a-f]{24}$/)
  })

  test('the machine is destroyed even when the command fails', async () => {
    const { demo, provider } = harness()
    provider.failExec = true
    const response = await post(demo, { body: { command: 'boom' } })
    expect(response.status).toBe(502)
    const error = await bodyOf<DemoErrorBody>(response)
    expect(error.error.code).toBe('provider_error')
    expect(provider.created).toHaveLength(1)
    expect(provider.destroyed).toEqual([provider.created[0].id])
    expect(provider.alive.size).toBe(0)
  })
})

// ============================================================
// Guard rails
// ============================================================

describe('one run per address per day', () => {
  test('the second run from the same address is refused with 429 demo_limit', async () => {
    const { demo, provider } = harness()
    expect((await post(demo, { body: { command: 'first' } })).status).toBe(200)
    const second = await post(demo, { body: { command: 'second' } })
    expect(second.status).toBe(429)
    const error = await bodyOf<DemoErrorBody>(second)
    expect(error.error.code).toBe('demo_limit')
    expect(error.error.message.length).toBeGreaterThan(0)
    expect(provider.created).toHaveLength(1)
  })

  test('the first value of x-forwarded-for decides, not the proxy chain', async () => {
    const { demo } = harness()
    const chain = '198.51.100.9, 10.0.0.1, 10.0.0.2'
    expect((await post(demo, { ip: chain, body: { command: 'first' } })).status).toBe(200)
    expect((await post(demo, { ip: '198.51.100.9', body: { command: 'second' } })).status).toBe(429)
  })

  test('two different addresses both get their run', async () => {
    const { demo, provider } = harness()
    expect((await post(demo, { ip: '203.0.113.1', body: { command: 'one' } })).status).toBe(200)
    expect((await post(demo, { ip: '203.0.113.2', body: { command: 'two' } })).status).toBe(200)
    expect(provider.created).toHaveLength(2)
  })
})

describe('a demo that is not configured', () => {
  test('a missing credential answers 503 demo_unavailable and creates nothing', async () => {
    const { demo, provider } = harness({ withCredential: false })
    const response = await post(demo, { body: { command: 'print(1)' } })
    expect(response.status).toBe(503)
    const error = await bodyOf<DemoErrorBody>(response)
    expect(error.error.code).toBe('demo_unavailable')
    expect(error.error.message).toContain('Пробная машина не настроена')
    expect(provider.created).toHaveLength(0)
  })

  test('a closed demo does not spend the visitor’s daily run', async () => {
    const store = createMemoryStore()
    const provider = new FakeProvider()
    let open = false
    const demo = createDemo({
      store,
      tenantId: TENANT_ID,
      rateCentsPerHour: RATE,
      resolveProvider: () => (open ? provider : null),
      now: () => NOW,
    })
    expect((await post(demo, { body: { command: 'first' } })).status).toBe(503)
    open = true
    expect((await post(demo, { body: { command: 'second' } })).status).toBe(200)
  })
})

describe('bad requests', () => {
  test('an empty command is 400 invalid_request', async () => {
    const { demo, provider } = harness()
    const response = await post(demo, { body: { command: '   ' } })
    expect(response.status).toBe(400)
    const error = await bodyOf<DemoErrorBody>(response)
    expect(error.error.code).toBe('invalid_request')
    expect(provider.created).toHaveLength(0)
  })

  test('a missing command is 400 invalid_request', async () => {
    const { demo } = harness()
    const response = await post(demo, { body: { command: 42 } })
    expect(response.status).toBe(400)
  })

  test('a command longer than 2 KB is 400 invalid_request', async () => {
    const { demo, provider } = harness()
    const response = await post(demo, { body: { command: 'x'.repeat(2049) } })
    expect(response.status).toBe(400)
    const error = await bodyOf<DemoErrorBody>(response)
    expect(error.error.code).toBe('invalid_request')
    expect(provider.created).toHaveLength(0)
  })

  test('a body over 8 KB is 413', async () => {
    const { demo, provider } = harness()
    const response = await post(demo, { body: { command: 'x'.repeat(9000) } })
    expect(response.status).toBe(413)
    const error = await bodyOf<DemoErrorBody>(response)
    expect(error.error.code).toBe('payload_too_large')
    expect(provider.created).toHaveLength(0)
  })

  test('a GET is refused and nothing is created', async () => {
    const { demo, provider } = harness()
    const response = await demo.handle(new Request('http://api.test/v1/demo', { method: 'GET' }))
    expect(response.status).toBe(405)
    expect(provider.created).toHaveLength(0)
  })
})

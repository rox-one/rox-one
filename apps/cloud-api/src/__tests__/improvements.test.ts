/**
 * Contract tests for the machine improvements: naming, ports and metrics,
 * the persistent shell, SSH keys and access, snapshots, the cached network
 * card, preview guard and durable re-adoption.
 *
 * Everything runs in memory: the provider is a deterministic fake that answers
 * the exact commands the routes send, and no live credential is ever used.
 */

import { describe, expect, test } from 'bun:test'

import { createMemoryKeyStore } from '../../../../packages/cloud-keys/src/index.ts'
import type { KeyStore } from '../../../../packages/cloud-keys/src/index.ts'
import { createAuditLog, createKillSwitch } from '../../../../packages/cloud-ops/src/index.ts'
import type { AuditLog, KillSwitch } from '../../../../packages/cloud-ops/src/index.ts'
import { createMemoryMoneyStore } from '../../../../packages/cloud-runner/src/entitlement.ts'
import type { MemoryMoneyStore } from '../../../../packages/cloud-runner/src/entitlement.ts'
import type {
  ProviderImage,
  SandboxExecResult,
  SandboxProvider,
  SandboxSpec,
  SandboxState,
  SandboxStatus,
} from '../../../../packages/cloud-runner/src/sandbox.ts'
import { CloudRunnerError } from '../../../../packages/cloud-runner/src/types.ts'
import { createApp } from '../app.ts'
import type { CloudApp, DeclaredCapabilities } from '../app.ts'
import { generateApiKey } from '../auth.ts'
import { applyState, snapshotState } from '../persistence.ts'
import { createMemoryStore, nextId } from '../store.ts'
import type { MemoryStore, Scope, Tenant } from '../store.ts'

// ============================================================
// Fixtures
// ============================================================

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)
const PROVIDER_REF = 'dt_live_1'
const SSH_COMMAND = 'ssh -p 22220 daytona@ssh.test'
const PRIVATE_IP = '172.20.0.33'
const METRICS_LINE =
  '{"cpu_percent": 12.5, "memory_used_kb": 524288, "memory_total_kb": 2097152, "disk_used_kb": 1048576, "disk_total_kb": 4194304}'
const SSH_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKeyBodyForRoxCloudTests rox@test'

const CAPABILITIES: DeclaredCapabilities = {
  id: 'daytona',
  os: ['linux', 'windows'],
  gpu: true,
  pause: true,
  snapshot: true,
  volume: true,
  streaming: 'none',
  maxTtlSec: 86_400,
  regions: ['eu-central'],
}

const ALL_SCOPES: readonly Scope[] = [
  'sandboxes:read',
  'sandboxes:write',
  'keys:write',
  'billing:read',
  'billing:write',
]

interface FakeSandbox {
  spec: SandboxSpec
  state: SandboxState
  files: Map<string, Uint8Array>
}

interface ExecCall {
  readonly command: string
  readonly timeoutMs?: number
}

/** Extract the script a route glued onto `echo … | base64 -d`. */
function encodedScript(command: string): string | undefined {
  const match = /echo ([A-Za-z0-9+/=]+) \| base64 -d/.exec(command)
  return match === null ? undefined : Buffer.from(match[1]!, 'base64').toString('utf8')
}

/**
 * In-memory provider shaped like a real adapter. It answers the exact strings
 * the routes build: `hostname -I`, `ss -ltnH`, the metrics script, the port
 * probe, and the session scripts with their base64 payload and markers.
 */
class FakeProvider implements SandboxProvider {
  readonly providerId = 'daytona'
  readonly created: SandboxSpec[] = []
  readonly sandboxes = new Map<string, FakeSandbox>()
  readonly execCalls: ExecCall[] = []
  readonly previewCalls: Array<{ id: string; port: number; ttlSec: number }> = []
  readonly sshCalls: Array<{ id: string; ttlSec: number }> = []
  readonly snapshotCalls: Array<{ id: string; name: string }> = []
  readonly writeCalls: Array<{ id: string; path: string; data: Uint8Array }> = []
  readonly adoptCalls: Array<{
    id: string
    providerRef: string
    state: SandboxState
    createdAt: number
    expiresAt?: number
  }> = []
  readonly openPorts = new Set<number>([3000])
  readonly images: ProviderImage[] = []
  sessionActive = false
  sessionCwd = '/home/rox'

  async create(spec: SandboxSpec): Promise<SandboxStatus> {
    this.created.push(spec)
    this.sandboxes.set(spec.id, { spec, state: 'running', files: new Map() })
    return {
      id: spec.id,
      provider: this.providerId,
      providerRef: PROVIDER_REF,
      state: 'running',
      createdAt: NOW,
    }
  }

  async get(id: string): Promise<SandboxStatus> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new CloudRunnerError('unknown sandbox', 'not_found')
    return { id, provider: this.providerId, state: sandbox.state, createdAt: NOW }
  }

  async exec(
    id: string,
    command: string,
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<SandboxExecResult> {
    if (!this.sandboxes.has(id)) throw new CloudRunnerError('unknown sandbox', 'not_found')
    this.execCalls.push({ command, ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }) })

    if (command === 'hostname -I') return { stdout: `${PRIVATE_IP} \n`, stderr: '', exitCode: 0 }
    if (command === 'ss -ltnH') {
      return {
        stdout: [
          'LISTEN 0 4096 0.0.0.0:2280 0.0.0.0:*',
          'LISTEN 0 4096 127.0.0.1:22 0.0.0.0:*',
          'LISTEN 0 4096 0.0.0.0:3000 0.0.0.0:*',
          'LISTEN 0 4096 [::]:3000 [::]:*',
          'LISTEN 0 4096 [::]:22220 [::]:*',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      }
    }
    if (command.includes('mkfifo')) {
      this.sessionActive = true
      return { stdout: 'ready\n/home/rox\n', stderr: '', exitCode: 0 }
    }
    if (command.includes('pkill -INT')) {
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (command.includes('pkill -TERM')) {
      this.sessionActive = false
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (command.includes('/tmp/rox-session/in')) {
      if (!this.sessionActive) return { stdout: 'ROX_NO_SESSION\n', stderr: '', exitCode: 0 }
      const outer = /\{ echo ([A-Za-z0-9+/=]+) \| base64 -d; echo; \}/.exec(command)
      const payload = outer === null ? '' : Buffer.from(outer[1]!, 'base64').toString('utf8')
      const marker = /roxm_[0-9a-f]{24}/.exec(payload)?.[0] ?? 'roxm_unknown'
      const inner = /echo ([A-Za-z0-9+/=]{4,}) \| base64 -d/.exec(payload)
      const ran = inner === null ? '' : Buffer.from(inner[1]!, 'base64').toString('utf8').trim()
      let out = ''
      if (ran === 'pwd') out = this.sessionCwd
      else if (ran.startsWith('cd ')) this.sessionCwd = ran.slice(3).trim() || this.sessionCwd
      else if (ran.startsWith('echo ')) out = ran.slice(5)
      else if (ran.length > 0) out = `ok: ${ran}`
      const text = `\n${marker}\n${out.length > 0 ? `${out}\n` : ''}${this.sessionCwd}\n${marker}:END:0\n`
      return { stdout: text, stderr: '', exitCode: 0 }
    }

    const script = encodedScript(command)
    if (script !== undefined) {
      if (script.includes('/proc/stat')) return { stdout: `${METRICS_LINE}\n`, stderr: '', exitCode: 0 }
      const probe = /probe\.connect\(\("127\.0\.0\.1", (\d+)\)\)/.exec(script)
      if (probe !== null) {
        const port = Number(probe[1])
        return { stdout: '', stderr: '', exitCode: this.openPorts.has(port) ? 0 : 1 }
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 }
  }

  async readFile(id: string, path: string): Promise<Uint8Array> {
    const bytes = this.sandboxes.get(id)?.files.get(path)
    if (!bytes) throw new CloudRunnerError('unknown file', 'not_found')
    return bytes
  }

  async writeFile(id: string, path: string, data: Uint8Array): Promise<void> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new CloudRunnerError('unknown sandbox', 'not_found')
    sandbox.files.set(path, data)
    this.writeCalls.push({ id, path, data })
  }

  async stop(id: string): Promise<void> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new CloudRunnerError('unknown sandbox', 'not_found')
    sandbox.state = 'stopped'
  }

  async destroy(id: string): Promise<void> {
    this.sandboxes.delete(id)
  }

  async previewUrl(id: string, port: number, ttlSec: number) {
    if (!this.sandboxes.has(id)) throw new CloudRunnerError('unknown sandbox', 'not_found')
    this.previewCalls.push({ id, port, ttlSec })
    return { url: `https://${port}-${id}.preview.test`, expiresAt: NOW + ttlSec * 1000 }
  }

  async sshAccess(id: string, ttlSec: number) {
    if (!this.sandboxes.has(id)) throw new CloudRunnerError('unknown sandbox', 'not_found')
    this.sshCalls.push({ id, ttlSec })
    return { command: SSH_COMMAND, expiresAt: NOW + ttlSec * 1000 }
  }

  async listImages(): Promise<ProviderImage[]> {
    return this.images
  }

  adopt(
    id: string,
    providerRef: string,
    state: SandboxState,
    createdAt: number,
    expiresAt?: number,
  ): void {
    this.adoptCalls.push({
      id,
      providerRef,
      state,
      createdAt,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    })
    if (!this.sandboxes.has(id)) {
      this.sandboxes.set(id, {
        spec: { id, os: 'linux', cpu: 2, memoryGb: 4 },
        state,
        files: new Map(),
      })
    }
  }

  async createSnapshot(id: string, name: string) {
    if (!this.sandboxes.has(id)) throw new CloudRunnerError('unknown sandbox', 'not_found')
    this.snapshotCalls.push({ id, name })
    this.images.push({ id: name, name, state: 'ready', os: 'linux', cpu: 2, memoryGb: 4, diskGb: 8 })
    return { name, state: 'building' }
  }
}

// ============================================================
// Harness
// ============================================================

interface Harness {
  readonly app: CloudApp
  readonly store: MemoryStore
  readonly tenant: Tenant
  readonly secret: string
  readonly provider: FakeProvider
  readonly audit: AuditLog
  readonly keyStore: KeyStore
  readonly moneyStore: MemoryMoneyStore
  readonly killSwitch: KillSwitch
  advance(ms: number): void
}

function harness(): Harness {
  let clock = NOW
  const now = (): number => clock
  const store = createMemoryStore()
  const tenant = store.addTenant('Тестовая команда')
  const generated = generateApiKey()
  store.addApiKey({
    id: nextId('key_'),
    tenantId: tenant.id,
    prefix: generated.prefix,
    last4: generated.last4,
    hash: generated.hash,
    scopes: ALL_SCOPES,
    createdAt: NOW,
  })
  const provider = new FakeProvider()
  const audit = createAuditLog({ now: () => new Date(now()) })
  const keyStore = createMemoryKeyStore({ now: () => new Date(now()) })
  const moneyStore = createMemoryMoneyStore()
  const killSwitch = createKillSwitch({ now: () => new Date(now()) })
  const app = createApp({
    store,
    resolveProvider: () => provider,
    listCapabilities: () => [CAPABILITIES],
    defaultProvider: 'daytona',
    now,
    audit,
  })
  return {
    app,
    store,
    tenant,
    secret: generated.secret,
    provider,
    audit,
    keyStore,
    moneyStore,
    killSwitch,
    advance(ms: number) {
      clock += ms
    },
  }
}

interface CallOptions {
  method?: string
  token?: string | null
  body?: unknown
}

async function call(app: CloudApp, path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  if (typeof options.token === 'string') headers.authorization = `Bearer ${options.token}`
  let body: BodyInit | undefined
  if (options.body !== undefined) {
    body = JSON.stringify(options.body)
    headers['content-type'] = 'application/json'
  }
  return app.handle(
    new Request(`http://api.test${path}`, { method: options.method ?? 'GET', headers, body }),
  )
}

async function readBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

interface ErrorBody {
  error: { type: string; code: string; message: string; request_id: string }
}

interface SandboxBody {
  id: string
  state: string
  display_name: string | null
  ssh_keys: Array<{ id: string; label: string; fingerprint: string; created_at: string }>
  snapshots: Array<{ name: string; state: string | null; created_at: string }>
}

/** The standard machine body every test boots from. */
const SPEC_BODY = { os: 'linux' as const, cpu: 2, memoryGb: 4 }

/** One boot per test; the idempotency key is unique by construction. */
function createWithKey(h: Harness, body: Record<string, unknown> = {}): Promise<Response> {
  return h.app.handle(
    new Request('http://api.test/v1/sandboxes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${h.secret}`,
        'content-type': 'application/json',
        'idempotency-key': nextId('idem_'),
      },
      body: JSON.stringify({ ...SPEC_BODY, ...body }),
    }),
  )
}

async function bootMachine(h: Harness, body: Record<string, unknown> = {}): Promise<SandboxBody> {
  const response = await createWithKey(h, body)
  expect(response.status).toBe(201)
  return readBody<SandboxBody>(response)
}

// ============================================================
// Machine name
// ============================================================

describe('machine display name', () => {
  test('create stores a trimmed name and PATCH renames then clears it', async () => {
    const h = harness()
    const created = await bootMachine(h, { display_name: '  Сборка  ' })
    expect(created.display_name).toBe('Сборка')

    const renamed = await call(h.app, `/v1/sandboxes/${created.id}`, {
      method: 'PATCH',
      token: h.secret,
      body: { display_name: 'Новое имя' },
    })
    expect(renamed.status).toBe(200)
    expect((await readBody<SandboxBody>(renamed)).display_name).toBe('Новое имя')

    const cleared = await call(h.app, `/v1/sandboxes/${created.id}`, {
      method: 'PATCH',
      token: h.secret,
      body: { display_name: '' },
    })
    expect(cleared.status).toBe(200)
    expect((await readBody<SandboxBody>(cleared)).display_name).toBeNull()

    const stored = h.store.sandboxes.get(created.id)
    expect(stored?.displayName).toBeUndefined()
  })

  test('PATCH without display_name and with a control character is 400', async () => {
    const h = harness()
    const created = await bootMachine(h)

    const missing = await call(h.app, `/v1/sandboxes/${created.id}`, {
      method: 'PATCH',
      token: h.secret,
      body: {},
    })
    expect(missing.status).toBe(400)
    expect((await readBody<ErrorBody>(missing)).error.code).toBe('invalid_request')

    const bad = await call(h.app, `/v1/sandboxes/${created.id}`, {
      method: 'PATCH',
      token: h.secret,
      body: { display_name: 'a\nb' },
    })
    expect(bad.status).toBe(400)
    expect((await readBody<ErrorBody>(bad)).error.code).toBe('invalid_request')
  })
})

// ============================================================
// Ports, metrics and network card
// ============================================================

describe('ports and metrics', () => {
  test('GET ports lists listening ports once each and flags reserved ones', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const response = await call(h.app, `/v1/sandboxes/${created.id}/ports`, { token: h.secret })
    expect(response.status).toBe(200)
    const body = await readBody<{ object: string; data: Array<{ port: number; reserved: boolean }> }>(
      response,
    )
    expect(body.object).toBe('list')
    expect(body.data).toEqual([
      { port: 22, reserved: false },
      { port: 2280, reserved: true },
      { port: 3000, reserved: false },
      { port: 22220, reserved: true },
    ])
    expect(h.provider.execCalls.at(-1)?.command).toBe('ss -ltnH')
  })

  test('GET metrics returns the sampled numbers', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const response = await call(h.app, `/v1/sandboxes/${created.id}/metrics`, { token: h.secret })
    expect(response.status).toBe(200)
    expect(await readBody<Record<string, unknown>>(response)).toEqual({
      object: 'metrics',
      at: new Date(NOW).toISOString(),
      cpu_percent: 12.5,
      memory_used_kb: 524288,
      memory_total_kb: 2097152,
      disk_used_kb: 1048576,
      disk_total_kb: 4194304,
    })
  })

  test('the network card reads the address once, honors ?refresh=1 and expires after 30 s', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const path = `/v1/sandboxes/${created.id}/network`
    const reads = (): number => h.provider.execCalls.filter((c) => c.command === 'hostname -I').length

    const first = await call(h.app, path, { token: h.secret })
    expect(first.status).toBe(200)
    const body = await readBody<Record<string, unknown>>(first)
    expect(body).toEqual({
      object: 'network',
      sandbox_id: created.id,
      private_ip: PRIVATE_IP,
      public_ip: null,
      note: 'Публичного адреса у машины нет: снаружи она открыта ссылкой на порт и SSH-шлюзом.',
    })
    expect(reads()).toBe(1)

    // Inside the 30 s window the card is served from the cache.
    const cached = await call(h.app, path, { token: h.secret })
    expect(cached.status).toBe(200)
    expect(reads()).toBe(1)

    // `?refresh=1` always re-reads the machine.
    const refreshed = await call(h.app, `${path}?refresh=1`, { token: h.secret })
    expect(refreshed.status).toBe(200)
    expect(reads()).toBe(2)

    h.advance(30_001)
    const afterTtl = await call(h.app, path, { token: h.secret })
    expect(afterTtl.status).toBe(200)
    expect(reads()).toBe(3)
  })
})

// ============================================================
// Persistent shell
// ============================================================

describe('persistent shell', () => {
  test('start reports cwd, exec returns the command output and cwd, stop closes it', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const base = `/v1/sandboxes/${created.id}/session`

    const started = await call(h.app, `${base}/start`, { method: 'POST', token: h.secret })
    expect(started.status).toBe(200)
    expect(await readBody<Record<string, unknown>>(started)).toEqual({
      object: 'session',
      state: 'ready',
      cwd: '/home/rox',
    })

    const echo = await call(h.app, `${base}/exec`, {
      method: 'POST',
      token: h.secret,
      body: { command: 'echo srv-ready' },
    })
    expect(echo.status).toBe(200)
    expect(await readBody<Record<string, unknown>>(echo)).toEqual({
      stdout: 'srv-ready\n',
      stderr: '',
      cwd: '/home/rox',
      exit_code: 0,
    })

    const cd = await call(h.app, `${base}/exec`, {
      method: 'POST',
      token: h.secret,
      body: { command: 'cd /srv/app' },
    })
    expect(cd.status).toBe(200)
    expect((await readBody<Record<string, unknown>>(cd)).cwd).toBe('/srv/app')

    const pwd = await call(h.app, `${base}/exec`, {
      method: 'POST',
      token: h.secret,
      body: { command: 'pwd' },
    })
    expect(pwd.status).toBe(200)
    expect((await readBody<Record<string, unknown>>(pwd)).stdout).toBe('/srv/app\n')

    const interrupted = await call(h.app, `${base}/interrupt`, { method: 'POST', token: h.secret })
    expect(interrupted.status).toBe(200)
    expect(await readBody<Record<string, unknown>>(interrupted)).toEqual({ ok: true })

    const stopped = await call(h.app, `${base}/stop`, { method: 'POST', token: h.secret })
    expect(stopped.status).toBe(204)

    const afterStop = await call(h.app, `${base}/exec`, {
      method: 'POST',
      token: h.secret,
      body: { command: 'pwd' },
    })
    expect(afterStop.status).toBe(409)
    expect((await readBody<ErrorBody>(afterStop)).error.code).toBe('conflict')
  })

  test('exec without a started session is 409, not an empty answer', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const response = await call(h.app, `/v1/sandboxes/${created.id}/session/exec`, {
      method: 'POST',
      token: h.secret,
      body: { command: 'pwd' },
    })
    expect(response.status).toBe(409)
    expect((await readBody<ErrorBody>(response)).error.code).toBe('conflict')
  })
})

// ============================================================
// SSH keys and SSH access
// ============================================================

describe('ssh keys and access', () => {
  test('add writes authorized_keys, list shows metadata only, delete rewrites it empty', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const base = `/v1/sandboxes/${created.id}/ssh-keys`

    const added = await call(h.app, base, {
      method: 'POST',
      token: h.secret,
      body: { public_key: SSH_KEY, label: 'Мой ключ' },
    })
    expect(added.status).toBe(201)
    const key = await readBody<Record<string, unknown>>(added)
    expect(Object.keys(key).sort()).toEqual(['created_at', 'fingerprint', 'id', 'label'])
    expect(key.label).toBe('Мой ключ')
    expect(String(key.fingerprint)).toMatch(/^SHA256:[A-Za-z0-9+/]+$/)

    const file = '/home/rox/.ssh/authorized_keys'
    const written = h.provider.writeCalls.filter((entry) => entry.path === file)
    expect(written).toHaveLength(1)
    expect(new TextDecoder().decode(written[0]!.data)).toBe(`${SSH_KEY}\n`)
    expect(h.provider.execCalls.some((c) => c.command.includes('mkdir -p /home/rox/.ssh'))).toBe(true)

    const listed = await call(h.app, base, { token: h.secret })
    expect(listed.status).toBe(200)
    const listBody = await readBody<{ object: string; data: Array<Record<string, unknown>> }>(listed)
    expect(listBody.object).toBe('list')
    expect(listBody.data).toHaveLength(1)
    expect(listBody.data[0]?.id).toBe(key.id)
    expect(JSON.stringify(listBody)).not.toContain(SSH_KEY)
    expect(JSON.stringify(listBody)).not.toContain('public_key')

    const removed = await call(h.app, `${base}/${String(key.id)}`, {
      method: 'DELETE',
      token: h.secret,
    })
    expect(removed.status).toBe(204)
    const afterDelete = h.provider.writeCalls.filter((entry) => entry.path === file)
    expect(afterDelete).toHaveLength(2)
    expect(afterDelete[1]!.data.byteLength).toBe(0)

    const empty = await call(h.app, base, { token: h.secret })
    expect((await readBody<{ data: unknown[] }>(empty)).data).toEqual([])
  })

  test('a malformed public key is 400 and nothing is written', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const response = await call(h.app, `/v1/sandboxes/${created.id}/ssh-keys`, {
      method: 'POST',
      token: h.secret,
      body: { public_key: 'not-a-key' },
    })
    expect(response.status).toBe(400)
    expect((await readBody<ErrorBody>(response)).error.code).toBe('invalid_request')
    expect(h.provider.writeCalls).toHaveLength(0)
  })

  test('POST ssh returns the command with no-store and records no command in the journal', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const response = await call(h.app, `/v1/sandboxes/${created.id}/ssh`, {
      method: 'POST',
      token: h.secret,
      body: { ttl_sec: 600 },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await readBody<Record<string, unknown>>(response)).toEqual({
      object: 'ssh_access',
      sandbox_id: created.id,
      command: SSH_COMMAND,
      expires_at: new Date(NOW + 600_000).toISOString(),
    })
    expect(h.provider.sshCalls).toEqual([{ id: created.id, ttlSec: 600 }])

    const entries = h.audit.list({ action: 'sandbox.ssh' })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.targetId).toBe(created.id)
    expect(entries[0]?.details).toEqual({ ttl_sec: 600 })
    expect(JSON.stringify(entries[0])).not.toContain('ssh -p')
    expect(JSON.stringify(entries[0])).not.toContain('daytona@ssh.test')
  })
})

// ============================================================
// Snapshots
// ============================================================

describe('snapshots', () => {
  test('create calls the provider, list refreshes its state, the journal holds the name', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const base = `/v1/sandboxes/${created.id}/snapshots`

    const made = await call(h.app, base, {
      method: 'POST',
      token: h.secret,
      body: { name: 'base-1' },
    })
    expect(made.status).toBe(201)
    expect(await readBody<Record<string, unknown>>(made)).toEqual({
      object: 'snapshot',
      name: 'base-1',
      state: 'building',
    })
    expect(h.provider.snapshotCalls).toEqual([{ id: created.id, name: 'base-1' }])

    const listed = await call(h.app, base, { token: h.secret })
    expect(listed.status).toBe(200)
    expect(await readBody<Record<string, unknown>>(listed)).toEqual({
      object: 'list',
      data: [{ name: 'base-1', state: 'ready', created_at: new Date(NOW).toISOString() }],
    })

    const entries = h.audit.list({ action: 'sandbox.snapshot' })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.details).toEqual({ name: 'base-1' })
  })

  test('a name outside the safe alphabet is refused before the provider is called', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const response = await call(h.app, `/v1/sandboxes/${created.id}/snapshots`, {
      method: 'POST',
      token: h.secret,
      body: { name: '-bad name' },
    })
    expect(response.status).toBe(400)
    expect((await readBody<ErrorBody>(response)).error.code).toBe('invalid_request')
    expect(h.provider.snapshotCalls).toHaveLength(0)
  })
})

// ============================================================
// Preview guard
// ============================================================

describe('preview links', () => {
  test('a closed port is 409 and an open one answers a no-store link with a journal entry', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const base = `/v1/sandboxes/${created.id}/preview`

    const closed = await call(h.app, base, { method: 'POST', token: h.secret, body: { port: 8080 } })
    expect(closed.status).toBe(409)
    const closedBody = await readBody<ErrorBody>(closed)
    expect(closedBody.error.code).toBe('conflict')
    expect(closedBody.error.message).toContain('8080')
    expect(h.provider.previewCalls).toHaveLength(0)
    expect(h.audit.list({ action: 'sandbox.preview' })).toHaveLength(0)

    const open = await call(h.app, base, { method: 'POST', token: h.secret, body: { port: 3000 } })
    expect(open.status).toBe(200)
    expect(open.headers.get('cache-control')).toBe('no-store')
    expect(await readBody<Record<string, unknown>>(open)).toEqual({
      object: 'preview',
      sandbox_id: created.id,
      port: 3000,
      url: `https://3000-${created.id}.preview.test`,
      expires_at: new Date(NOW + 3_600_000).toISOString(),
    })
    expect(h.provider.previewCalls).toEqual([{ id: created.id, port: 3000, ttlSec: 3600 }])

    const entries = h.audit.list({ action: 'sandbox.preview' })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.details).toEqual({ port: 3000, ttl_sec: 3600 })
    expect(JSON.stringify(entries[0])).not.toContain('preview.test')
    expect(JSON.stringify(entries[0])).not.toContain('url')
  })

  test('a reserved port is 400 and a tiny ttl is raised to the 60 s floor', async () => {
    const h = harness()
    const created = await bootMachine(h)

    const reserved = await call(h.app, `/v1/sandboxes/${created.id}/preview`, {
      method: 'POST',
      token: h.secret,
      body: { port: 2280 },
    })
    expect(reserved.status).toBe(400)
    expect((await readBody<ErrorBody>(reserved)).error.code).toBe('invalid_request')

    const tiny = await call(h.app, `/v1/sandboxes/${created.id}/preview`, {
      method: 'POST',
      token: h.secret,
      body: { port: 3000, ttl_sec: 1 },
    })
    expect(tiny.status).toBe(200)
    expect(h.provider.previewCalls.at(-1)?.ttlSec).toBe(60)
  })
})

// ============================================================
// Durable records
// ============================================================

describe('durable records', () => {
  test('providerRef is stored from create', async () => {
    const h = harness()
    const created = await bootMachine(h)
    const stored = h.store.sandboxes.get(created.id)
    expect(stored?.providerRef).toBe(PROVIDER_REF)
    expect(stored?.state).toBe('running')
  })

  test('applyState keeps a running record with providerRef and the boot adopt restores it', async () => {
    const h = harness()
    const created = await bootMachine(h, { display_name: 'Живая' })

    const state = snapshotState({
      store: h.store,
      moneyStore: h.moneyStore,
      keyStore: h.keyStore,
      audit: h.audit,
      killSwitch: h.killSwitch,
    })

    const after = {
      store: createMemoryStore(),
      moneyStore: createMemoryMoneyStore(),
      keyStore: createMemoryKeyStore({ now: () => new Date(NOW) }),
      audit: createAuditLog({ now: () => new Date(NOW) }),
      killSwitch: createKillSwitch({ now: () => new Date(NOW) }),
    }
    applyState(state, after)

    const restored = after.store.sandboxes.get(created.id)
    expect(restored?.state).toBe('running')
    expect(restored?.providerRef).toBe(PROVIDER_REF)
    expect(restored?.displayName).toBe('Живая')

    // The boot path from server.ts: hand the reference to a fresh adapter.
    const freshProvider = new FakeProvider()
    for (const record of after.store.sandboxes.values()) {
      if (record.providerRef === undefined) continue
      if (record.state === 'stopped' || record.state === 'failed' || record.state === 'expired') {
        continue
      }
      freshProvider.adopt!(
        record.id,
        record.providerRef,
        record.state,
        record.createdAt,
        record.expiresAt,
      )
    }
    expect(freshProvider.adoptCalls).toHaveLength(1)
    expect(freshProvider.adoptCalls[0]?.id).toBe(created.id)
    expect(freshProvider.adoptCalls[0]?.providerRef).toBe(PROVIDER_REF)
    expect(freshProvider.adoptCalls[0]?.state).toBe('running')

    const exec = await freshProvider.exec(created.id, 'hostname -I')
    expect(exec.stdout.trim()).toBe(PRIVATE_IP)

    // The restored key can still read the restored machine from a new app.
    const restoredApp = createApp({
      store: after.store,
      resolveProvider: () => freshProvider,
      listCapabilities: () => [CAPABILITIES],
      defaultProvider: 'daytona',
      now: () => NOW,
    })
    const response = await call(restoredApp, `/v1/sandboxes/${created.id}`, { token: h.secret })
    expect(response.status).toBe(200)
    const body = await readBody<SandboxBody>(response)
    expect(body.state).toBe('running')
    expect(body.display_name).toBe('Живая')
  })
})

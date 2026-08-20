/**
 * Supervise a pinned OEM knowledge kernel (H1). Fail-closed unless G2 variant C.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { OemKernelPin } from '@craft-agent/shared/knowledge/oem-pin'

export type ManagedKernelError =
  | 'G2_BLOCKED'
  | 'PIN_MISSING'
  | 'BINARY_MISSING'
  | 'PORT_CONFLICT'
  | 'KERNEL_CRASHED'
  | 'WORKSPACE_LOCKED'
  | 'TIMEOUT'

export class ManagedKernelCodedError extends Error {
  readonly code: ManagedKernelError
  constructor(code: ManagedKernelError, message: string) {
    super(message)
    this.name = 'ManagedKernelCodedError'
    this.code = code
  }
}

export interface ManagedStartInput {
  configDir: string
  connectionId: string
  g2AcceptedVariant: 'C' | null
  pin: OemKernelPin
  resolveBinary: (pin: OemKernelPin) => string | null
  spawnFn: (
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv },
  ) => {
    pid: number | undefined
    unref(): unknown
    on(ev: 'exit', cb: (code: number | null) => void): void
    kill(sig?: string): unknown
  }
  allocatePort: () => number
  now?: () => number
  fetchImpl?: typeof fetch
  readyTimeoutMs?: number
  log?: { debug?(message: string, extra?: unknown): void }
}

export interface ManagedInstance {
  pid: number
  port: number
  baseUrl: string
  workspacePath: string
  accessAuthCode: string
}

interface ChildHandle {
  pid: number | undefined
  unref(): unknown
  on(ev: 'exit', cb: (code: number | null) => void): void
  kill(sig?: string): unknown
}

const MAX_CRASHES = 5
const DEFAULT_READY_TIMEOUT_MS = 20_000
const READY_POLL_MS = 200

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class SiyuanProcessManager {
  private child: ChildHandle | null = null
  private instance: ManagedInstance | null = null
  private crashCount = 0
  private lastError: ManagedKernelError | undefined
  private exitHandler: ((code: number | null) => void) | null = null
  private startInput: ManagedStartInput | null = null
  private stopping = false

  async start(input: ManagedStartInput): Promise<ManagedInstance> {
    if (input.g2AcceptedVariant !== 'C') {
      this.lastError = 'G2_BLOCKED'
      throw new ManagedKernelCodedError(
        'G2_BLOCKED',
        'knowledge: managed kernel spawn is blocked until G2 variant C is ACCEPTED',
      )
    }
    const binary = input.resolveBinary(input.pin)
    if (!binary) {
      this.lastError = 'BINARY_MISSING'
      throw new ManagedKernelCodedError('BINARY_MISSING', 'knowledge: OEM kernel binary is not on disk')
    }
    const port = input.allocatePort()
    if (port === 6806) {
      this.lastError = 'PORT_CONFLICT'
      throw new ManagedKernelCodedError('PORT_CONFLICT', 'knowledge: managed kernel must not bind 6806')
    }
    this.startInput = input
    this.stopping = false
    this.crashCount = 0
    this.lastError = undefined
    const instance = this.spawnOnce(input, binary, port)
    const readyTimeoutMs = input.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    if (readyTimeoutMs === 0) {
      return instance
    }
    await this.waitUntilReady(instance, input)
    await this.seedDefaultNotebook(instance, input)
    return instance
  }

  async stop(opts?: { graceMs?: number }): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child) {
      this.instance = null
      return
    }
    const graceMs = opts?.graceMs ?? 10_000
    child.kill('SIGTERM')
    if (graceMs <= 0) {
      child.kill('SIGKILL')
      this.child = null
      this.instance = null
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, graceMs)
      const prev = this.exitHandler
      this.exitHandler = (code) => {
        clearTimeout(timer)
        prev?.(code)
        resolve()
      }
    })
    this.child = null
    this.instance = null
  }

  status(): { running: boolean; pid?: number; port?: number; error?: ManagedKernelError } {
    if (this.instance && this.child) {
      return { running: true, pid: this.instance.pid, port: this.instance.port }
    }
    return { running: false, ...(this.lastError ? { error: this.lastError } : {}) }
  }

  private spawnOnce(input: ManagedStartInput, binary: string, port: number): ManagedInstance {
    const workspacePath = join(input.configDir, 'knowledge-workspaces', input.connectionId)
    mkdirSync(workspacePath, { recursive: true })
    const accessAuthCode = randomBytes(16).toString('hex')
    const binaryDir = dirname(binary)
    const args = [
      `--wd=${binaryDir}`,
      `--workspace=${workspacePath}`,
      `--port=${port}`,
      `--accessAuthCode=${accessAuthCode}`,
      '--lang=ru',
    ]
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ROX_DISABLE_KERNEL_AI: '1',
      ROX_DISABLE_FIXED_PORT: '1',
    }
    if (process.env.ROX_CATALOG_URL) {
      env.ROX_CATALOG_URL = process.env.ROX_CATALOG_URL
    }
    const child = input.spawnFn(binary, args, { cwd: binaryDir, env })
    if (typeof child.pid !== 'number') {
      throw new ManagedKernelCodedError('KERNEL_CRASHED', 'knowledge: spawn did not yield a pid')
    }
    this.child = child
    this.instance = {
      pid: child.pid,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      workspacePath,
      accessAuthCode,
    }
    this.exitHandler = (code) => {
      if (this.stopping) return
      this.crashCount += 1
      this.child = null
      this.instance = null
      if (this.crashCount >= MAX_CRASHES) {
        this.lastError = 'KERNEL_CRASHED'
        return
      }
      const restart = this.startInput
      if (!restart) return
      const nextBinary = restart.resolveBinary(restart.pin)
      if (!nextBinary) {
        this.lastError = 'BINARY_MISSING'
        return
      }
      this.spawnOnce(restart, nextBinary, port)
    }
    child.on('exit', (code) => this.exitHandler?.(code))
    return this.instance
  }

  private async waitUntilReady(instance: ManagedInstance, input: ManagedStartInput): Promise<void> {
    const timeoutMs = input.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis)
    const now = input.now ?? Date.now
    const deadline = now() + timeoutMs
    const url = `${instance.baseUrl}/api/system/version`
    while (now() < deadline) {
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        if (response.status === 200) return
      } catch {
        // kernel not listening yet — retry until timeout
      }
      if (now() >= deadline) break
      await delay(READY_POLL_MS)
    }
    this.lastError = 'TIMEOUT'
    throw new ManagedKernelCodedError('TIMEOUT', 'knowledge: kernel did not become ready in time')
  }

  private async seedDefaultNotebook(instance: ManagedInstance, input: ManagedStartInput): Promise<void> {
    await seedDefaultNotebook({
      baseUrl: instance.baseUrl,
      accessAuthCode: instance.accessAuthCode,
      fetchImpl: input.fetchImpl,
      log: input.log,
    })
  }
}

/** After kernel health 200: create Знания when lsNotebooks is empty. */
export async function seedDefaultNotebook(args: {
  baseUrl: string
  accessAuthCode: string
  fetchImpl?: typeof fetch
  log?: { debug?(message: string, extra?: unknown): void }
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Token ${args.accessAuthCode}`,
  }
  try {
    const listResponse = await fetchImpl(`${args.baseUrl}/api/notebook/lsNotebooks`, {
      method: 'POST',
      headers,
      body: '{}',
    })
    const listEnvelope = (await listResponse.json()) as {
      code?: number
      data?: { notebooks?: unknown[] }
    }
    const notebooks = listEnvelope?.data?.notebooks ?? []
    if (notebooks.length > 0) return
    await fetchImpl(`${args.baseUrl}/api/notebook/createNotebook`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Знания' }),
    })
  } catch (error) {
    args.log?.debug?.('knowledge: seedDefaultNotebook failed', error)
  }
}

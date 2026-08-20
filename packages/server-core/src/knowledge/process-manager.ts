/**
 * Supervise a pinned OEM knowledge kernel (H1). Fail-closed unless G2 variant C.
 */
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
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
    opts: { cwd?: string },
  ) => {
    pid: number
    unref(): void
    on(ev: 'exit', cb: (code: number | null) => void): void
    kill(sig?: string): void
  }
  allocatePort: () => number
  now?: () => number
}

export interface ManagedInstance {
  pid: number
  port: number
  baseUrl: string
  workspacePath: string
  accessAuthCode: string
}

interface ChildHandle {
  pid: number
  unref(): void
  on(ev: 'exit', cb: (code: number | null) => void): void
  kill(sig?: string): void
}

const MAX_CRASHES = 5

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
    return this.spawnOnce(input, binary, port)
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
    const accessAuthCode = randomBytes(16).toString('hex')
    const args = [
      `--workspace=${workspacePath}`,
      `--port=${port}`,
      `--accessAuthCode=${accessAuthCode}`,
      '--lang=ru',
    ]
    const child = input.spawnFn(binary, args, { cwd: workspacePath })
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
}

import { spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isNativeSidecarEnabled } from '@craft-agent/shared/feature-flags'
import type { Logger } from '../runtime/platform.ts'
import { connectNativeSidecar, type NativeSidecarClient } from './client.ts'

const DEFAULT_MAX_CRASHES = 3
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000
const DEFAULT_BACKOFF_MS = 250

export interface NativeChild {
  readonly pid?: number
  kill(signal?: NodeJS.Signals): boolean
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
}

export interface NativeSupervisorOptions {
  enabled?: boolean
  resolveBin?: () => string | null
  spawn?: (bin: string, args: string[]) => NativeChild
  connect?: (socketPath: string) => Promise<NativeSidecarClient>
  socketPath?: string
  connectTimeoutMs?: number
  maxCrashes?: number
  backoffMs?: number
  logger?: Logger
  cwd?: string
}

export function resolveNativeBin(cwd = process.cwd()): string | null {
  const fromEnv = process.env.CRAFT_NATIVE_BIN
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const debug = join(cwd, 'native', 'target', 'debug', 'craft-native')
  if (existsSync(debug)) return debug
  const release = join(cwd, 'native', 'target', 'release', 'craft-native')
  if (existsSync(release)) return release
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class NativeSupervisor {
  private running = false
  private disabled = false
  private crashes = 0
  private child: NativeChild | null = null
  private client: NativeSidecarClient | null = null
  private readonly socketPath: string
  private readonly maxCrashes: number
  private readonly connectTimeoutMs: number
  private readonly backoffMs: number
  private readonly logger: Logger | undefined
  private readonly resolveBinFn: () => string | null
  private readonly spawnFn: (bin: string, args: string[]) => NativeChild
  private readonly connectFn: (socketPath: string) => Promise<NativeSidecarClient>
  private readonly waitForSocketFile: boolean
  private readonly enabledOverride: boolean | undefined

  constructor(opts: NativeSupervisorOptions = {}) {
    this.enabledOverride = opts.enabled
    this.socketPath = opts.socketPath ?? join(tmpdir(), `craft-native-${process.pid}-${randomUUID().slice(0, 8)}.sock`)
    this.maxCrashes = opts.maxCrashes ?? DEFAULT_MAX_CRASHES
    this.connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS
    this.logger = opts.logger
    const cwd = opts.cwd ?? process.cwd()
    this.resolveBinFn = opts.resolveBin ?? (() => resolveNativeBin(cwd))
    this.spawnFn = opts.spawn ?? ((bin, args) =>
      nodeSpawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as NativeChild)
    this.connectFn = opts.connect ?? ((path) =>
      connectNativeSidecar(path, { timeoutMs: this.connectTimeoutMs }))
    this.waitForSocketFile = opts.connect === undefined
  }

  isDisabled(): boolean {
    return this.disabled
  }

  getClient(): NativeSidecarClient | null {
    return this.client
  }

  async start(): Promise<void> {
    if (this.enabledOverride === false) return
    const enabled = this.enabledOverride ?? isNativeSidecarEnabled()
    if (!enabled) return
    if (process.platform === 'win32') {
      this.logger?.warn('[native-sidecar] Windows is unsupported; not spawning craft-native')
      this.disabled = true
      return
    }
    this.running = true
    this.disabled = false
    await this.runLoop()
  }

  private async runLoop(): Promise<void> {
    while (this.running && this.crashes < this.maxCrashes) {
      try {
        await this.spawnAndConnect()
        return
      } catch (error) {
        this.crashes++
        this.logger?.warn(
          `[native-sidecar] spawn/connect failed (${this.crashes}/${this.maxCrashes})`,
          error,
        )
        this.killChild()
        if (this.crashes >= this.maxCrashes) break
        await sleep(this.backoffMs)
      }
    }
    this.disabled = true
    this.running = false
    this.logger?.warn('[native-sidecar] disabled after consecutive crashes; TS path remains primary')
  }

  async stop(): Promise<void> {
    this.running = false
    const client = this.client
    this.client = null
    try {
      await client?.close()
    } catch {
      // ignore
    }
    this.killChild()
    this.unlinkSocket()
    this.crashes = 0
    this.disabled = false
  }

  private async spawnAndConnect(): Promise<void> {
    const bin = this.resolveBinFn()
    if (!bin) {
      throw new Error('craft-native binary not found (set CRAFT_NATIVE_BIN or build native/target/debug)')
    }
    this.unlinkSocket()
    let exited = false
    const child = this.spawnFn(bin, ['--socket', this.socketPath])
    this.child = child
    const onExit = () => {
      exited = true
    }
    child.on('exit', onExit)
    child.on('error', onExit)

    try {
      const client = await this.connectUntil(this.socketPath, () => exited)
      this.client = client
      child.on('exit', () => {
        this.client = null
        if (this.running && !this.disabled) {
          this.crashes++
          if (this.crashes >= this.maxCrashes) {
            this.disabled = true
            this.running = false
            this.logger?.warn('[native-sidecar] disabled after consecutive crashes; TS path remains primary')
            return
          }
          void this.runLoop().catch((error) => {
            this.logger?.warn('[native-sidecar] respawn failed', error)
          })
        }
      })
    } catch (error) {
      this.killChild()
      throw error
    }
  }

  private async connectUntil(socketPath: string, isDead: () => boolean): Promise<NativeSidecarClient> {
    const deadline = Date.now() + this.connectTimeoutMs
    let lastError: Error | undefined
    while (Date.now() < deadline) {
      if (isDead()) {
        throw lastError ?? new Error('craft-native exited before handshake')
      }
      if (this.waitForSocketFile && !existsSync(socketPath)) {
        await sleep(20)
        continue
      }
      try {
        return await this.connectFn(socketPath)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        await sleep(20)
      }
    }
    throw lastError ?? new Error('craft-native handshake timed out')
  }

  private killChild(): void {
    const child = this.child
    this.child = null
    if (!child) return
    try {
      child.kill('SIGKILL')
    } catch {
      // ignore
    }
  }

  private unlinkSocket(): void {
    try {
      if (existsSync(this.socketPath)) unlinkSync(this.socketPath)
    } catch {
      // ignore
    }
  }
}

let singleton: NativeSupervisor | null = null

export async function startNativeSidecar(logger?: Logger, cwd?: string): Promise<NativeSupervisor | null> {
  if (!isNativeSidecarEnabled()) return null
  if (!singleton) singleton = new NativeSupervisor({ logger, cwd })
  await singleton.start()
  return singleton
}

export async function stopNativeSidecar(): Promise<void> {
  if (!singleton) return
  await singleton.stop()
  singleton = null
}

export function getNativeSidecarClient(): NativeSidecarClient | null {
  return singleton?.getClient() ?? null
}

/** Test-only: replace the process-wide supervisor (or clear with null). */
export function setNativeSidecarSupervisorForTests(value: NativeSupervisor | null): void {
  singleton = value
}

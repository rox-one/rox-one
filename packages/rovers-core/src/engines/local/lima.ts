/**
 * `@rox/rovers-core` — local Lima engine (M1-B2).
 *
 * Every `limactl` spawn runs with an engine-private `HOME`, `LIMA_HOME` and
 * Docker config, all pointing inside the config's `cacheRoot`, so the user's
 * `~/Library/Caches/lima`, `~/.lima` and `~/.docker/config.json` are never
 * touched (the M1-B2 acceptance assertion). `spawnFn` is injectable so the
 * engine is unit-testable without a Lima installation.
 */

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { RoversError } from '../../errors.ts'
import type { RoversEnginePaths, RoversSpawnEnv } from '../../types.ts'

/** The Lima CLI binary Rox drives. */
export const LIMA_BINARY = 'limactl'

/** Default cap on captured stdout/stderr bytes per run. */
export const LIMA_DEFAULT_MAX_BYTES = 65_536

/** Default per-run wall-clock budget before `SIGKILL`. */
export const LIMA_DEFAULT_TIMEOUT_MS = 120_000

/** Result of one `limactl` invocation; non-zero exits resolve, never reject. */
export interface LimaRunResult {
  code: number
  stdout: string
  stderr: string
}

/** Per-call overrides for {@link LimaEngine.run}. */
export interface LimaRunOptions {
  /** Wall-clock budget in ms before the child is `SIGKILL`ed. */
  timeoutMs?: number
  /** Cap on captured stdout/stderr bytes. */
  maxBytes?: number
}

/** The minimal readable stream surface {@link createLimaEngine} consumes. */
export interface LimaSpawnStdio {
  on(event: 'data', listener: (chunk: Uint8Array | string) => void): unknown
}

/** The signals the engine may send (a subset `ChildProcess.kill` accepts). */
export type LimaKillSignal = 'SIGKILL' | 'SIGTERM' | 'SIGINT'

/** The minimal child-process surface a {@link LimaSpawnFn} must return. */
export interface LimaChildProcess {
  stdout: LimaSpawnStdio | null
  stderr: LimaSpawnStdio | null
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown
  kill(signal?: LimaKillSignal): unknown
}

/** Fixed spawn shape: engine-private `cwd` + env, both stdio pipes captured. */
export interface LimaSpawnOptions {
  cwd: string
  env: RoversSpawnEnv
  stdio: 'pipe'
}

/** Injection seam for the process launcher (tests supply a fake). */
export type LimaSpawnFn = (command: string, args: string[], options: LimaSpawnOptions) => LimaChildProcess

/** The local Lima engine contract. */
export interface LimaEngine {
  binaryPath: string
  env: RoversSpawnEnv
  /** Reported `limactl` version (`x.y.z`), or null when it cannot be parsed. */
  version(): Promise<string | null>
  run(args: string[], options?: LimaRunOptions): Promise<LimaRunResult>
  /** Instance names, one per non-empty `limactl list` line. */
  listInstances(): Promise<string[]>
  /** The engine-private Lima user cache dir (inside `cacheRoot`, never `~`). */
  cacheDir(): string
}

/** Arguments to {@link createLimaEngine}. */
export interface LimaEngineOptions {
  /** The `limactl` binary; defaults to {@link LIMA_BINARY}. */
  binaryPath?: string
  paths: RoversEnginePaths
  /** Base environment; defaults to `process.env`. */
  baseEnv?: Readonly<Record<string, string | undefined>>
  spawnFn?: LimaSpawnFn
}

/**
 * Build the environment for a helper spawn: the caller's env with every
 * engine-owned variable forced into `paths` (`HOME`, `XDG_CACHE_HOME`,
 * `LIMA_HOME`, `DOCKER_CONFIG`, `XDG_CONFIG_HOME`). Non-string base values
 * (`undefined`) are dropped so the result is a clean `Record<string, string>`.
 */
export function buildLimaSpawnEnv(
  paths: RoversEnginePaths,
  base: Readonly<Record<string, string | undefined>> = process.env,
): RoversSpawnEnv {
  const env: RoversSpawnEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === 'string') env[key] = value
  }
  env.HOME = paths.home
  env.XDG_CACHE_HOME = paths.xdgCacheHome
  env.LIMA_HOME = paths.limaHome
  env.DOCKER_CONFIG = join(paths.home, '.docker')
  env.XDG_CONFIG_HOME = join(paths.home, '.config')
  return env
}

/** Lima's user cache dir *as redirected under the engine's private `HOME`. */
export function limaUserCacheDir(paths: RoversEnginePaths): string {
  return join(paths.home, 'Library', 'Caches', 'lima')
}

/**
 * Lima's Unix-socket path ceiling (`UNIX_PATH_MAX`). Lima refuses to create an
 * instance whose `ssh.sock.…` path reaches this length, and the refusal happens
 * deep inside the CLI as an opaque `fatal`, so Rox must pre-flight it.
 *
 * Observed live (2026-10-14, limactl 2.2.1, macOS):
 *   fatal msg="instance name `…` too long: `<limaHome>/<name>/ssh.sock.1234567890123456`
 *              must be less than UNIX_PATH_MAX=104 characters, but is 135"
 */
export const LIMA_UNIX_PATH_MAX = 104

/**
 * The longest instance name Rox may hand to Lima. Rox names instances
 * `rv-<8 hex>` (11 chars); the budget leaves margin without letting the default
 * macOS config root overflow — see {@link assertLimaCacheRootFitsUnixPath}.
 */
export const LIMA_INSTANCE_NAME_MAX = 16

/** Lima appends this under `LIMA_HOME/<instance>/` (16 random digits). */
const LIMA_SSH_SOCKET_SUFFIX = 'ssh.sock.1234567890123456'

/** The exact path Lima length-checks when creating `instanceName`. */
export function limaInstanceSocketPath(limaHome: string, instanceName: string): string {
  return join(limaHome, instanceName, LIMA_SSH_SOCKET_SUFFIX)
}

/** The longest `LIMA_HOME` that can still host a {@link LIMA_INSTANCE_NAME_MAX}-char instance. */
export function limaMaxLimaHomeLength(): number {
  return LIMA_UNIX_PATH_MAX - 1 - LIMA_INSTANCE_NAME_MAX - 1 - LIMA_SSH_SOCKET_SUFFIX.length
}

/**
 * Refuse a cache root Lima could never host an instance under, as a typed
 * `vm_start_failed` with a repairable message — instead of letting the CLI die
 * with `fatal: instance name too long` after the VM image was already pulled.
 */
export function assertLimaCacheRootFitsUnixPath(limaHome: string): void {
  const worstCase = limaInstanceSocketPath(limaHome, 'x'.repeat(LIMA_INSTANCE_NAME_MAX))
  if (worstCase.length >= LIMA_UNIX_PATH_MAX) {
    throw new RoversError(
      'vm_start_failed',
      `Каталог кэша движка слишком длинный для Lima: путь ${worstCase.length} символов при пределе ${LIMA_UNIX_PATH_MAX}.`,
      {
        repairAction: `Выберите более короткий каталог конфигурации Rox (не длиннее ${limaMaxLimaHomeLength()} символов для кэша Lima) и повторите попытку.`,
      },
    )
  }
}

const limaVersionRe = /[0-9]+\.[0-9]+\.[0-9]+/

/** Append a chunk, stopping at `maxBytes` so a chatty helper cannot exhaust memory. */
function appendCapped(current: string, usedBytes: number, chunk: Uint8Array | string, maxBytes: number): {
  text: string
  bytes: number
} {
  const remaining = maxBytes - usedBytes
  if (remaining <= 0) return { text: current, bytes: usedBytes }
  const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)
  if (buffer.byteLength <= remaining) return { text: current + buffer.toString('utf8'), bytes: usedBytes + buffer.byteLength }
  return { text: current + buffer.subarray(0, remaining).toString('utf8'), bytes: maxBytes }
}

/**
 * Create a local Lima engine bound to an engine-private cache tree.
 *
 * `run` never rejects: a non-zero exit, a spawn error and a timeout all resolve
 * with a {@link LimaRunResult} (`code` `-1` when no exit code exists), so
 * callers map failures through the Rovers error taxonomy themselves.
 *
 * Construction is the one throwing point: a cache root Lima could never host an
 * instance under is refused up front ({@link assertLimaCacheRootFitsUnixPath}).
 */
export function createLimaEngine(options: LimaEngineOptions): LimaEngine {
  const binaryPath = options.binaryPath ?? LIMA_BINARY
  const { paths } = options
  assertLimaCacheRootFitsUnixPath(paths.limaHome)
  const env = buildLimaSpawnEnv(paths, options.baseEnv)
  const spawnFn: LimaSpawnFn =
    options.spawnFn ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions))

  const run = (args: string[], runOptions: LimaRunOptions = {}): Promise<LimaRunResult> => {
    const maxBytes = runOptions.maxBytes ?? LIMA_DEFAULT_MAX_BYTES
    const timeoutMs = runOptions.timeoutMs ?? LIMA_DEFAULT_TIMEOUT_MS

    return new Promise<LimaRunResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      let stdoutBytes = 0
      let stderrBytes = 0
      let settled = false

      const finish = (code: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code, stdout, stderr })
      }

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // The child already exited — its `close` event settles the run.
        }
      }, timeoutMs)

      const child = spawnFn(binaryPath, args, { cwd: paths.home, env, stdio: 'pipe' })

      child.stdout?.on('data', (chunk) => {
        const next = appendCapped(stdout, stdoutBytes, chunk, maxBytes)
        stdout = next.text
        stdoutBytes = next.bytes
      })
      child.stderr?.on('data', (chunk) => {
        const next = appendCapped(stderr, stderrBytes, chunk, maxBytes)
        stderr = next.text
        stderrBytes = next.bytes
      })
      child.on('error', (error) => {
        const next = appendCapped(stderr, stderrBytes, `spawn error: ${error.message}`, maxBytes)
        stderr = next.text
        stderrBytes = next.bytes
        finish(-1)
      })
      child.on('close', (code) => finish(typeof code === 'number' ? code : -1))
    })
  }

  return {
    binaryPath,
    env,
    run,
    async version(): Promise<string | null> {
      const result = await run(['--version'])
      return result.stdout.match(limaVersionRe)?.[0] ?? null
    },
    async listInstances(): Promise<string[]> {
      const result = await run(['list', '--format', '{{.Name}}'])
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    },
    cacheDir: () => limaUserCacheDir(paths),
  }
}

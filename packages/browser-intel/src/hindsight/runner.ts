/**
 * Hindsight process runner.
 *
 * Hindsight (PyPI `pyhindsight`, Python >= 3.11) is invoked once per staged
 * profile to produce a SQLite timeline. Resolution prefers an explicitly
 * configured binary, then the wrapper ROX ships beside its resources, then the
 * `uv`-managed Python module, and only in a dev checkout falls back to a bare
 * `hindsight` on `PATH` — a packaged host never silently picks up a random
 * interpreter from the user's shell.
 *
 * `run()` converts `-o`/`-l` to absolute paths: Hindsight resolves a relative
 * output name against its own script directory (writing into the venv), which
 * would strand the file where the bridge cannot find it.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { resolveScriptRuntime } from '@rox/session-tools-core'

import type { HindsightCommand, HindsightRunOptions, HindsightRunResult, HindsightRunnerDeps } from '../types.ts'

export const DEFAULT_HINDSIGHT_TIMEOUT_MS = 900_000
export const HINDSIGHT_LOG_TAIL_LINES = 100
/** Stderr lines surfaced when a run fails, so the message stays actionable. */
export const HINDSIGHT_ERROR_TAIL_LINES = 40
export const HINDSIGHT_KILL_GRACE_MS = 5_000

/**
 * `uv tool run` arguments for the Python-module fallback. The PyPI package
 * installs a `hindsight.py` script (no console entry point) and imports the
 * git-only `ccl_chromium_reader` at load time, so both are requested here.
 */
const HINDSIGHT_MODULE_ARGS = [
  '--from',
  'pyhindsight',
  '--with',
  'ccl-chromium-reader @ git+https://github.com/cclgroupltd/ccl_chromium_reader.git',
  'hindsight.py',
] as const

/** Executable names looked up on `PATH` in a dev checkout. */
const PATH_BINARY_NAMES = ['hindsight', 'hindsight.py'] as const

function resourcesBase(env: NodeJS.ProcessEnv): string | null {
  if (env.CRAFT_RESOURCES_BASE) return env.CRAFT_RESOURCES_BASE
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) return join(resourcesPath, 'app')
  return env.CRAFT_APP_ROOT ?? null
}

function findOnPath(
  binary: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  present: (path: string) => boolean,
): string | null {
  const rawPath = env.PATH ?? env.Path ?? env.path ?? ''
  const delimiter = platform === 'win32' ? ';' : ':'
  const extensions =
    platform === 'win32' ? (env.PATHEXT ? env.PATHEXT.split(';') : ['.COM', '.EXE', '.BAT', '.CMD']) : ['']
  for (const dir of rawPath.split(delimiter)) {
    if (!dir) continue
    for (const extension of extensions) {
      const candidate = join(dir, `${binary}${extension}`)
      if (present(candidate)) return candidate
    }
  }
  return null
}

/**
 * Resolve how to invoke Hindsight, most specific source first.
 *
 * @throws when nothing resolves; use {@link HindsightRunner.isAvailable} to
 * probe without an exception.
 */
export function resolveHindsightCommand(deps: HindsightRunnerDeps = {}): HindsightCommand {
  const env = deps.env ?? process.env
  const platform = deps.platform ?? process.platform
  const exists = deps.exists ?? existsSync
  const stat = deps.stat
  const present = (path: string): boolean => {
    if (!exists(path)) return false
    if (!stat) return true
    try {
      return stat(path).isFile()
    } catch {
      return false
    }
  }

  // (a) Explicit binary: must be an absolute path that exists.
  for (const key of ['ROX_HINDSIGHT_BIN', 'CRAFT_HINDSIGHT'] as const) {
    const value = env[key]?.trim()
    if (value && isAbsolute(value) && present(value)) {
      return { command: value, argsPrefix: [], source: 'env' }
    }
  }

  // (b) Wrapper shipped beside the app resources.
  const base = resourcesBase(env)
  if (base) {
    const wrapper = join(base, 'resources', 'bin', platform === 'win32' ? 'hindsight.cmd' : 'hindsight')
    if (present(wrapper)) return { command: wrapper, argsPrefix: [], source: 'bundled' }
  }

  // (c) `uv`-managed Python module. `uv tool run` (not `uv run`) is what can
  // reach the packaged `hindsight.py` script, so the resolver's leading `run`
  // is replaced with `tool run`, keeping its `--python X`.
  try {
    const runtime = resolveScriptRuntime('python3')
    const rest = runtime.argsPrefix[0] === 'run' ? runtime.argsPrefix.slice(1) : runtime.argsPrefix
    return {
      command: runtime.command,
      argsPrefix: ['tool', 'run', ...rest, ...HINDSIGHT_MODULE_ARGS],
      source: 'python-module',
    }
  } catch {
    // uv is unavailable; a dev checkout may still carry Hindsight on PATH.
  }

  // (d) Dev-only PATH lookup.
  const packaged = env.CRAFT_IS_PACKAGED === '1' || env.CRAFT_IS_PACKAGED === 'true'
  if (!packaged) {
    for (const name of PATH_BINARY_NAMES) {
      const found = findOnPath(name, env, platform, present)
      if (found) return { command: found, argsPrefix: [], source: 'path' }
    }
  }

  throw new Error(
    'Hindsight is unavailable: set ROX_HINDSIGHT_BIN/CRAFT_HINDSIGHT, ship a bundled wrapper, ' +
      'or provide uv so the pyhindsight module can be run.',
  )
}

/** Keeps the last {@link HINDSIGHT_LOG_TAIL_LINES} lines of a text stream. */
class TailBuffer {
  #lines: string[] = []
  #partial = ''

  push(chunk: string): void {
    const parts = (this.#partial + chunk).split('\n')
    this.#partial = parts.pop() ?? ''
    for (const part of parts) this.#lines.push(part.replace(/\r$/, ''))
    if (this.#lines.length > HINDSIGHT_LOG_TAIL_LINES) {
      this.#lines.splice(0, this.#lines.length - HINDSIGHT_LOG_TAIL_LINES)
    }
  }

  toString(): string {
    const lines = this.#partial.length > 0 ? [...this.#lines, this.#partial] : this.#lines
    return lines.slice(-HINDSIGHT_LOG_TAIL_LINES).join('\n')
  }
}

export class HindsightRunner {
  readonly #deps: HindsightRunnerDeps

  constructor(deps: HindsightRunnerDeps = {}) {
    this.#deps = deps
  }

  /** Whether a command resolves; never throws. */
  isAvailable(): boolean {
    try {
      resolveHindsightCommand(this.#deps)
      return true
    } catch {
      return false
    }
  }

  async run(options: HindsightRunOptions): Promise<HindsightRunResult> {
    const command = resolveHindsightCommand(this.#deps)
    const spawnImpl = this.#deps.spawn ?? spawn
    const exists = this.#deps.exists ?? existsSync

    const outputBase = isAbsolute(options.outputBase) ? options.outputBase : resolve(options.outputBase)
    const logPath = options.logPath ? (isAbsolute(options.logPath) ? options.logPath : resolve(options.logPath)) : undefined
    const outputPath = `${outputBase}.sqlite`

    const args = [...command.argsPrefix, '-i', options.input, '-o', outputBase, '-f', 'sqlite']
    if (options.browserType) args.push('-b', options.browserType)
    if (options.only && options.only.length > 0) for (const artifact of options.only) args.push('--only', artifact)
    if (logPath) args.push('-l', logPath)
    if (options.logLevel) args.push('--log-level', options.logLevel)
    if (options.noCopy) args.push('--nocopy')

    const timeoutMs = options.timeoutMs ?? DEFAULT_HINDSIGHT_TIMEOUT_MS
    const startedAt = Date.now()

    const { promise, resolve: resolveRun, reject: rejectRun } = Promise.withResolvers<HindsightRunResult>()
    let child: ChildProcess
    try {
      child = spawnImpl(command.command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      rejectRun(error instanceof Error ? error : new Error(String(error)))
      return promise
    }

    const stdout = new TailBuffer()
    const stderr = new TailBuffer()
    child.stdout?.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr?.on('data', (chunk) => stderr.push(String(chunk)))

    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    const terminate = (): void => {
      if (settled) return
      try {
        child.kill('SIGTERM')
      } catch {
        // Process already exited.
      }
      if (killTimer === undefined) {
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // Process already exited.
          }
        }, HINDSIGHT_KILL_GRACE_MS)
      }
    }
    const onAbort = (): void => terminate()
    const cleanup = (): void => {
      clearTimeout(timeoutTimer)
      clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', onAbort)
    }

    if (options.signal) {
      if (options.signal.aborted) terminate()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }
    if (timeoutMs > 0) timeoutTimer = setTimeout(terminate, timeoutMs)

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      rejectRun(error instanceof Error ? error : new Error(String(error)))
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      cleanup()
      const exitCode = typeof code === 'number' ? code : signal ? 1 : 0
      // The staged input is a *live* browser database, so a crashed Hindsight
      // run is expected occasionally; surface the engine's own diagnostics and
      // never hand a half-written (hot-journal) database to the parser.
      const stderrTail = stderr.toString().split('\n').slice(-HINDSIGHT_ERROR_TAIL_LINES).join('\n')
      if (exitCode !== 0) {
        rejectRun(new Error(`Hindsight exited with code ${exitCode}${stderrTail ? `\n${stderrTail}` : ''}`))
        return
      }
      if (!exists(outputPath)) {
        rejectRun(
          new Error(`Hindsight produced no output file at ${outputPath}${stderrTail ? `\n${stderrTail}` : ''}`),
        )
        return
      }
      resolveRun({
        outputPath,
        format: 'sqlite',
        exitCode,
        durationMs: Date.now() - startedAt,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        // Hindsight's console layout is unstable; the parser reads the real
        // distinct values from the produced `timeline.profile` column.
        profilesDetected: [],
      })
    })
    return promise
  }
}
/**
 * Read-only git subprocesses. argv only (no shell), aliases and fsmonitor off.
 */

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { emptyGitWorkingTreeStatus, parseGitPorcelainV1, type GitWorkingTreeStatus } from './status.ts'

const GIT_TIMEOUT_MS = 5000
const GIT_READ_CACHE_TTL_MS = 1000
const GIT_READ_CACHE_SWEEP_SIZE = 128
const DEV_NULL = process.platform === 'win32' ? 'NUL' : '/dev/null'
const STATUS_COMMAND = ['status', '--porcelain=v1', '-b']
const BRANCH_COMMAND = ['rev-parse', '--abbrev-ref', 'HEAD']

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: DEV_NULL,
    GIT_OPTIONAL_LOCKS: '0',
  }
}

function gitArgs(command: string[]): string[] {
  return [
    '-c',
    'alias.status=',
    '-c',
    'alias.rev-parse=',
    '-c',
    'core.fsmonitor=',
    '-c',
    'core.hooksPath=',
    ...command,
  ]
}

export function execGitReadOnly(command: string[], cwd: string, timeout = GIT_TIMEOUT_MS): string {
  return execFileSync('git', gitArgs(command), {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout,
    env: gitEnv(),
  })
}

export function readGitWorkingTreeStatus(cwd: string): GitWorkingTreeStatus {
  try {
    const raw = execGitReadOnly(STATUS_COMMAND, cwd)
    return parseGitPorcelainV1(raw)
  } catch {
    return emptyGitWorkingTreeStatus()
  }
}

export function readGitBranchName(cwd: string): string | null {
  try {
    const branch = execGitReadOnly(BRANCH_COMMAND, cwd).trim()
    return branch || null
  } catch {
    return null
  }
}

export type GitExecFileAsync = (
  file: string,
  args: string[],
  options: { cwd: string; encoding: 'utf-8'; timeout: number; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>

const execFileAsync = promisify(execFile)
const nodeExecFileAsync: GitExecFileAsync = (file, args, options) => execFileAsync(file, args, options)

export interface GitReadOnlyRunnerOptions {
  execFile?: GitExecFileAsync
  now?: () => number
  cacheTtlMs?: number
}

export interface GitReadOnlyRunner {
  /** Raw child launcher (no read-only env/args, no single-flight); for callers needing normal git config. */
  execFile: GitExecFileAsync
  execGitReadOnlyAsync(command: string[], cwd: string, timeout?: number): Promise<string>
  readGitWorkingTreeStatusAsync(cwd: string): Promise<GitWorkingTreeStatus>
  readGitBranchNameAsync(cwd: string): Promise<string | null>
  /** Drops cached and in-flight reads for `cwd` (all dirs when omitted); call after any git write there. */
  invalidateGitReadCache(cwd?: string): void
}

/**
 * Async read-only git: identical (cwd, command) calls in flight share one child,
 * and status/branch results are reused for `cacheTtlMs`.
 */
export function createGitReadOnlyRunner(options: GitReadOnlyRunnerOptions = {}): GitReadOnlyRunner {
  const run = options.execFile ?? nodeExecFileAsync
  const now = options.now ?? Date.now
  const ttlMs = options.cacheTtlMs ?? GIT_READ_CACHE_TTL_MS
  const inFlight = new Map<string, Promise<string>>()
  const cache = new Map<string, { cwd: string; expiresAt: number; value: unknown }>()
  let generation = 0

  function execGitReadOnlyAsync(command: string[], cwd: string, timeout = GIT_TIMEOUT_MS): Promise<string> {
    const key = `${cwd}\0${command.join('\0')}`
    const pending = inFlight.get(key)
    if (pending) return pending
    const promise: Promise<string> = Promise.resolve()
      .then(() => run('git', gitArgs(command), { cwd, encoding: 'utf-8', timeout, env: gitEnv() }))
      .then(({ stdout }) => stdout)
      .finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key)
      })
    inFlight.set(key, promise)
    return promise
  }

  async function cachedRead<T>(kind: string, cwd: string, load: () => Promise<T>): Promise<T> {
    const key = `${kind}\0${cwd}`
    const hit = cache.get(key)
    if (hit && hit.expiresAt > now()) return hit.value as T
    const startedAt = generation
    const value = await load()
    if (startedAt === generation) {
      if (cache.size >= GIT_READ_CACHE_SWEEP_SIZE) {
        const at = now()
        for (const [k, entry] of cache) if (entry.expiresAt <= at) cache.delete(k)
      }
      cache.set(key, { cwd, expiresAt: now() + ttlMs, value })
    }
    return value
  }

  async function readGitWorkingTreeStatusAsync(cwd: string): Promise<GitWorkingTreeStatus> {
    const status = await cachedRead('status', cwd, async () => {
      try {
        return parseGitPorcelainV1(await execGitReadOnlyAsync(STATUS_COMMAND, cwd))
      } catch {
        return emptyGitWorkingTreeStatus()
      }
    })
    return { ...status, entries: status.entries.map((entry) => ({ ...entry })) }
  }

  function readGitBranchNameAsync(cwd: string): Promise<string | null> {
    return cachedRead('branch', cwd, async () => {
      try {
        const branch = (await execGitReadOnlyAsync(BRANCH_COMMAND, cwd)).trim()
        return branch || null
      } catch {
        return null
      }
    })
  }

  function invalidateGitReadCache(cwd?: string): void {
    generation++
    for (const [key, entry] of cache) if (cwd === undefined || entry.cwd === cwd) cache.delete(key)
    for (const key of inFlight.keys()) if (cwd === undefined || key.startsWith(`${cwd}\0`)) inFlight.delete(key)
  }

  return {
    execFile: run,
    execGitReadOnlyAsync,
    readGitWorkingTreeStatusAsync,
    readGitBranchNameAsync,
    invalidateGitReadCache,
  }
}

export const gitReadOnlyRunner = createGitReadOnlyRunner()

export const {
  execGitReadOnlyAsync,
  readGitWorkingTreeStatusAsync,
  readGitBranchNameAsync,
  invalidateGitReadCache,
} = gitReadOnlyRunner

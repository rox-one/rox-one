/**
 * git-exec — argv-only async `git` runner for the memory repository
 * (spec `docs/plans/2026-10-09-memory-repository-and-dreaming.md` §6).
 *
 * Shape mirrors `packages/shared/src/code-intelligence/refs.ts:225-234`:
 * `execFile('git', ...)` with no shell, fixed `-c` overrides, a read/write-safe
 * environment and a bounded timeout. The runner is deliberately small and never
 * resolves a repository itself — callers pass explicit `GIT_DIR`/`GIT_WORK_TREE`
 * through `opts.env` (the memory repo always lives in `<repo>/.git-rox`).
 *
 * Safety: destructive/branch-rewriting subcommands are rejected up front
 * (spec §6 «никогда: push, reset --hard, clean -fdx, checkout -f, rebase, amend»).
 */

import { execFile } from 'node:child_process'
import { readGitIdentity } from '../git/workspace.ts'

export interface GitExecResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
}

export interface GitExec {
  available(): Promise<boolean>
  run(args: string[], opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number }): Promise<GitExecResult>
}

/** Windows has no /dev/null; mirrors `DEV_NULL` in packages/shared/src/git/exec.ts:9. */
const DEV_NULL = process.platform === 'win32' ? 'NUL' : '/dev/null'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_BUFFER_BYTES = 4 * 1024 * 1024

/**
 * How long a git-availability probe (including a `false` result) is reused.
 * The git binary's presence is effectively static for a session, so a single
 * probe per TTL replaces the per-read `git --version` spawn (telemetry R9).
 */
const DEFAULT_AVAILABLE_TTL_MS = 30_000

const FALLBACK_IDENTITY = { name: 'Rox', email: 'rox@localhost' } as const

/** Subcommands the memory repository must never run. */
const FORBIDDEN_SUBCOMMANDS: Record<string, true> = {
  push: true,
  pull: true,
  fetch: true,
  rebase: true,
  clean: true,
  'filter-branch': true,
  gc: true,
  prune: true,
}

function forbiddenArgs(args: string[]): string | null {
  const command = args.find((arg) => !arg.startsWith('-'))
  if (!command) return null
  if (FORBIDDEN_SUBCOMMANDS[command]) return command
  if (command === 'reset' && args.includes('--hard')) return 'reset --hard'
  if (command === 'commit' && args.includes('--amend')) return 'commit --amend'
  if (command === 'checkout' && (args.includes('-f') || args.includes('--force'))) return 'checkout -f'
  return null
}

/**
 * Identity is read once per cwd (real user identity when the tree has one —
 * e.g. an in-repo override — else the Rox fallback) and reused for every call.
 */
const identityCache = new Map<string, { name: string; email: string }>()

function identityArgs(cwd: string): string[] {
  let identity = identityCache.get(cwd)
  if (!identity) {
    identity = readGitIdentity(cwd) ?? { name: FALLBACK_IDENTITY.name, email: FALLBACK_IDENTITY.email }
    identityCache.set(cwd, identity)
  }
  return ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`]
}

/** `error.code` is numeric for a non-zero git exit, a string (e.g. ENOENT) for spawn failures. */
function readExitCode(error: unknown): number | null {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'number') return error.code
  return null
}

async function runGit(
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number },
): Promise<GitExecResult> {
  const forbidden = forbiddenArgs(args)
  if (forbidden) {
    return { ok: false, stdout: '', stderr: `forbidden git command: ${forbidden}`, code: null }
  }
  const full = [
    '-c', 'core.fsmonitor=false',
    '-c', `core.hooksPath=${DEV_NULL}`,
    '-c', 'commit.gpgsign=false',
    ...identityArgs(opts.cwd),
    ...args,
  ]
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    ...opts.env,
  }
  const { promise, resolve } = Promise.withResolvers<GitExecResult>()
  execFile(
    'git',
    full,
    {
      cwd: opts.cwd,
      env,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
    (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout ?? '', stderr: stderr ?? '', code: readExitCode(error) })
    },
  )
  return promise
}

/** Test hook: forget cached commit identities (called by focused tests). */
export function resetGitIdentityCacheForTests(): void {
  identityCache.clear()
}

export interface AvailabilityMemo {
  available(): Promise<boolean>
  /** Test hook: drop the cached result and any in-flight probe. */
  reset(): void
}

/**
 * Memoize a boolean probe for `ttlMs` (default {@link DEFAULT_AVAILABLE_TTL_MS}):
 * a cached result (true or false) is reused until it expires, and concurrent
 * calls share one in-flight probe. A rejected probe resolves to `false` and is
 * cached like any other result — {@link AvailabilityMemo.available} never throws.
 */
export function createAvailabilityMemo(
  probe: () => Promise<boolean>,
  opts: { ttlMs?: number; now?: () => number } = {},
): AvailabilityMemo {
  const ttlMs = opts.ttlMs ?? DEFAULT_AVAILABLE_TTL_MS
  const now = opts.now ?? Date.now
  let cached: { value: boolean; expiresAt: number } | null = null
  let inflight: Promise<boolean> | null = null
  return {
    available(): Promise<boolean> {
      if (cached && now() < cached.expiresAt) return Promise.resolve(cached.value)
      if (!inflight) {
        inflight = probe()
          .catch(() => false)
          .then((value) => {
            cached = { value, expiresAt: now() + ttlMs }
            inflight = null
            return value
          })
      }
      return inflight
    },
    reset(): void {
      cached = null
      inflight = null
    },
  }
}

export interface GitExecOptions {
  /** TTL (ms) for the cached `available()` probe result; defaults to 30_000. */
  availableTtlMs?: number
}

export function createGitExec(options: GitExecOptions = {}): GitExec {
  const availability = createAvailabilityMemo(
    async () => (await runGit(['--version'], { cwd: process.cwd(), timeoutMs: 3000 })).ok,
    { ttlMs: options.availableTtlMs },
  )
  return {
    available: () => availability.available(),
    run: runGit,
  }
}
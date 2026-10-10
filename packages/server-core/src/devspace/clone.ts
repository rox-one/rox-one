/**
 * Server-side git transport for Dev Space repository ingest.
 *
 * Long operations invoke the git binary directly with an `AbortSignal` and a
 * long timeout — never through `shell:exec` (20 s timeout / 1 MiB cap; spec §6.3).
 * A GitHub token is handed to git only through a temporary `GIT_ASKPASS` helper
 * (mode 0600, removed after use) plus `GIT_ASKPASS_TOKEN` in the child env; the
 * token never appears in argv, logs, pushes or thrown messages.
 */
import { execFile, type ChildProcess } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DevSpaceCloneProgress } from '@rox/shared/dev-space'

/**
 * O9 (closed 2026-10-10): full history is the chosen default — Dev Space
 * analysis (churn, archaeology, codegraph) needs commits, and the cost stays
 * bounded by `CLONE_TIMEOUT_MS`, the `--progress` output cap and the
 * post-clone `MAX_REPO_BYTES` guard. A per-repo shallow lever stays on the
 * v1.x list.
 */
export const CLONE_DEPTH = 'full'
/** Long clones must outlive the short `shell:exec` budget (O9 keeps 30 min). */
export const CLONE_TIMEOUT_MS = 30 * 60 * 1000
const PULL_TIMEOUT_MS = 10 * 60 * 1000
/** v1.x auto-watch (O10): a `--quiet --prune` fetch is bounded well below a full pull. */
const FETCH_TIMEOUT_MS = 5 * 60 * 1000
/** Local-only `rev-parse` reads; no network step, so a short timeout is enough. */
const REV_PARSE_TIMEOUT_MS = 30_000
/** Hooks/fsmonitor are disabled for every repo-scoped git invocation (untrusted checkout). */
const LOCAL_HARDENING = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'] as const
/** O9: a checkout whose `.git` exceeds this (`size` + `size-pack`) is rejected after fetch. */
export const MAX_REPO_BYTES = 2 * 1024 * 1024 * 1024
/** `--progress` streams to stderr; keep a generous cap so a large clone never trips maxBuffer. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** Git progress labels we forward to the renderer; anything else is ignored. */
const PROGRESS_PHASES: Readonly<Record<string, true>> = {
  'counting-objects': true,
  'compressing-objects': true,
  'receiving-objects': true,
  'resolving-deltas': true,
}

const BYTE_UNITS: Readonly<Record<string, number>> = {
  b: 1,
  kib: 1024,
  mib: 1024 * 1024,
  gib: 1024 * 1024 * 1024,
  tib: 1024 * 1024 * 1024 * 1024,
}

export type CloneErrorCode =
  | 'request-cancelled'
  | 'git-unavailable'
  | 'authentication-required'
  | 'network-unavailable'
  | 'repository-not-found'
  | 'clone-too-large'
  | 'clone-failed'

export class CloneError extends Error {
  constructor(readonly code: CloneErrorCode) {
    super(code)
    this.name = 'CloneError'
  }
}

/** Only the fixed git argv; the token is never an argument. */
export function cloneArgs(url: string, destination: string): string[] {
  return ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', 'clone', '--progress', url, destination]
}

/** Child env for git. `askpass` is the only place a token may appear (never argv/logs). */
export function gitProcessEnv(base: NodeJS.ProcessEnv, askpass: { path: string; token: string } | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
  if (askpass) {
    env.GIT_ASKPASS = askpass.path
    env.GIT_ASKPASS_TOKEN = askpass.token
  }
  return env
}

function parseByteSize(raw: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)\b/i.exec(raw)
  if (!match) return undefined
  const unit = BYTE_UNITS[match[2]!.toLowerCase()]
  return unit === undefined ? undefined : Math.round(Number(match[1]) * unit)
}

/** Map one git stderr line to a renderer-safe progress event; returns null for non-progress lines. */
export function parseCloneProgress(repositoryId: string, rawLine: string): DevSpaceCloneProgress | null {
  let line = rawLine.trim()
  if (line.startsWith('remote: ')) line = line.slice('remote: '.length).trim()
  const label = /^([A-Za-z][A-Za-z ]{2,30}):/.exec(line)
  if (!label) return null
  const phase = label[1]!.trim().toLowerCase().replace(/\s+/g, '-')
  if (!(phase in PROGRESS_PHASES)) return null
  const receivedBytes = parseByteSize(line)
  return { repositoryId, phase, ...(receivedBytes !== undefined ? { receivedBytes } : {}) }
}

/**
 * `git count-objects -v` reports `size` and `size-pack` in KiB. Sum them into
 * bytes; a line that is missing or malformed contributes 0, so the guard stays
 * a backstop and never turns a healthy checkout into a false failure.
 */
export function countObjectsBytes(stdout: string): number {
  let kib = 0
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(?:size|size-pack):\s*(\d+)$/.exec(line.trim())
    if (match) kib += Number(match[1])
  }
  return kib * 1024
}

/** Temporary askpass helper: username is fixed, password is read from the child env (`GIT_ASKPASS_TOKEN`). */
async function createAskpassHelper(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'rox-devspace-askpass-'))
  const path = join(directory, 'askpass.sh')
  const script = '#!/bin/sh\n'
    + 'case "$1" in\n'
    + '  *[Uu]sername*) printf \'%s\\n\' x-access-token ;;\n'
    + '  *) printf \'%s\\n\' "$GIT_ASKPASS_TOKEN" ;;\n'
    + 'esac\n'
  await writeFile(path, script, { mode: 0o600 })
  await chmod(path, 0o600)
  return { directory, path }
}

function classify(error: NodeJS.ErrnoException, token: string | null, aborted: boolean): CloneErrorCode {
  if (aborted || error.name === 'AbortError') return 'request-cancelled'
  if (error.code === 'ENOENT') return 'git-unavailable'
  // Strip any token occurrence so it can never surface in a thrown message.
  const message = token && token.length > 0 ? error.message.split(token).join('[redacted]') : error.message
  if (/could not resolve host|unable to access|network|connection (refused|timed out)|Could not read from remote/i.test(message)) return 'network-unavailable'
  if (/authentication failed|could not read Username|terminal prompts disabled|403|permission denied/i.test(message)) return 'authentication-required'
  if (/repository .* not found|not found/i.test(message)) return 'repository-not-found'
  return 'clone-failed'
}

interface RunGitOptions {
  readonly args: readonly string[]
  readonly token: string | null
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly repositoryId: string
  readonly onProgress?: (progress: DevSpaceCloneProgress) => void
}

async function runGit(options: RunGitOptions): Promise<void> {
  const helper = options.token ? await createAskpassHelper() : null
  const askpass = helper && options.token ? { path: helper.path, token: options.token } : null
  const onProgress = options.onProgress
  try {
    await new Promise<void>((resolve, reject) => {
      const child: ChildProcess = execFile('git', [...options.args], {
        env: gitProcessEnv(process.env, askpass),
        signal: options.signal,
        timeout: options.timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        encoding: 'utf8',
      }, (error) => {
        if (error) reject(new CloneError(classify(error as NodeJS.ErrnoException, options.token, options.signal.aborted)))
        else resolve()
      })
      child.stderr?.on('data', (chunk: Buffer | string) => {
        if (!onProgress) return
        for (const line of String(chunk).split(/\r\n|\r|\n/)) {
          const progress = parseCloneProgress(options.repositoryId, line)
          if (progress) onProgress(progress)
        }
      })
    })
  } finally {
    if (helper) await rm(helper.directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** O9 size guard: reject a checkout whose `.git` (`size` + `size-pack`) exceeds `MAX_REPO_BYTES`. */
async function assertRepoSizeWithinBudget(directory: string): Promise<void> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-C', directory, 'count-objects', '-v'], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    }, (error, out) => {
      if (error) reject(new CloneError(classify(error as NodeJS.ErrnoException, null, false)))
      else resolve(out)
    })
  })
  if (countObjectsBytes(stdout) > MAX_REPO_BYTES) throw new CloneError('clone-too-large')
}

export async function runGitClone(input: {
  readonly url: string
  readonly destination: string
  readonly repositoryId: string
  readonly token: string | null
  readonly signal: AbortSignal
  readonly onProgress?: (progress: DevSpaceCloneProgress) => void
}): Promise<void> {
  await runGit({
    args: cloneArgs(input.url, input.destination),
    token: input.token,
    signal: input.signal,
    timeoutMs: CLONE_TIMEOUT_MS,
    repositoryId: input.repositoryId,
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  })
  await assertRepoSizeWithinBudget(input.destination)
}

/** Shared input for the repo-scoped pull/fetch transports; the token is never an argument. */
export interface GitFetchInput {
  readonly workingDirectory: string
  readonly repositoryId: string
  readonly token: string | null
  readonly signal: AbortSignal
}

export async function runGitPull(input: GitFetchInput): Promise<void> {
  await runGit({
    args: [...LOCAL_HARDENING, '-C', input.workingDirectory, 'pull', '--ff-only'],
    token: input.token,
    signal: input.signal,
    timeoutMs: PULL_TIMEOUT_MS,
    repositoryId: input.repositoryId,
  })
  await assertRepoSizeWithinBudget(input.workingDirectory)
}

/**
 * v1.x auto-watch (O10): refresh remote-tracking refs only (`--quiet --prune`);
 * the working copy is left untouched so the user's checkout is never rewritten
 * by a background sweep. Errors surface as `CloneError`, exactly like pull.
 */
export async function runGitFetch(input: GitFetchInput): Promise<void> {
  await runGit({
    args: [...LOCAL_HARDENING, '-C', input.workingDirectory, 'fetch', '--quiet', '--prune'],
    token: input.token,
    signal: input.signal,
    timeoutMs: FETCH_TIMEOUT_MS,
    repositoryId: input.repositoryId,
  })
}

export interface GitTrackingState {
  /** Local `HEAD` sha. */
  readonly head: string
  /** Upstream (`@{u}`) sha, or null when the branch has no upstream configured. */
  readonly upstream: string | null
}

/** Local-only `git` read; never carries a token and never touches the network. */
async function execGitStdout(args: readonly string[], signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile('git', [...args], {
      env: gitProcessEnv(process.env, null),
      signal,
      timeout: REV_PARSE_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      encoding: 'utf8',
    }, (error, stdout) => {
      if (error) reject(error)
      else resolve(String(stdout ?? ''))
    })
  })
}

export interface GitTrackingInput {
  readonly workingDirectory: string
  readonly signal: AbortSignal
}

/**
 * Read the local `HEAD` and the branch upstream sha for the watch comparison
 * (O10). A missing upstream is not an error: it yields `upstream: null`, so the
 * tick treats a branch without tracking as "no remote movement observed".
 */
export async function readGitTrackingState(input: GitTrackingInput): Promise<GitTrackingState> {
  const head = (await execGitStdout([...LOCAL_HARDENING, '-C', input.workingDirectory, 'rev-parse', 'HEAD'], input.signal)).trim()
  let upstream: string | null = null
  try {
    const raw = (await execGitStdout([...LOCAL_HARDENING, '-C', input.workingDirectory, 'rev-parse', '--verify', '--quiet', '@{u}'], input.signal)).trim()
    upstream = raw.length > 0 ? raw : null
  } catch (error) {
    if (input.signal.aborted) throw error
    upstream = null
  }
  return { head, upstream }
}
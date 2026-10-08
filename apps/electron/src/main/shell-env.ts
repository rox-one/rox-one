/**
 * Shell Environment Loader
 *
 * When Electron apps are launched from Finder/Dock on macOS, they inherit
 * a minimal launchd environment with PATH=/usr/bin:/bin:/usr/sbin:/sbin.
 *
 * This module loads the user's full shell environment by spawning their
 * login shell and extracting environment variables. This ensures tools
 * like Homebrew (gh, brew), nvm, pyenv, etc. are available to the agent.
 *
 * PERF-03: the capture no longer blocks startup. The previous implementation
 * ran `execSync(<shell> -l -i -c env)` (up to 5 s with oh-my-zsh/nvm/pyenv)
 * before `electron` was even imported. Now:
 *
 * 1. a disk cache (`~/Library/Caches/Rox/shell-env/env.json`: 0600 file in a
 *    0700 dir; keyed by $SHELL + rc-file size/mtime; 24 h TTL) is applied
 *    synchronously — one small JSON read — so PATH is right immediately. A
 *    matching but expired cache is applied too (not ready; refreshed at once);
 *    without any cache the common Homebrew/user bin dirs are prepended;
 * 2. the login shell runs asynchronously in the background (stdin at EOF,
 *    SIGKILL on timeout) and its result is merged into process.env and
 *    written back to the cache;
 * 3. code that is about to spawn a child that needs the user's PATH (agent
 *    sessions, builtin MCP startup, MCP validation, git, siyuan) awaits the
 *    host's spawn-env gate (`shellEnvSpawnGate`). When the cache was complete
 *    it resolves immediately; otherwise it resolves when the capture finishes
 *    or after a bounded wait — which latches, so only the first spawn can pay it.
 *
 * Secret-shaped variables (token/key/password/PAT/DSN/webhook names, URLs with
 * userinfo) are never written to the cache; they arrive with the background
 * capture, and readiness waits for it whenever the cache had to omit any.
 * Known non-secrets (SSH_AUTH_SOCK, TERM_SESSION_ID, …) are exempt so they do
 * not mark the cache incomplete.
 */

import { execFile } from 'child_process'
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { mainLog } from './logger'

// Environment variables that should NOT be imported from the shell
// VITE_* vars from dev mode would make packaged app try to load from localhost
const shouldSkipEnvVar = (key: string): boolean => {
  return key.startsWith('VITE_')
}

/**
 * Never persisted to the on-disk cache (they still reach process.env live).
 * Deliberately broad: anything token/key/password/DSN/webhook-shaped.
 */
const SECRET_ENV_KEY = /(TOKEN|SECRET|PASS|API_?KEY|ACCESS_?KEY|PRIVATE|CREDENTIAL|COOKIE|SESSION|AUTH|DSN|WEBHOOK)|(KEY|_PAT|PWD)$/i
/**
 * URL with userinfo (`postgres://user:pass@host`) — a secret whatever the key
 * is called. Superset of `://[^/@\s]+:[^/@\s]+@`: also password-only userinfo
 * (`redis://:pass@host`).
 */
const URL_USERINFO_VALUE = /:\/\/[^/@\s]*:[^/@\s]+@/
/** Known non-secret variables that the key pattern would otherwise catch. */
const NON_SECRET_ENV_KEYS = new Set([
  'PWD', 'OLDPWD', 'SSH_AUTH_SOCK', 'XAUTHORITY', 'TERM_SESSION_ID', 'ITERM_SESSION_ID',
  'SECURITYSESSIONID', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_SESSION_ID', 'XDG_SESSION_TYPE',
  'XDG_SESSION_CLASS', 'XDG_SESSION_DESKTOP', 'SHELL_SESSION_ID', 'SHELL_SESSION_DID_INIT',
  'SHELL_SESSION_HISTORY', 'SSH_AGENT_PID', 'GPG_AGENT_INFO',
])

/** True when a variable must not be written to the cache. */
export function isSecretEnvVar(key: string, value: string): boolean {
  if (URL_USERINFO_VALUE.test(value)) return true
  if (NON_SECRET_ENV_KEYS.has(key.toUpperCase())) return false
  return SECRET_ENV_KEY.test(key)
}

const RC_FILES = ['.zshenv', '.zprofile', '.zshrc', '.zlogin', '.bash_profile', '.bashrc', '.profile']
export const SHELL_ENV_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CAPTURE_TIMEOUT_MS = 5000
const CACHE_VERSION = 2

export interface ShellEnvCache {
  version: number
  key: string
  capturedAt: number
  env: Record<string, string>
  /** Number of secret-looking variables left out of the cache. */
  omittedKeys: number
}

export type ShellEnvCapture = (shell: string, env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<string>

export interface ShellEnvLoadOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
  cachePath?: string
  now?: () => number
  capture?: ShellEnvCapture
  /** Delay before the background refresh when a complete cache was applied. */
  refreshDelayMs?: number
}

function fallbackPaths(home: string | undefined): string[] {
  return [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    `${home}/.local/bin`,
    `${home}/.bun/bin`,
    `${home}/.cargo/bin`,
  ]
}

/** Prepend common tool locations (used when no shell env is available yet). */
export function applyFallbackPaths(target: NodeJS.ProcessEnv = process.env, home = target.HOME): void {
  const currentPath = target.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'
  target.PATH = [...fallbackPaths(home), ...currentPath.split(':')]
    .filter((p, i, arr) => p && arr.indexOf(p) === i) // dedupe
    .join(':')
}

/** Parse `echo __ENV_START__ && env` output (same rules as the previous sync loader). */
export function parseShellEnvOutput(output: string): Record<string, string> {
  const envSection = output.split('__ENV_START__')[1] || ''
  const parsed: Record<string, string> = {}
  for (const line of envSection.trim().split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) {
      const key = line.substring(0, eq)
      if (shouldSkipEnvVar(key)) continue
      parsed[key] = line.substring(eq + 1)
    }
  }
  return parsed
}

export function applyShellEnv(env: Record<string, string>, target: NodeJS.ProcessEnv = process.env): number {
  let count = 0
  for (const [key, value] of Object.entries(env)) {
    if (shouldSkipEnvVar(key)) continue
    target[key] = value
    count++
  }
  return count
}

export function filterCacheableEnv(env: Record<string, string>): { env: Record<string, string>; omitted: number } {
  const out: Record<string, string> = {}
  let omitted = 0
  for (const [key, value] of Object.entries(env)) {
    if (isSecretEnvVar(key, value)) omitted++
    else out[key] = value
  }
  return { env: out, omitted }
}

/** Cache key: the shell binary plus size/mtime of every rc file it may source. */
export function shellEnvCacheKey(shell: string, home: string, stat: (path: string) => { size: number; mtimeMs: number } = statSync): string {
  const parts = [`shell=${shell}`]
  for (const file of RC_FILES) {
    try {
      const s = stat(join(home, file))
      parts.push(`${file}=${s.size}:${s.mtimeMs}`)
    } catch {
      parts.push(`${file}=-`)
    }
  }
  return parts.join('|')
}

/** Private 0700 directory holding only the 0600 cache file. */
export function defaultShellEnvCachePath(home = homedir()): string {
  return join(home, 'Library', 'Caches', 'Rox', 'shell-env', 'env.json')
}

/**
 * Read the cache for `key`. A cache whose key matches but whose TTL expired is
 * still returned (flagged `expired`) — it is a far better starting PATH than
 * the bare fallback while the background refresh runs.
 */
export function readShellEnvCacheEntry(path: string, key: string, now: number, ttlMs = SHELL_ENV_CACHE_TTL_MS): { cache: ShellEnvCache; expired: boolean } | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ShellEnvCache
    if (!parsed || parsed.version !== CACHE_VERSION || parsed.key !== key) return null
    if (typeof parsed.capturedAt !== 'number' || now < parsed.capturedAt) return null
    if (!parsed.env || typeof parsed.env !== 'object' || typeof parsed.env.PATH !== 'string') return null
    if (Object.values(parsed.env).some(value => typeof value !== 'string')) return null
    const cache = { ...parsed, omittedKeys: typeof parsed.omittedKeys === 'number' ? parsed.omittedKeys : 1 }
    return { cache, expired: now - parsed.capturedAt > ttlMs }
  } catch {
    return null
  }
}

/** Fresh (non-expired) cache only. */
export function readShellEnvCache(path: string, key: string, now: number, ttlMs = SHELL_ENV_CACHE_TTL_MS): ShellEnvCache | null {
  const entry = readShellEnvCacheEntry(path, key, now, ttlMs)
  return entry && !entry.expired ? entry.cache : null
}

export function writeShellEnvCache(path: string, cache: ShellEnvCache): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  try { chmodSync(dirname(path), 0o700) } catch { /* best effort */ }
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(cache), { encoding: 'utf-8', mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch { /* best effort */ }
  renameSync(tmp, path)
}

/** Default capture: the user's login+interactive shell. Exported for tests. */
export const captureLoginShellEnv: ShellEnvCapture = (shell, env, timeoutMs) => new Promise((resolve, reject) => {
  // -l = login shell (sources profile files like .zprofile)
  // -i = interactive shell (sources rc files like .zshrc)
  // We use a marker to separate shell startup output from env output
  const child = execFile(shell, ['-l', '-i', '-c', 'echo __ENV_START__ && env'], {
    encoding: 'utf-8',
    timeout: timeoutMs,
    // Interactive bash/zsh ignore SIGTERM (execFile's default): SIGKILL on timeout.
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1024 * 1024,
    env: {
      HOME: env.HOME,
      USER: env.USER,
      SHELL: shell,
      TERM: 'xterm-256color',
      TMPDIR: env.TMPDIR,
      // Prevent macOS from showing "Install Command Line Developer Tools" dialog
      // when the shell hits the /usr/bin/git shim on systems without Xcode CLT
      APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  }, (error, stdout) => {
    if (error) reject(error)
    else resolve(String(stdout))
  })
  // Immediate EOF on stdin (like the old execSync): rc files that read stdin
  // must not block until the timeout.
  child.stdin?.end()
})

let readyPromise: Promise<void> = Promise.resolve()
let ready = true
/** Latched once a bounded wait elapsed, so later spawns never pay it again. */
let waitLatched = false
let started = false

/** True once the full login-shell environment is in process.env (or not needed). */
export function isShellEnvReady(): boolean {
  return ready
}

/** True when spawns should no longer wait: env captured, or the first bounded wait timed out. */
export function isShellEnvSettled(): boolean {
  return ready || waitLatched
}

/**
 * Await before spawning a child that needs the user's full PATH/env.
 * Resolves immediately on non-macOS, in dev, when a complete cache was
 * applied, or after an earlier wait already timed out; otherwise waits at
 * most `timeoutMs` (then latches). Never rejects.
 */
export function whenShellEnvReady(timeoutMs = CAPTURE_TIMEOUT_MS + 1000): Promise<void> {
  if (ready || waitLatched) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => { waitLatched = true; resolve() }, timeoutMs)
    ;(timer as { unref?: () => void }).unref?.()
    readyPromise.then(() => { clearTimeout(timer); resolve() })
  })
}

/** Spawn-env gate for `registerSpawnEnvGate('shell-env', …)`. */
export const shellEnvSpawnGate = {
  isReady: isShellEnvSettled,
  wait: () => whenShellEnvReady(),
}

/**
 * Start loading the user's shell environment without blocking. Applies the
 * cached env (or fallback PATH) synchronously, then refreshes in the
 * background. Safe to call more than once (later calls are no-ops).
 */
export function startShellEnvLoad(options: ShellEnvLoadOptions = {}): void {
  if (started) return
  const env = options.env ?? process.env
  // Only needed on macOS where GUI apps have minimal environment
  if ((options.platform ?? process.platform) !== 'darwin') return
  // Skip in dev mode - terminal launches already have full environment
  if (env.VITE_DEV_SERVER_URL) {
    mainLog.info('[shell-env] Skipping in dev mode (already have shell environment)')
    return
  }
  started = true

  const shell = env.SHELL || '/bin/zsh'
  const home = options.home ?? env.HOME ?? homedir()
  const cachePath = options.cachePath ?? defaultShellEnvCachePath(home)
  const now = options.now ?? Date.now
  let key: string | null = null
  try { key = shellEnvCacheKey(shell, home) } catch { key = null }

  const entry = key ? readShellEnvCacheEntry(cachePath, key, now()) : null
  const cache = entry?.cache ?? null
  if (cache) {
    // An expired-but-matching cache is still the best PATH until the refresh lands.
    const count = applyShellEnv(cache.env, env)
    mainLog.info(`[shell-env] Applied ${count} cached environment variables (${cache.omittedKeys} secret-like omitted${entry!.expired ? ', expired' : ''})`)
  } else {
    // No usable cache yet: make the common tool dirs reachable right away.
    applyFallbackPaths(env, home)
  }
  const cacheComplete = !!cache && !entry!.expired && cache.omittedKeys === 0
  ready = cacheComplete

  const capture = options.capture ?? captureLoginShellEnv
  const refresh = async (): Promise<void> => {
    mainLog.info(`[shell-env] Loading environment from ${shell} (background)`)
    try {
      const parsed = parseShellEnvOutput(await capture(shell, env, CAPTURE_TIMEOUT_MS))
      if (typeof parsed.PATH !== 'string') throw new Error('login shell printed no PATH')
      const count = applyShellEnv(parsed, env)
      mainLog.info(`[shell-env] Loaded ${count} environment variables`)
      if (env.PATH) mainLog.info(`[shell-env] PATH has ${env.PATH.split(':').length} entries`)
      if (key) {
        const cacheable = filterCacheableEnv(parsed)
        try {
          writeShellEnvCache(cachePath, { version: CACHE_VERSION, key, capturedAt: now(), env: cacheable.env, omittedKeys: cacheable.omitted })
        } catch (error) {
          mainLog.warn(`[shell-env] Failed to write cache: ${error}`)
        }
      }
    } catch (error) {
      // Don't fail app startup if shell env loading fails
      mainLog.warn(`[shell-env] Failed to load shell environment: ${error}`)
      if (!cache) mainLog.warn('[shell-env] Using common paths as fallback')
    } finally {
      ready = true
    }
  }

  if (cacheComplete) {
    // Cached env is already complete: refresh lazily, off the boot window.
    const timer = setTimeout(() => { void refresh() }, options.refreshDelayMs ?? 3000)
    timer.unref?.()
    readyPromise = Promise.resolve()
  } else {
    readyPromise = refresh()
  }
}

/** @deprecated name kept for call-site compatibility; now non-blocking. */
export const loadShellEnv = startShellEnvLoad

/** Test hook. */
export function resetShellEnvForTests(): void {
  readyPromise = Promise.resolve()
  ready = true
  waitLatched = false
  started = false
}

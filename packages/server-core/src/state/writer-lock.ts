/**
 * Single-writer lock for the unified state database.
 *
 * The server owns `<configDir>/state/rox-state.sqlite` for its whole lifetime.
 * This lock makes that ownership explicit and cross-process: a second server
 * pointed at the same config dir must refuse to start instead of racing the
 * first one's SQLite writes. It mirrors the `.server.lock` idiom
 * (bootstrap/headless-start.ts) but is deliberately conservative — a live PID
 * that cannot be proven recycled is never taken over.
 *
 * Lock file: JSON `{pid, startedAt, execName, label}`, created `O_EXCL` 0600.
 * Takeover (only when provably stale) is unlink-then-`O_EXCL`; if another
 * process wins that race the loser re-reads and refuses.
 */
import { closeSync, mkdirSync, openSync, readFileSync, readlinkSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process'
import { basename, dirname } from 'node:path'
import { uptime as osUptime } from 'node:os'

export interface StateLockHolder {
  pid: number
  startedAt: number
  /** basename of process.execPath at acquire time. Absent on legacy locks. */
  execName?: string
  label: string
}

export interface AcquireStateWriterLockOptions {
  label: string
  now?: () => number
  /**
   * Age (ms) after which an unreadable/corrupt lock file is treated as stale.
   * A live, well-formed holder is never stolen by age.
   */
  staleMs?: number
  /** Test seams — production callers use the defaults. */
  pid?: number
  execName?: string
  bootTime?: () => number
  isProcessAlive?: (pid: number) => boolean
  liveExecName?: (pid: number) => string | null
}

export interface StateWriterLock {
  readonly path: string
  readonly holder: StateLockHolder
  /** Idempotent. Removes the lock file only when this process still owns it. */
  release(): void
}

export class StateLockedError extends Error {
  readonly code = 'STATE_LOCKED'
  constructor(
    readonly holder: StateLockHolder,
    readonly lockPath: string,
  ) {
    super(
      `State database is locked by ${holder.label} (PID ${holder.pid}, since ${new Date(holder.startedAt).toISOString()}). ` +
      `Delete ${lockPath} if that process is gone, or set ROX_CONFIG_DIR to a different path to run a parallel instance.`,
    )
    this.name = 'StateLockedError'
  }
}

/**
 * True when `lock` still owns the lock file: the file is readable, well-formed,
 * and records this handle's PID and acquisition time. Read-only — it never
 * takes over or reclaims; it only reports current ownership.
 */
export function isStateWriterLockHeld(lock: StateWriterLock): boolean {
  const current = readHolder(lock.path)
  return current !== null && current.pid === lock.holder.pid && current.startedAt === lock.holder.startedAt
}

/** Throws `StateLockedError` unless `lock` still owns the lock file. */
export function assertStateWriterLockHeld(lock: StateWriterLock): void {
  if (isStateWriterLockHeld(lock)) return
  throw new StateLockedError(readHolder(lock.path) ?? { pid: 0, startedAt: 0, label: 'unknown' }, lock.path)
}

const DEFAULT_STALE_MS = 30_000
const PROCESS_PROBE_OPTS: ExecFileSyncOptionsWithStringEncoding = {
  encoding: 'utf-8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Best-effort executable name (basename) of a live PID. Null when uninspectable. */
function defaultLiveExecName(pid: number): string | null {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], PROCESS_PROBE_OPTS).trim()
      const line = out.split(/\r?\n/)[0] ?? ''
      if (!line.startsWith('"')) return null
      const end = line.indexOf('"', 1)
      return end > 1 ? line.slice(1, end) : null
    }
    if (process.platform === 'linux') {
      try { return basename(readlinkSync(`/proc/${pid}/exe`)) } catch { /* fall through to ps */ }
    }
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], PROCESS_PROBE_OPTS).trim()
    return out ? basename(out) : null
  } catch {
    return null
  }
}

function parseHolder(raw: string): StateLockHolder | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const pid = typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) ? parsed.pid : null
    const startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : null
    if (pid === null || startedAt === null) return null
    const label = typeof parsed.label === 'string' ? parsed.label : 'unknown'
    const execName = typeof parsed.execName === 'string' && parsed.execName ? parsed.execName : undefined
    return { pid, startedAt, label, ...(execName ? { execName } : {}) }
  } catch {
    return null
  }
}

function readHolder(path: string): StateLockHolder | null {
  try {
    return parseHolder(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Acquire the state writer lock, taking over only when the current holder is
 * provably gone (dead PID, lock written before this boot, or a recycled PID
 * whose live executable name differs from the recorded one).
 */
export function acquireStateWriterLock(
  lockPath: string,
  options: AcquireStateWriterLockOptions,
): StateWriterLock {
  const now = options.now ?? Date.now
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  const pid = options.pid ?? process.pid
  const execName = options.execName ?? basename(process.execPath)
  const bootTime = options.bootTime ?? (() => Date.now() - osUptime() * 1000)
  const alive = options.isProcessAlive ?? isProcessAlive
  const liveExecName = options.liveExecName ?? defaultLiveExecName

  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 })

  const isStale = (holder: StateLockHolder): boolean => {
    // Our own PID is a leftover from a previous process lifecycle (e.g. a
    // container where PID 1 is reused across restarts).
    if (holder.pid === pid) return true
    if (!alive(holder.pid)) return true
    // Written before the current boot → the PID has been recycled.
    if (holder.startedAt > 0 && holder.startedAt < bootTime()) return true
    // Live PID whose executable name no longer matches → recycled PID.
    if (holder.execName) {
      const live = liveExecName(holder.pid)
      if (live && live.toLowerCase() !== holder.execName.toLowerCase()) return true
    }
    return false
  }

  const holder: StateLockHolder = { pid, startedAt: now(), execName, label: options.label }
  const payload = JSON.stringify(holder)

  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600)
      try {
        writeSync(fd, payload)
      } finally {
        closeSync(fd)
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }

    const existing = readHolder(lockPath)
    if (!existing) {
      let ageMs = Number.POSITIVE_INFINITY
      try { ageMs = now() - statSync(lockPath).mtimeMs } catch { /* file vanished — retry */ }
      if (ageMs < staleMs) {
        throw new StateLockedError({ pid: 0, startedAt: 0, label: 'unknown' }, lockPath)
      }
      try { unlinkSync(lockPath) } catch { /* someone else may have removed it */ }
      continue
    }
    if (!isStale(existing)) throw new StateLockedError(existing, lockPath)
    try { unlinkSync(lockPath) } catch { /* race with another reclaimer */ }
  }

  let released = false
  const onExit = (): void => release()
  const release = (): void => {
    if (released) return
    released = true
    process.removeListener('exit', onExit)
    const current = readHolder(lockPath)
    if (current && current.pid === holder.pid && current.startedAt === holder.startedAt) {
      try { unlinkSync(lockPath) } catch { /* best-effort cleanup */ }
    }
  }
  process.on('exit', onExit)

  return { path: lockPath, holder, release }
}
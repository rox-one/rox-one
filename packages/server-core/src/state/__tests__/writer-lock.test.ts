import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acquireStateWriterLock, statSnapshot, StateLockedError, unlinkIfUnchanged,
  type AcquireStateWriterLockOptions,
} from '../writer-lock.ts'

const dirs: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-writer-lock-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const BASE: AcquireStateWriterLockOptions = {
  label: 'test',
  pid: 100,
  execName: 'node',
  now: () => 1000,
  bootTime: () => 0,
  isProcessAlive: () => false,
  liveExecName: () => null,
}

function writeLock(path: string, holder: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(holder))
}

describe('state writer lock', () => {
  it('refuses a second live acquirer with a typed error carrying the holder', () => {
    const path = join(scratch(), 'rox-state.lock')
    const first = acquireStateWriterLock(path, BASE)
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf-8')).pid).toBe(100)

    let thrown: unknown
    try {
      acquireStateWriterLock(path, {
        ...BASE,
        pid: 200,
        isProcessAlive: (pid) => pid === 100,
        liveExecName: () => 'node',
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(StateLockedError)
    expect((thrown as StateLockedError).holder.pid).toBe(100)
    expect((thrown as StateLockedError).code).toBe('STATE_LOCKED')
    first.release()
  })

  it('takes over a dead-PID lock', () => {
    const path = join(scratch(), 'rox-state.lock')
    writeLock(path, { pid: 4242, startedAt: 1000, execName: 'node', label: 'dead' })
    const lock = acquireStateWriterLock(path, { ...BASE, pid: 100 })
    expect(lock.holder.pid).toBe(100)
    expect(JSON.parse(readFileSync(path, 'utf-8')).pid).toBe(100)
    lock.release()
  })

  it('takes over a lock written before this boot', () => {
    const path = join(scratch(), 'rox-state.lock')
    writeLock(path, { pid: 4242, startedAt: 500, execName: 'node', label: 'previous-boot' })
    const lock = acquireStateWriterLock(path, {
      ...BASE,
      pid: 100,
      bootTime: () => 1000,
      isProcessAlive: () => true,
      liveExecName: () => 'node',
    })
    expect(lock.holder.pid).toBe(100)
    lock.release()
  })

  it('takes over a recycled PID whose executable name differs', () => {
    const path = join(scratch(), 'rox-state.lock')
    writeLock(path, { pid: 4242, startedAt: 1000, execName: 'node', label: 'recycled' })
    const lock = acquireStateWriterLock(path, {
      ...BASE,
      pid: 100,
      isProcessAlive: () => true,
      liveExecName: () => 'swcd',
    })
    expect(lock.holder.pid).toBe(100)
    lock.release()
  })

  it('refuses a live PID whose executable name matches', () => {
    const path = join(scratch(), 'rox-state.lock')
    writeLock(path, { pid: 4242, startedAt: 1000, execName: 'node', label: 'live' })
    expect(() => acquireStateWriterLock(path, {
      ...BASE,
      pid: 100,
      isProcessAlive: () => true,
      liveExecName: () => 'NODE',
    })).toThrow(StateLockedError)
  })

  it('releases only its own lock', () => {
    const path = join(scratch(), 'rox-state.lock')
    const own = acquireStateWriterLock(path, BASE)
    own.release()
    expect(existsSync(path)).toBe(false)

    const again = acquireStateWriterLock(path, BASE)
    writeLock(path, { pid: 999, startedAt: 1, label: 'other' })
    again.release()
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf-8')).pid).toBe(999)
  })

  it('is idempotent on release', () => {
    const path = join(scratch(), 'rox-state.lock')
    const lock = acquireStateWriterLock(path, BASE)
    lock.release()
    lock.release()
    expect(existsSync(path)).toBe(false)
  })

  it('takes over a corrupt lock only once it is older than staleMs', () => {
    const path = join(scratch(), 'rox-state.lock')
    writeFileSync(path, 'not-json')
    const past = new Date(Date.now() - 60_000)
    utimesSync(path, past, past)

    expect(() => acquireStateWriterLock(path, { ...BASE, now: () => Date.now(), staleMs: 120_000 }))
      .toThrow(StateLockedError)
    const lock = acquireStateWriterLock(path, { ...BASE, now: () => Date.now(), staleMs: 30_000 })
    expect(lock.holder.pid).toBe(100)
    lock.release()
  })
})

describe('guarded unlink', () => {
  it('removes the file when the snapshot still matches', () => {
    const path = join(scratch(), 'rox-state.lock')
    writeFileSync(path, '{"pid":1}')
    const snapshot = statSnapshot(path)!
    expect(snapshot).not.toBeNull()
    expect(unlinkIfUnchanged(path, snapshot)).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  it('refuses when the file at the path was replaced (new inode)', () => {
    const path = join(scratch(), 'rox-state.lock')
    writeFileSync(path, 'stale-payload')
    const snapshot = statSnapshot(path)!
    unlinkSync(path)
    writeFileSync(path, 'fresh-lock-payload-from-other-reclaimer')
    const replacedIno = statSync(path).ino
    expect(replacedIno === snapshot.ino && statSync(path).size === snapshot.size).toBe(false)

    expect(unlinkIfUnchanged(path, snapshot)).toBe(false)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf-8')).toBe('fresh-lock-payload-from-other-reclaimer')
  })

  it('returns false when the file is already gone', () => {
    const path = join(scratch(), 'missing.lock')
    expect(statSnapshot(path)).toBeNull()
    expect(unlinkIfUnchanged(path, { ino: 1, mtimeMs: 0, size: 0 })).toBe(false)
  })

  it('refuses a snapshot taken from a different inode', () => {
    const target = join(scratch(), 'target.lock')
    const other = join(scratch(), 'other.lock')
    writeFileSync(target, 'target-payload')
    writeFileSync(other, 'a-much-longer-other-payload')
    const otherSnapshot = statSnapshot(other)!

    expect(unlinkIfUnchanged(target, otherSnapshot)).toBe(false)
    expect(existsSync(target)).toBe(true)
    expect(existsSync(other)).toBe(true)
  })
})
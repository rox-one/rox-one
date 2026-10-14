import { describe, expect, it, vi } from 'bun:test'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'

import type { RoversEnginePaths } from '../../../types.ts'
import { RoversError } from '../../../errors.ts'
import {
  assertLimaCacheRootFitsUnixPath,
  buildLimaSpawnEnv,
  createLimaEngine,
  LIMA_BINARY,
  limaInstanceSocketPath,
  limaUserCacheDir,
} from '../lima.ts'
import type { LimaKillSignal, LimaSpawnFn, LimaSpawnOptions } from '../lima.ts'

const root = '/tmp/rox-lima-engine'
const paths: RoversEnginePaths = {
  cacheRoot: join(root, 'cache'),
  limaHome: join(root, 'cache', 'lima'),
  home: join(root, 'cache', 'home'),
  xdgCacheHome: join(root, 'cache', 'xdg-cache'),
}

/** A stdin-less child double: `EventEmitter` already satisfies the Lima seam. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly kills: LimaKillSignal[] = []

  kill(signal?: LimaKillSignal): boolean {
    this.kills.push(signal ?? 'SIGTERM')
    return true
  }
}

interface SpawnRecord {
  command: string
  args: string[]
  options: LimaSpawnOptions
}

/**
 * A fake `limactl` launcher. Output is delivered on a microtask (the engine
 * registers its listeners synchronously after `spawnFn` returns), or — with
 * `manual` — only when the test emits it, so timeout behaviour is driven by
 * fake timers rather than real waits.
 */
function createFakeSpawn(script: {
  stdout?: string
  stderr?: string
  code?: number | null
  manual?: boolean
} = {}): {
  spawnFn: LimaSpawnFn
  calls: SpawnRecord[]
  children: FakeChild[]
} {
  const calls: SpawnRecord[] = []
  const children: FakeChild[] = []

  const spawnFn: LimaSpawnFn = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new FakeChild()
    children.push(child)
    if (script.manual !== true) {
      queueMicrotask(() => {
        if (script.stdout !== undefined) child.stdout.emit('data', script.stdout)
        if (script.stderr !== undefined) child.stderr.emit('data', script.stderr)
        child.emit('close', script.code === undefined ? 0 : script.code, null)
      })
    }
    return child
  }

  return { spawnFn, calls, children }
}

describe('buildLimaSpawnEnv', () => {
  it('forces every engine variable under cacheRoot and drops non-string base values', () => {
    const base = {
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/Users/real-user',
      XDG_CACHE_HOME: '/Users/real-user/Library/Caches',
      LIMA_HOME: '/Users/real-user/.lima',
      DOCKER_CONFIG: '/Users/real-user/.docker',
      XDG_CONFIG_HOME: '/Users/real-user/.config',
      EMPTY: undefined,
    }

    const env = buildLimaSpawnEnv(paths, base)

    expect(env.HOME).toBe(paths.home)
    expect(env.XDG_CACHE_HOME).toBe(paths.xdgCacheHome)
    expect(env.LIMA_HOME).toBe(paths.limaHome)
    expect(env.DOCKER_CONFIG).toBe(join(paths.home, '.docker'))
    expect(env.XDG_CONFIG_HOME).toBe(join(paths.home, '.config'))
    expect(env.PATH).toBe(base.PATH)
    expect(Object.keys(env)).not.toContain('EMPTY')

    for (const value of [env.HOME, env.XDG_CACHE_HOME, env.LIMA_HOME, env.DOCKER_CONFIG, env.XDG_CONFIG_HOME]) {
      expect(value.startsWith(paths.cacheRoot)).toBe(true)
      expect(value.includes('/Users/real-user')).toBe(false)
    }
  })

  it('redirects the real process HOME by default', () => {
    const env = buildLimaSpawnEnv(paths)
    expect(env.HOME).toBe(paths.home)
    expect(env.HOME).not.toBe(process.env.HOME)
  })

  it('derives the Lima user cache dir inside the engine HOME', () => {
    expect(limaUserCacheDir(paths)).toBe(join(paths.home, 'Library', 'Caches', 'lima'))
  })
})

describe('createLimaEngine', () => {
  it('spawns limactl with the engine-private env + cwd and reports its version', async () => {
    const { spawnFn, calls } = createFakeSpawn({ stdout: 'limactl version 2.2.1\n' })
    const engine = createLimaEngine({ paths, spawnFn })

    expect(engine.binaryPath).toBe(LIMA_BINARY)
    expect(await engine.version()).toBe('2.2.1')

    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe(LIMA_BINARY)
    expect(calls[0].args).toEqual(['--version'])
    expect(calls[0].options.cwd).toBe(paths.home)
    expect(calls[0].options.stdio).toBe('pipe')
    expect(calls[0].options.env.HOME).toBe(paths.home)
    expect(calls[0].options.env.HOME).not.toBe(process.env.HOME)
    expect(calls[0].options.env.LIMA_HOME).toBe(paths.limaHome)
    expect(calls[0].options.env.DOCKER_CONFIG).toBe(join(paths.home, '.docker'))
  })

  it('honors an explicit binary path and returns null for an unparseable version', async () => {
    const { spawnFn, calls } = createFakeSpawn({ stdout: 'no version here' })
    const engine = createLimaEngine({ binaryPath: '/opt/homebrew/bin/limactl', paths, spawnFn })

    expect(await engine.version()).toBeNull()
    expect(calls[0].command).toBe('/opt/homebrew/bin/limactl')
    expect(engine.binaryPath).toBe('/opt/homebrew/bin/limactl')
  })

  it('never rejects on a non-zero exit', async () => {
    const { spawnFn } = createFakeSpawn({ stdout: '', stderr: 'boom', code: 2 })
    const engine = createLimaEngine({ paths, spawnFn })

    expect(await engine.run(['list'])).toEqual({ code: 2, stdout: '', stderr: 'boom' })
  })

  it('caps captured output at maxBytes', async () => {
    const { spawnFn } = createFakeSpawn({ stdout: 'x'.repeat(100), stderr: 'y'.repeat(100) })
    const engine = createLimaEngine({ paths, spawnFn })

    const result = await engine.run(['list'], { maxBytes: 10 })
    expect(result.stdout).toBe('x'.repeat(10))
    expect(result.stderr).toBe('y'.repeat(10))
  })

  it('SIGKILLs a helper that exceeds its timeout', async () => {
    vi.useFakeTimers()
    try {
      const { spawnFn, children } = createFakeSpawn({ manual: true })
      const engine = createLimaEngine({ paths, spawnFn })

      const pending = engine.run(['list'], { timeoutMs: 1_000 })
      vi.advanceTimersByTime(1_000)
      expect(children[0].kills).toEqual(['SIGKILL'])

      children[0].emit('close', null, 'SIGKILL')
      expect((await pending).code).toBe(-1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('splits list output into non-empty instance names', async () => {
    const { spawnFn, calls } = createFakeSpawn({ stdout: 'rox-dev\n\n  rox-test  \n' })
    const engine = createLimaEngine({ paths, spawnFn })

    expect(await engine.listInstances()).toEqual(['rox-dev', 'rox-test'])
    expect(calls[0].args).toEqual(['list', '--format', '{{.Name}}'])
  })

  it('exposes the engine-owned env and Lima cache dir', () => {
    const { spawnFn } = createFakeSpawn()
    const engine = createLimaEngine({ paths, spawnFn })

    expect(engine.env).toEqual(buildLimaSpawnEnv(paths))
    expect(engine.cacheDir()).toBe(limaUserCacheDir(paths))
  })
})

/**
 * Regression for a live finding (2026-10-14, limactl 2.2.1): an over-long
 * `LIMA_HOME` makes Lima die with `fatal: instance name … too long` only after
 * the image was pulled. Rox refuses it up front with a typed, repairable code.
 */
describe('Lima Unix-socket path budget', () => {
  it('builds the exact path Lima length-checks', () => {
    expect(limaInstanceSocketPath('/l', 'rv-1')).toBe('/l/rv-1/ssh.sock.1234567890123456')
  })

  it('accepts the default macOS config root', () => {
    const limaHome = '/Users/t/Library/Application Support/Rox/rovers/cache/lima'
    expect(() => assertLimaCacheRootFitsUnixPath(limaHome)).not.toThrow()
  })

  it('refuses an over-long cache root as a typed vm_start_failed with a repair action', () => {
    const tooLong = `/tmp/${'x'.repeat(120)}`
    let caught: unknown
    try {
      assertLimaCacheRootFitsUnixPath(tooLong)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(RoversError)
    expect((caught as RoversError).code).toBe('vm_start_failed')
    expect((caught as RoversError).message).toContain('слишком длинный')
    expect((caught as RoversError).repairAction).toBeTruthy()
  })

  it('refuses at construction, not as an opaque limactl fatal', () => {
    const { spawnFn } = createFakeSpawn()
    const longPaths: RoversEnginePaths = { ...paths, limaHome: `/tmp/${'y'.repeat(120)}` }
    expect(() => createLimaEngine({ paths: longPaths, spawnFn })).toThrow(RoversError)
  })
})

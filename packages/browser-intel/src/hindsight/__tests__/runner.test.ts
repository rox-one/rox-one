import { afterEach, describe, expect, test, vi } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { ChildProcess, spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

import { HindsightRunner, resolveHindsightCommand } from '../runner.ts'

/** Minimal spawn stand-in: records argv and lets the test drive the lifecycle. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly signals: Array<string | undefined> = []

  kill(signal?: string): boolean {
    this.signals.push(signal)
    queueMicrotask(() => this.emit('close', null, signal ?? 'SIGTERM'))
    return true
  }
}

interface Capture {
  child: FakeChild
  calls: string[][]
  spawn: typeof spawn
}

function capture(): Capture {
  const calls: string[][] = []
  const child = new FakeChild()
  const spawnFn = ((command: string, args: readonly string[]) => {
    calls.push([command, ...args])
    return child as unknown as ChildProcess
  }) as unknown as typeof spawn
  return { child, calls, spawn: spawnFn }
}

const ENV_BIN = '/fake/hindsight'
const savedEnv: Record<string, string | undefined> = {}
afterEach(() => {
  vi.useRealTimers()
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
    delete savedEnv[key]
  }
})

function restoreEnv(keys: readonly string[]): void {
  for (const key of keys) savedEnv[key] = process.env[key]
}

describe('resolveHindsightCommand', () => {
  test('prefers env over bundled over PATH', () => {
    const bundled = join('/res', 'resources', 'bin', 'hindsight')

    const fromEnv = resolveHindsightCommand({
      env: { ROX_HINDSIGHT_BIN: '/opt/h', CRAFT_RESOURCES_BASE: '/res' },
      exists: (path) => path === '/opt/h' || path === bundled,
    })
    expect(fromEnv).toEqual({ command: '/opt/h', argsPrefix: [], source: 'env' })

    const fromBundled = resolveHindsightCommand({
      env: { CRAFT_RESOURCES_BASE: '/res' },
      exists: (path) => path === bundled,
    })
    expect(fromBundled).toEqual({ command: bundled, argsPrefix: [], source: 'bundled' })

    // Force the uv module path to fail, then inject a fake PATH entry.
    restoreEnv(['PATH', 'CRAFT_UV', 'CRAFT_RESOURCES_BASE', 'CRAFT_IS_PACKAGED', 'CRAFT_APP_ROOT'])
    process.env.PATH = ''
    for (const key of ['CRAFT_UV', 'CRAFT_RESOURCES_BASE', 'CRAFT_IS_PACKAGED', 'CRAFT_APP_ROOT']) {
      delete process.env[key]
    }
    const dir = '/fake/path'
    const fromPath = resolveHindsightCommand({ env: { PATH: dir }, exists: (path) => path === join(dir, 'hindsight') })
    expect(fromPath).toEqual({ command: join(dir, 'hindsight'), argsPrefix: [], source: 'path' })
  })

  test('ignores a non-absolute or missing env binary', () => {
    const bundled = join('/res', 'resources', 'bin', 'hindsight')
    const command = resolveHindsightCommand({
      env: { ROX_HINDSIGHT_BIN: 'hindsight', CRAFT_RESOURCES_BASE: '/res' },
      exists: (path) => path === bundled,
    })
    expect(command.source).toBe('bundled')
  })

  test('finds the bundled wrapper under the resources/bin convention', () => {
    const base = '/apps/electron'
    const posix = join(base, 'resources', 'bin', 'hindsight')
    expect(resolveHindsightCommand({ env: { CRAFT_RESOURCES_BASE: base }, exists: (path) => path === posix })).toEqual({
      command: posix,
      argsPrefix: [],
      source: 'bundled',
    })

    const win = join(base, 'resources', 'bin', 'hindsight.cmd')
    expect(
      resolveHindsightCommand({
        env: { CRAFT_RESOURCES_BASE: base },
        platform: 'win32',
        exists: (path) => path === win,
      }),
    ).toEqual({ command: win, argsPrefix: [], source: 'bundled' })
  })

  test('resolves the uv python-module fallback with the verified argv', () => {
    restoreEnv(['CRAFT_UV', 'CRAFT_RESOURCES_BASE', 'CRAFT_IS_PACKAGED', 'CRAFT_APP_ROOT'])
    process.env.CRAFT_UV = '/usr/local/bin/uv'
    for (const key of ['CRAFT_RESOURCES_BASE', 'CRAFT_IS_PACKAGED', 'CRAFT_APP_ROOT']) delete process.env[key]

    const command = resolveHindsightCommand({ env: {}, exists: () => false })
    expect(command).toEqual({
      command: '/usr/local/bin/uv',
      argsPrefix: [
        'tool',
        'run',
        '--python',
        '3.12',
        '--from',
        'pyhindsight',
        '--with',
        'ccl-chromium-reader @ git+https://github.com/cclgroupltd/ccl_chromium_reader.git',
        'hindsight.py',
      ],
      source: 'python-module',
    })
  })

  test('isAvailable reflects whether a command resolves', () => {
    const available = new HindsightRunner({ env: { ROX_HINDSIGHT_BIN: ENV_BIN }, exists: () => true })
    expect(available.isAvailable()).toBe(true)
  })
})

describe('HindsightRunner.run', () => {
  test('spawns with -i/-o/-f sqlite and maps the optional flags', async () => {
    const { child, calls, spawn } = capture()
    const runner = new HindsightRunner({ spawn, env: { ROX_HINDSIGHT_BIN: ENV_BIN }, exists: () => true })

    const promise = runner.run({
      input: '/staged',
      outputBase: '/abs/out',
      browserType: 'Firefox',
      only: ['history'],
      logPath: '/abs/log',
      logLevel: 'debug',
      noCopy: true,
    })
    child.stdout.emit('data', 'progress\n')
    child.stderr.emit('data', 'warn\n')
    child.emit('close', 0, null)
    const result = await promise

    expect(calls[0]).toEqual([
      ENV_BIN,
      '-i',
      '/staged',
      '-o',
      '/abs/out',
      '-f',
      'sqlite',
      '-b',
      'Firefox',
      '--only',
      'history',
      '-l',
      '/abs/log',
      '--log-level',
      'debug',
      '--nocopy',
    ])
    expect(result).toMatchObject({ format: 'sqlite', exitCode: 0, outputPath: '/abs/out.sqlite' })
  })

  test('omits --nocopy/--only when unset and absolutizes a relative output base', async () => {
    const { child, calls, spawn } = capture()
    const runner = new HindsightRunner({ spawn, env: { ROX_HINDSIGHT_BIN: ENV_BIN }, exists: () => true })

    const promise = runner.run({ input: '/staged', outputBase: 'relative/out' })
    child.emit('close', 0, null)
    const result = await promise

    const argv = calls[0]!
    expect(argv).not.toContain('--nocopy')
    expect(argv).not.toContain('--only')
    expect(argv[argv.indexOf('-o') + 1]).toBe(resolve('relative/out'))
    expect(result.outputPath).toBe(`${resolve('relative/out')}.sqlite`)
  })

  test('kills the child on timeout', async () => {
    vi.useFakeTimers()
    const { child, spawn } = capture()
    const runner = new HindsightRunner({ spawn, env: { ROX_HINDSIGHT_BIN: ENV_BIN }, exists: () => true })

    const promise = runner.run({ input: '/i', outputBase: '/o', timeoutMs: 15 })
    vi.advanceTimersByTime(20)
    expect(child.signals).toContain('SIGTERM')
    // A killed run exits non-zero and must be reported as a failure.
    await expect(promise).rejects.toThrow(/exited with code 1/)
    vi.useRealTimers()
  })

  test('fails with the stderr tail when the output file is missing', async () => {
    const { child, spawn } = capture()
    const runner = new HindsightRunner({ spawn, env: { ROX_HINDSIGHT_BIN: ENV_BIN }, exists: (path) => path === ENV_BIN })

    const promise = runner.run({ input: '/i', outputBase: '/o' })
    child.stderr.emit('data', 'Traceback (most recent call last):\nboom\n')
    child.emit('close', 0, null)
    await expect(promise).rejects.toThrow(/produced no output file.*boom/s)
  })

  test('treats a non-zero exit as failure even when the output file exists', async () => {
    const { child, spawn } = capture()
    const runner = new HindsightRunner({ spawn, env: { ROX_HINDSIGHT_BIN: ENV_BIN }, exists: () => true })

    const promise = runner.run({ input: '/i', outputBase: '/o' })
    child.stderr.emit('data', 'Traceback (most recent call last):\nboom\n')
    // The crashed run left a half-written `<base>.sqlite` (exists === true).
    child.emit('close', 2, null)
    await expect(promise).rejects.toThrow(/exited with code 2.*boom/s)
  })

  test('bounds captured output to the last 100 lines', async () => {
    const { child, spawn } = capture()
    const runner = new HindsightRunner({ spawn, env: { ROX_HINDSIGHT_BIN: ENV_BIN }, exists: () => true })

    const promise = runner.run({ input: '/i', outputBase: '/o' })
    for (let line = 0; line < 250; line += 1) child.stdout.emit('data', `line ${line}\n`)
    child.emit('close', 0, null)
    const result = await promise

    const lines = result.stdout.split('\n')
    expect(lines).toHaveLength(100)
    expect(lines[0]).toBe('line 150')
    expect(lines.at(-1)).toBe('line 249')
  })
})
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')

describe('#1573 main compile-cache entry shim', () => {
  it('package.json and electron-builder both point main at dist/boot.cjs', () => {
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).main).toBe('dist/boot.cjs')
    expect(readFileSync(join(root, 'electron-builder.yml'), 'utf8')).toMatch(/extraMetadata:\s*\n\s*main: dist\/boot\.cjs/)
  })

  it('boot.cjs enables the cache guarded, then loads main.cjs', () => {
    const src = readFileSync(join(root, 'src/main/boot.cjs'), 'utf8')
    expect(src).toContain('enableCompileCache')
    expect(src).toContain('ROX_DISABLE_COMPILE_CACHE')
    expect(src.trimEnd().endsWith("require('./main.cjs')")).toBe(true)
  })

  it('every main build path copies boot.cjs into dist', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['build:main']).toContain('boot.cjs')
    expect(pkg.scripts['build:main:win']).toContain('boot.cjs')
    for (const f of ['../../scripts/electron-build-main.ts', '../../scripts/electron-dev.ts']) {
      expect(readFileSync(join(root, f), 'utf8')).toContain('src/main/boot.cjs')
    }
  })
})

describe('#1573 compile-cache dir (per-user, 0700)', () => {
  const { mkdtempSync, writeFileSync, copyFileSync, statSync, existsSync, mkdirSync, chmodSync, rmSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process')

  function run(env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'rox-boot-'))
    copyFileSync(join(root, 'src/main/boot.cjs'), join(dir, 'boot.cjs'))
    // Stub enableCompileCache so the test runs on any Node (real API needs Node >= 22.1).
    writeFileSync(join(dir, 'stub.cjs'), "require('node:module').enableCompileCache = d => { globalThis.__dir = d; return { status: 0 } }")
    writeFileSync(join(dir, 'main.cjs'), "process.stdout.write(String(globalThis.__dir ?? ''))")
    const r = spawnSync('node', ['-r', join(dir, 'stub.cjs'), join(dir, 'boot.cjs')], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' })
    return { dir, out: r.stdout, status: r.status }
  }

  it.skipIf(process.platform !== 'linux')('uses $XDG_CACHE_HOME/rox/compile-cache with mode 0700', () => {
    const home = mkdtempSync(join(tmpdir(), 'rox-home-'))
    const { out, status } = run({ HOME: home, XDG_CACHE_HOME: join(home, 'xdg') })
    expect(status).toBe(0)
    const expected = join(home, 'xdg', 'rox', 'compile-cache')
    expect(existsSync(expected)).toBe(true)
    expect(statSync(expected).mode & 0o777).toBe(0o700)
    expect(out).toContain(expected)
    rmSync(home, { recursive: true, force: true })
  })

  it.skipIf(process.platform !== 'linux')('falls back to ~/.cache and tightens group/world-writable dirs', () => {
    const home = mkdtempSync(join(tmpdir(), 'rox-home-'))
    const expected = join(home, '.cache', 'rox', 'compile-cache')
    mkdirSync(expected, { recursive: true })
    chmodSync(expected, 0o777)
    const { out } = run({ HOME: home })
    expect(statSync(expected).mode & 0o777).toBe(0o700)
    expect(out).toContain(expected)
    rmSync(home, { recursive: true, force: true })
  })

  it('ROX_DISABLE_COMPILE_CACHE=1 disables; other values do not', () => {
    const home = mkdtempSync(join(tmpdir(), 'rox-home-'))
    expect(run({ HOME: home, XDG_CACHE_HOME: join(home, 'x'), ROX_DISABLE_COMPILE_CACHE: '1' }).out).toBe('')
    if (process.platform === 'linux') expect(run({ HOME: home, XDG_CACHE_HOME: join(home, 'x'), ROX_DISABLE_COMPILE_CACHE: '0' }).out).toContain('compile-cache')
    rmSync(home, { recursive: true, force: true })
  })
})

describe('#1560 boot.cjs compileCache state mapping', () => {
  const { mkdtempSync, writeFileSync, copyFileSync, rmSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process')

  // statusExpr: JS expression for enableCompileCache's return (S = stub status constants).
  function state(statusExpr: string, env: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'rox-boot-'))
    const home = mkdtempSync(join(tmpdir(), 'rox-home-'))
    copyFileSync(join(root, 'src/main/boot.cjs'), join(dir, 'boot.cjs'))
    writeFileSync(join(dir, 'stub.cjs'), `const m = require('node:module'); const S = { FAILED: 0, ENABLED: 1, ALREADY_ENABLED: 2, DISABLED: 3 };
      Object.defineProperty(m, 'constants', { value: { ...(m.constants || {}), compileCacheStatus: S }, configurable: true });
      m.enableCompileCache = () => (${statusExpr})`)
    writeFileSync(join(dir, 'main.cjs'), 'process.stdout.write(String(globalThis.__roxBoot.compileCache))')
    const r = spawnSync('node', ['-r', join(dir, 'stub.cjs'), join(dir, 'boot.cjs')], {
      env: { PATH: process.env.PATH ?? '', HOME: home, XDG_CACHE_HOME: join(home, 'c'), LOCALAPPDATA: join(home, 'l'), ...env }, encoding: 'utf8' })
    rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true })
    return r.stdout
  }

  it('maps every compileCacheStatus', () => {
    expect(state('{ status: S.ENABLED }')).toBe('enabled')
    expect(state('{ status: S.ALREADY_ENABLED }')).toBe('enabled')
    expect(state('{ status: S.DISABLED }')).toBe('disabled')
    expect(state('{ status: S.FAILED }')).toBe('failed')
    expect(state('{ status: 99 }')).toBe('failed')
    expect(state('undefined')).toBe('failed')
  })

  it('reports disabled for ROX_DISABLE_COMPILE_CACHE=1', () => {
    expect(state('{ status: S.ENABLED }', { ROX_DISABLE_COMPILE_CACHE: '1' })).toBe('disabled')
  })
})

describe('#1560 ROX_COMPILE_CACHE_DIR override', () => {
  const { mkdtempSync, writeFileSync, copyFileSync, statSync, mkdirSync, chmodSync, rmSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process')

  function dirFor(env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'rox-boot-'))
    copyFileSync(join(root, 'src/main/boot.cjs'), join(dir, 'boot.cjs'))
    writeFileSync(join(dir, 'stub.cjs'), "require('node:module').enableCompileCache = d => { globalThis.__dir = d; return { status: 0 } }")
    writeFileSync(join(dir, 'main.cjs'), "process.stdout.write(String(globalThis.__dir ?? ''))")
    const r = spawnSync('node', ['-r', join(dir, 'stub.cjs'), join(dir, 'boot.cjs')], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' })
    rmSync(dir, { recursive: true, force: true })
    return r.stdout
  }

  it('uses an absolute override with 0700 (POSIX)', () => {
    const home = mkdtempSync(join(tmpdir(), 'rox-home-'))
    const target = join(home, 'bench', 'compile-cache')
    expect(dirFor({ HOME: home, XDG_CACHE_HOME: join(home, 'x'), LOCALAPPDATA: join(home, 'l'), ROX_COMPILE_CACHE_DIR: target })).toBe(target)
    if (process.platform !== 'win32') expect(statSync(target).mode & 0o777).toBe(0o700)
    rmSync(home, { recursive: true, force: true })
  })

  it('skips the cache for a relative override instead of falling back', () => {
    const home = mkdtempSync(join(tmpdir(), 'rox-home-'))
    expect(dirFor({ HOME: home, XDG_CACHE_HOME: join(home, 'x'), ROX_COMPILE_CACHE_DIR: 'rel/cache' })).toBe('')
    rmSync(home, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')('applies the same safety checks (non-directory skipped, loose perms tightened)', () => {
    const home = mkdtempSync(join(tmpdir(), 'rox-home-'))
    const file = join(home, 'not-a-dir'); writeFileSync(file, '')
    expect(dirFor({ HOME: home, ROX_COMPILE_CACHE_DIR: file })).toBe('')
    const loose = join(home, 'loose'); mkdirSync(loose); chmodSync(loose, 0o777)
    expect(dirFor({ HOME: home, ROX_COMPILE_CACHE_DIR: loose })).toBe(loose)
    expect(statSync(loose).mode & 0o777).toBe(0o700)
    rmSync(home, { recursive: true, force: true })
  })
})

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

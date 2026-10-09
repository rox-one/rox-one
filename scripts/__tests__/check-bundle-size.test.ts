/**
 * Bundle-size budget gate (scripts/check-bundle-size.ts) and the closed-form minify profile.
 *
 * The gate cases are exercised through the real CLI (exit codes as CI sees them) on throwaway
 * renderer trees; the prefix derivation and the unbudgeted ceiling are pure-function cases.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  MAX_NEW_CHUNK_BYTES,
  MIN_BUDGET_BYTES,
  buildBudgets,
  chunkPrefix,
  evaluateChunks,
  formatFailure,
  isMeasuredAsset,
  measureRendererChunks,
} from '../check-bundle-size'
import { minifyHangChecksum } from '../../apps/electron/src/renderer/perf/bundle-profile'

const ROOT = resolve(import.meta.dir, '..', '..')

const TEMP_DIRS: string[] = []
afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-size-'))
  TEMP_DIRS.push(dir)
  return dir
}

/** A throwaway `apps/electron/dist/renderer` tree; `files` maps an asset name to its byte size. */
function seedBuild(root: string, files: Record<string, number>, withIndexHtml = true): void {
  const rendererDist = join(root, 'apps/electron/dist/renderer')
  mkdirSync(join(rendererDist, 'assets'), { recursive: true })
  if (withIndexHtml) writeFileSync(join(rendererDist, 'index.html'), '<!doctype html>')
  for (const [name, size] of Object.entries(files)) writeFileSync(join(rendererDist, 'assets', name), Buffer.alloc(size))
}

function seedBaseline(root: string, budgets: Record<string, { rawBytes: number; gzipBytes: number }>): void {
  mkdirSync(join(root, 'perf-baselines'), { recursive: true })
  writeFileSync(join(root, 'perf-baselines/bundle-size.json'), JSON.stringify({ description: 'test', budgets }))
}

function runCli(root: string, args: string[] = ['--check']) {
  const result = Bun.spawnSync(['bun', 'scripts/check-bundle-size.ts', ...args], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ROX_BUNDLE_SIZE_ROOT: root },
  })
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() }
}

describe('chunk-name prefix derivation (never the content hash)', () => {
  it('strips the 8-character hash suffix from real emitted names', () => {
    expect(chunkPrefix('index-B3-J8HY7.js')).toBe('index')
    expect(chunkPrefix('main-qrX9lp_n.js')).toBe('main')
    expect(chunkPrefix('project-authority-BDUHCR2T.js')).toBe('project-authority')
    expect(chunkPrefix('useTranslation-C3vs8uOy.js')).toBe('useTranslation')
    expect(chunkPrefix('vendor-react-abc12345.js')).toBe('vendor-react')
  })

  it('leaves a name without an 8-character hash suffix untouched', () => {
    expect(chunkPrefix('chunk-abc.js')).toBe('chunk-abc')
  })
})

describe('measured assets (only emitted *.js; never source maps or the pdf worker)', () => {
  it('drops *.js.map and pdf.worker.min-*.mjs from the fixture listing', () => {
    expect(isMeasuredAsset('index-B3-J8HY7.js')).toBe(true)
    expect(isMeasuredAsset('index-B3-J8HY7.js.map')).toBe(false)
    expect(isMeasuredAsset('pdf.worker.min-qwK7q_zL.mjs')).toBe(false)

    const root = tempRoot()
    const assets = join(root, 'apps/electron/dist/renderer/assets')
    mkdirSync(assets, { recursive: true })
    for (const name of [
      'index-B3-J8HY7.js',
      'index-B3-J8HY7.js.map',
      'main-qrX9lp_n.js',
      'project-authority-BDUHCR2T.js',
      'useTranslation-C3vs8uOy.js',
      'vendor-react-abc12345.js',
      'pdf.worker.min-qwK7q_zL.mjs',
    ]) {
      writeFileSync(join(assets, name), Buffer.alloc(64))
    }

    const measured = measureRendererChunks(assets)
    expect(measured.map((chunk) => chunk.file)).toEqual([
      'index-B3-J8HY7.js',
      'main-qrX9lp_n.js',
      'project-authority-BDUHCR2T.js',
      'useTranslation-C3vs8uOy.js',
      'vendor-react-abc12345.js',
    ])
    expect(measured.some((chunk) => chunk.file.endsWith('.map') || chunk.file.startsWith('pdf.worker'))).toBe(false)
    expect(measured.map((chunk) => chunk.prefix)).toEqual([
      'index',
      'main',
      'project-authority',
      'useTranslation',
      'vendor-react',
    ])
  })
})

describe('budget evaluation', () => {
  it('flags a known prefix over its recorded rawBytes budget and names the file and both counts', () => {
    const failures = evaluateChunks(
      [{ file: 'main-abcdefgh.js', prefix: 'main', rawBytes: 2000, gzipBytes: 900 }],
      { main: { rawBytes: 1000, gzipBytes: 500 } },
    )
    expect(failures).toEqual([{ file: 'main-abcdefgh.js', prefix: 'main', rawBytes: 2000, budget: 1000 }])
    const line = formatFailure(failures[0]!)
    expect(line).toContain('assets/main-abcdefgh.js')
    expect(line).toContain('2000 B')
    expect(line).toContain('1000 B')
    expect(line).toContain("'main'")
    expect(line).toContain('+1000 B')
  })

  it('flags an unbudgeted prefix above the 2.5 MB ceiling', () => {
    const failures = evaluateChunks(
      [{ file: 'heavy-abcdefgh.js', prefix: 'heavy', rawBytes: MAX_NEW_CHUNK_BYTES + 1, gzipBytes: 1 }],
      {},
    )
    expect(failures).toEqual([
      { file: 'heavy-abcdefgh.js', prefix: 'heavy', rawBytes: MAX_NEW_CHUNK_BYTES + 1, budget: MAX_NEW_CHUNK_BYTES },
    ])
  })

  it('records a budget only for prefixes at or above the recording floor', () => {
    const recorded = buildBudgets([
      { file: 'index-abcdefgh.js', prefix: 'index', rawBytes: MIN_BUDGET_BYTES, gzipBytes: 10 },
      { file: 'index-abcdefgh.js', prefix: 'index', rawBytes: MIN_BUDGET_BYTES - 500, gzipBytes: 5 },
      { file: 'shiki-small-abcdefgh.js', prefix: 'shiki-small', rawBytes: MIN_BUDGET_BYTES - 1, gzipBytes: 3 },
    ])
    expect(recorded).toEqual({ index: { rawBytes: MIN_BUDGET_BYTES, gzipBytes: 10 } })
  })
})

describe('CLI exit codes', () => {
  it('exits 0 when every chunk is within budget', () => {
    const root = tempRoot()
    seedBuild(root, { 'main-qrX9lp_n.js': 800, 'index-B3-J8HY7.js': 1200 })
    seedBaseline(root, {
      main: { rawBytes: 1000, gzipBytes: 500 },
      index: { rawBytes: 2000, gzipBytes: 900 },
    })
    const result = runCli(root)
    expect(result.code).toBe(0)
    expect(result.err).not.toContain('bundle-size: assets/')
    expect(result.out).toContain('prefix')
    expect(result.out).toContain('main')
  })

  it('exits 1 (failure line names the file and both byte counts) when a budgeted prefix is over budget', () => {
    const root = tempRoot()
    seedBuild(root, { 'main-abcdefgh.js': 2000 })
    seedBaseline(root, { main: { rawBytes: 1000, gzipBytes: 500 } })
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain('assets/main-abcdefgh.js')
    expect(result.err).toContain('2000 B')
    expect(result.err).toContain('1000 B')
    expect(result.err).toContain('bun scripts/check-bundle-size.ts --update')
  })

  it('exits 1 when an unbudgeted chunk exceeds the 2.5 MB ceiling', () => {
    const root = tempRoot()
    seedBuild(root, { 'lazy-page-abcdefgh.js': MAX_NEW_CHUNK_BYTES + 1 })
    seedBaseline(root, {})
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain('assets/lazy-page-abcdefgh.js')
    expect(result.err).toContain(`${MAX_NEW_CHUNK_BYTES + 1} B`)
    expect(result.err).toContain(`${MAX_NEW_CHUNK_BYTES} B`)
  })

  it('fails closed with the exact message when there is no renderer build', () => {
    const root = tempRoot()
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain('no renderer build found - run bun run electron:build:renderer first')
  })
})

describe('minify profile closed form', () => {
  /** The pre-change implementation, verbatim, as the equivalence oracle. */
  function minifyHangOracle(sourceChars: number, iterations: number): number {
    let checksum = 0
    const sample = 'function x(){return 1}'
    for (let i = 0; i < iterations; i++) {
      for (let j = 0; j < Math.min(sourceChars, 50_000); j++) {
        checksum = (checksum + sample.charCodeAt(j % sample.length) + i) | 0
      }
    }
    return checksum
  }

  it('matches the per-character oracle for several sourceChars/iterations pairs', () => {
    for (const [sourceChars, iterations] of [
      [2000, 2],
      [12345, 8],
      [50000, 3],
      [90000, 4],
      [0, 5],
    ] as const) {
      expect(minifyHangChecksum(sourceChars, iterations)).toBe(minifyHangOracle(sourceChars, iterations))
    }
  })
})
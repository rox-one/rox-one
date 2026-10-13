/**
 * PERF-02 review: the bundled-skills merge runs in a worker_thread loaded from
 * `dist/bundled-skills-worker.cjs` (next to main.cjs). Worker scripts inside an
 * app.asar archive are not reliably loadable by worker_threads, so packaging
 * must keep that file on the real filesystem: either ASAR is off (today) or the
 * worker is listed in asarUnpack. If this fails, add
 * `asarUnpack: [dist/bundled-skills-worker.cjs]` (and resolve the path through
 * `app.asar.unpacked`) before enabling ASAR. The same holds for the shared
 * pool worker `dist/pool-worker.cjs` (ADR-0024).
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const electronRoot = join(import.meta.dir, '..', '..', '..')
const repoRoot = join(electronRoot, '..', '..')

function isOutsideAsar(file: string): boolean {
  const config = Bun.YAML.parse(readFileSync(join(electronRoot, 'electron-builder.yml'), 'utf8')) as {
    asar?: boolean | object
    asarUnpack?: string | string[]
  }
  const unpack = ([] as string[]).concat(config.asarUnpack ?? [])
  return config.asar === false
    || unpack.some(pattern => pattern === file || pattern === 'dist/**/*' || pattern === 'dist/*.cjs')
}

describe('bundled-skills worker packaging', () => {
  it('keeps dist/bundled-skills-worker.cjs outside app.asar', () => {
    const config = Bun.YAML.parse(readFileSync(join(electronRoot, 'electron-builder.yml'), 'utf8')) as {
      files?: string[]
    }
    expect(isOutsideAsar('dist/bundled-skills-worker.cjs')).toBe(true)
    // The worker is shipped by the generic dist glob.
    expect(config.files).toContain('dist/**/*')
  })

  it('builds the worker next to main.cjs (main resolves it via __dirname)', () => {
    const build = readFileSync(join(repoRoot, 'scripts', 'electron-build-main.ts'), 'utf8')
    expect(build).toContain('join(DIST_DIR, "bundled-skills-worker.cjs")')
    const main = readFileSync(join(electronRoot, 'src', 'main', 'index.ts'), 'utf8')
    expect(main).toContain("join(__dirname, 'bundled-skills-worker.cjs')")
  })

  it('builds the worker in dev too', () => {
    const dev = readFileSync(join(repoRoot, 'scripts', 'electron-dev.ts'), 'utf8')
    expect(dev).toContain('packages/shared/src/skills/bundled-sync.worker.ts')
    expect(dev).toContain('apps/electron/dist/bundled-skills-worker.cjs')
  })
})

describe('pool worker packaging', () => {
  it('keeps dist/pool-worker.cjs outside app.asar', () => {
    expect(isOutsideAsar('dist/pool-worker.cjs')).toBe(true)
  })

  it('builds the worker next to main.cjs in build and dev (main resolves it via __dirname)', () => {
    const build = readFileSync(join(repoRoot, 'scripts', 'electron-build-main.ts'), 'utf8')
    expect(build).toContain('"packages/shared/src/workers/pool.worker.ts"')
    expect(build).toContain('join(DIST_DIR, "pool-worker.cjs")')
    const dev = readFileSync(join(repoRoot, 'scripts', 'electron-dev.ts'), 'utf8')
    expect(dev).toContain('packages/shared/src/workers/pool.worker.ts')
    expect(dev).toContain('apps/electron/dist/pool-worker.cjs')
    const setup = readFileSync(join(electronRoot, 'src', 'main', 'worker-pool-setup.ts'), 'utf8')
    expect(setup).toContain("join(__dirname, 'pool-worker.cjs')")
    const main = readFileSync(join(electronRoot, 'src', 'main', 'index.ts'), 'utf8')
    expect(main).toContain('setupWorkerPool()')
  })
})

/**
 * PERF-02 review: the bundled-skills merge runs in a worker_thread loaded from
 * `dist/bundled-skills-worker.cjs` (next to main.cjs). Worker scripts inside an
 * app.asar archive are not reliably loadable by worker_threads, so packaging
 * must keep that file on the real filesystem: either ASAR is off (today) or the
 * worker is listed in asarUnpack. If this fails, add
 * `asarUnpack: [dist/bundled-skills-worker.cjs]` (and resolve the path through
 * `app.asar.unpacked`) before enabling ASAR.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const electronRoot = join(import.meta.dir, '..', '..', '..')

describe('bundled-skills worker packaging', () => {
  it('keeps dist/bundled-skills-worker.cjs outside app.asar', () => {
    const config = Bun.YAML.parse(readFileSync(join(electronRoot, 'electron-builder.yml'), 'utf8')) as {
      asar?: boolean | object
      asarUnpack?: string | string[]
      files?: string[]
    }
    const unpack = ([] as string[]).concat(config.asarUnpack ?? [])
    const unpacked = config.asar === false
      || unpack.some(pattern => pattern === 'dist/bundled-skills-worker.cjs' || pattern === 'dist/**/*' || pattern === 'dist/*.cjs')
    expect(unpacked).toBe(true)
    // The worker is shipped by the generic dist glob.
    expect(config.files).toContain('dist/**/*')
  })

  it('builds the worker next to main.cjs (main resolves it via __dirname)', () => {
    const build = readFileSync(join(electronRoot, '..', '..', 'scripts', 'electron-build-main.ts'), 'utf8')
    expect(build).toContain('join(DIST_DIR, "bundled-skills-worker.cjs")')
    const main = readFileSync(join(electronRoot, 'src', 'main', 'index.ts'), 'utf8')
    expect(main).toContain("join(__dirname, 'bundled-skills-worker.cjs')")
  })
})

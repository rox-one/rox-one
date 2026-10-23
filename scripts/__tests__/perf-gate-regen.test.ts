/**
 * The Renderer bundle-size / boot-manifest gate fails with one recovery command.
 * Keep the constant, the package.json script, and the failure-message wiring in lockstep.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PERF_GATE_REGEN_CMD } from '../perf-gate-regen'
import { formatFailure } from '../check-bundle-size'

const ROOT = resolve(import.meta.dir, '../..')

describe('perf:gate:regen', () => {
  it('exports the exact command failure messages must print', () => {
    expect(PERF_GATE_REGEN_CMD).toBe('bun run perf:gate:regen')
  })

  it('is wired as a package.json script to that file', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['perf:gate:regen']).toBe('bun run scripts/perf-gate-regen.ts')
  })

  it('formatFailure points at the regen command (not a bare --update)', () => {
    const message = formatFailure({
      kind: 'js',
      prefix: 'main',
      rawBytes: 2_000_000,
      budget: 1_500_000,
      file: 'main-aaaaaaaa.js',
      fileRawBytes: 1_300_000,
    })
    expect(message).toContain(PERF_GATE_REGEN_CMD)
    expect(message).not.toContain('bun scripts/check-bundle-size.ts --update')
  })

  it('boot-manifest and check-bundle-size source both import the constant', () => {
    const boot = readFileSync(join(ROOT, 'scripts/boot-manifest.ts'), 'utf8')
    const size = readFileSync(join(ROOT, 'scripts/check-bundle-size.ts'), 'utf8')
    expect(boot).toContain("from './perf-gate-regen'")
    expect(boot).toContain('PERF_GATE_REGEN_CMD')
    expect(size).toContain("from './perf-gate-regen'")
    expect(size).toContain('PERF_GATE_REGEN_CMD')
  })
})

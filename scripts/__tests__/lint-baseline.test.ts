/**
 * UI token lint ratchet (UI-A2, #1568).
 *
 * The end-to-end case is the acceptance proof: once a tree is baselined, adding a numeric `z-N`
 * or arbitrary `z-[n]` (TSX) or a raw `z-index: N` (CSS) anywhere makes `lint-baseline --check`
 * fail.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  buildBaseline,
  collectCounts,
  compareCounts,
  DEFAULT_BASELINE,
  mergeMax,
  readBaseline,
  ruleSeverities,
  rulesToFlip,
  type Counts,
} from '../lint-baseline'

const ROOT = resolve(import.meta.dir, '..', '..')
const FIXTURES = 'scripts/fixtures/lint-ratchet'
const WORK = `${FIXTURES}/work-${process.pid}`

afterAll(() => {
  rmSync(join(ROOT, WORK), { recursive: true, force: true })
})

function stage(variant: 'base' | 'new-z') {
  mkdirSync(join(ROOT, WORK), { recursive: true })
  cpSync(join(ROOT, FIXTURES, variant), join(ROOT, WORK), { recursive: true })
}

function runCli(args: string[]) {
  const result = Bun.spawnSync(['bun', 'scripts/lint-baseline.ts', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
  return { code: result.exitCode, out: `${result.stdout.toString()}${result.stderr.toString()}` }
}

describe('lint-baseline: ratchet maths', () => {
  const baseline: Counts = {
    'a.tsx': { 'rox/no-hardcoded-z-index': 2, 'rox/no-raw-color': 1 },
    'b.css': { 'stylelint/color-no-hex': 3 },
  }

  it('fails on growth per (file, rule), including new files and new rules', () => {
    const current: Counts = {
      'a.tsx': { 'rox/no-hardcoded-z-index': 3 },
      'b.css': { 'stylelint/color-no-hex': 3, 'stylelint/rox-css/no-theme-self-reference': 1 },
      'c.tsx': { 'rox/no-hardcoded-z-index': 1 },
    }
    const { increases, decreases } = compareCounts(baseline, current)
    expect(increases).toEqual([
      { file: 'a.tsx', rule: 'rox/no-hardcoded-z-index', baseline: 2, current: 3 },
      { file: 'b.css', rule: 'stylelint/rox-css/no-theme-self-reference', baseline: 0, current: 1 },
      { file: 'c.tsx', rule: 'rox/no-hardcoded-z-index', baseline: 0, current: 1 },
    ])
    expect(decreases).toEqual([{ file: 'a.tsx', rule: 'rox/no-raw-color', baseline: 1, current: 0 }])
  })

  it('does not let a decrease in one file pay for growth in another', () => {
    const current: Counts = {
      'a.tsx': { 'rox/no-hardcoded-z-index': 0, 'rox/no-raw-color': 1 },
      'b.css': { 'stylelint/color-no-hex': 3 },
      'd.tsx': { 'rox/no-hardcoded-z-index': 1 },
    }
    expect(compareCounts(baseline, current).increases).toHaveLength(1)
  })

  it('treats deleted files as zero', () => {
    expect(compareCounts(baseline, { 'b.css': { 'stylelint/color-no-hex': 3 } }).increases).toEqual([])
  })

  it('requires a rule at 0 to be an error', () => {
    const severities = { 'rox/no-hardcoded-z-index': 'warn', 'rox/no-raw-color': 'warn', 'rox/prefer-primitives': 'warn', 'rox/no-arbitrary-radius': 'error' } as const
    expect(rulesToFlip(baseline, severities)).toEqual(['rox/prefer-primitives'])
  })

  it('merges counts from another tree by per-file max', () => {
    expect(mergeMax({ 'a.tsx': { r: 2 } }, { 'a.tsx': { r: 1, s: 4 }, 'z.tsx': { r: 1 } })).toEqual({
      'a.tsx': { r: 2, s: 4 },
      'z.tsx': { r: 1 },
    })
  })
})

describe('lint-baseline: the committed baseline', () => {
  const baselinePath = join(ROOT, DEFAULT_BASELINE)
  const baseline = readBaseline(baselinePath)
  const severities = ruleSeverities(ROOT)

  it('exists and records every ratcheted rule with its current severity', () => {
    expect(existsSync(baselinePath)).toBe(true)
    expect(Object.keys(baseline.rules).sort()).toEqual(Object.keys(severities).sort())
    for (const [rule, severity] of Object.entries(severities)) expect(baseline.rules[rule]?.severity, rule).toBe(severity)
  })

  it('has rule totals that match the per-file counts', () => {
    const rebuilt = buildBaseline(baseline.files, severities)
    expect(rebuilt.rules).toEqual(baseline.rules)
  })

  it('has no rule at 0 left as a warning', () => {
    expect(rulesToFlip(baseline.files, severities)).toEqual([])
  })

  it('covers the z rules on both TSX and CSS', () => {
    expect(severities['rox/no-hardcoded-z-index']).toBeDefined()
    expect(severities['craft-styles/no-hardcoded-z-index']).toBe('error')
    expect(severities['stylelint/scale-unlimited/declaration-strict-value']).toBeDefined()
    expect(severities['stylelint/rox-css/no-theme-self-reference']).toBeDefined()
  })
})

describe('lint-baseline: failing fixture (acceptance: no new numeric z anywhere)', () => {
  it('counts the fixture violations per rule and file', async () => {
    const counts = await collectCounts(ROOT, { eslintTargets: [`${FIXTURES}/new-z`], cssTargets: [`${FIXTURES}/new-z`] })
    expect(counts[`${FIXTURES}/new-z/Panel.tsx`]).toEqual({ 'rox/no-hardcoded-z-index': 3 })
    expect(counts[`${FIXTURES}/new-z/panel.css`]).toEqual({ 'stylelint/scale-unlimited/declaration-strict-value': 2 })
  }, 60_000)

  it('passes on the baselined tree and fails once z-N / z-[n] / z-index: N are added', () => {
    const baselineFile = `${WORK}/baseline.json`
    stage('base')
    const update = runCli(['--update', '--targets', WORK, '--baseline', baselineFile])
    expect(update.code, update.out).toBe(0)
    const written = JSON.parse(readFileSync(join(ROOT, baselineFile), 'utf8'))
    expect(written.files[`${WORK}/Panel.tsx`]).toEqual({ 'rox/no-hardcoded-z-index': 1 })
    expect(written.files[`${WORK}/panel.css`]).toEqual({ 'stylelint/scale-unlimited/declaration-strict-value': 1 })

    const clean = runCli(['--targets', WORK, '--baseline', baselineFile])
    expect(clean.code, clean.out).toBe(0)

    stage('new-z')
    const check = runCli(['--targets', WORK, '--baseline', baselineFile])
    expect(check.code, check.out).toBe(1)
    expect(check.out).toContain(`${WORK}/Panel.tsx: rox/no-hardcoded-z-index 1 -> 3 (+2)`)
    expect(check.out).toContain(`${WORK}/panel.css: stylelint/scale-unlimited/declaration-strict-value 1 -> 2 (+1)`)

    // --update refuses to record the growth.
    const refused = runCli(['--update', '--targets', WORK, '--baseline', baselineFile])
    expect(refused.code, refused.out).toBe(1)
    expect(refused.out).toContain('refusing to record growth')
  }, 120_000)
})

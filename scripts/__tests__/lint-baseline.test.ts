/**
 * UI token lint ratchet (UI-A2, #1568).
 *
 * The end-to-end case is the acceptance proof: once a tree is baselined, adding a numeric `z-N`
 * or arbitrary `z-[n]` (TSX) or a raw `z-index: N` (CSS) anywhere makes `lint-baseline --check`
 * fail.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  applyRenames,
  buildBaseline,
  collectCounts,
  collectLint,
  compareCounts,
  compareWithBase,
  DEFAULT_BASELINE,
  gitRenames,
  justifiedDirectives,
  main,
  mergeMax,
  mergePrefixes,
  parseRenames,
  readBaseBaseline,
  readBaseline,
  ruleSeverities,
  rulesToFlip,
  type Baseline,
  type Counts,
} from '../lint-baseline'

const ROOT = resolve(import.meta.dir, '..', '..')
const FIXTURES = 'scripts/fixtures/lint-ratchet'
const WORK = `${FIXTURES}/work-${process.pid}`

const TEMP_DIRS: string[] = []

afterAll(() => {
  rmSync(join(ROOT, WORK), { recursive: true, force: true })
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'lint-baseline-'))
  TEMP_DIRS.push(dir)
  git(dir, 'init', '-q')
  return dir
}

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

describe('lint-baseline: suppressions (review1 W2)', () => {
  it('exempts only next-line/line directives that name the rule and give a justification', () => {
    const source = [
      '/* eslint-disable rox/no-hardcoded-z-index -- file-wide */', // 1: file-wide: never exempt
      '// eslint-disable-next-line rox/no-hardcoded-z-index', //       2: no reason
      'a', //                                                          3
      '// eslint-disable-next-line', //                                4: bare
      'b', //                                                          5
      '// eslint-disable-next-line rox/a, rox/b -- vendor contract', // 6
      'c', //                                                          7
      'd // eslint-disable-line rox/c -- reason', //                    8
      '/* eslint-disable-next-line rox/d -- reason */', //             9
      'e', //                                                          10
      '// eslint-disable-next-line rox/e --', //                       11: empty reason
      'f', //                                                          12
    ].join('\n')
    expect([...justifiedDirectives(source, 'eslint')].sort()).toEqual(['10:rox/d', '7:rox/a', '7:rox/b', '8:rox/c'])
  })

  it('reads stylelint block directives the same way', () => {
    const source = '/* stylelint-disable-next-line color-no-hex -- brand asset */\n.a { color: #fff; }\n/* stylelint-disable-next-line color-no-hex */\n.b { color: #000; }'
    expect([...justifiedDirectives(source, 'stylelint')]).toEqual(['2:color-no-hex'])
  })

  it('counts file-wide, inline-config, bare, reason-less and wrong-rule disables; exempts justified ones', async () => {
    const dir = `${FIXTURES}/directives`
    const { counts, exempt } = await collectLint(ROOT, { eslintTargets: [dir], cssTargets: [dir] })
    // z-10 (file-wide + inline config), z-20 (no reason), z-30 (bare), z-40 (empty reason), z-50 (wrong rule)
    expect(counts[`${dir}/Directives.tsx`]).toEqual({ 'rox/no-hardcoded-z-index': 5 })
    // z-[9999] (justified next-line) and z-[60] (justified same-line)
    expect(exempt[`${dir}/Directives.tsx`]).toEqual({ 'rox/no-hardcoded-z-index': 2 })
    // .a (stylelint-disable block) and .b (reason-less) count; .c is justified; @apply z-50 counts.
    expect(counts[`${dir}/directives.css`]).toEqual({
      'stylelint/rox-css/no-apply-numeric-z': 1,
      'stylelint/scale-unlimited/declaration-strict-value': 2,
    })
    expect(exempt[`${dir}/directives.css`]).toEqual({ 'stylelint/scale-unlimited/declaration-strict-value': 1 })
  }, 60_000)
})

describe('lint-baseline: ungated rules (review1 W3)', () => {
  it('keeps raw error render and raw checkbox out of the gate, keeps <select> gated', async () => {
    const dir = `${FIXTURES}/ungated`
    const { counts, ungated } = await collectLint(ROOT, { eslintTargets: [dir], cssTargets: [] })
    expect(counts[`${dir}/Ungated.tsx`]).toEqual({ 'rox/prefer-primitives': 1 })
    expect(ungated[`${dir}/Ungated.tsx`]).toEqual({ 'rox/no-raw-error-render': 1, 'rox/prefer-primitives': 1 })
  }, 60_000)

  it('does not list a wholly ungated rule in the severity table (no flip-at-0 for it)', () => {
    const severities = ruleSeverities(ROOT)
    expect(severities['rox/no-raw-error-render']).toBeUndefined()
    expect(severities['rox/prefer-primitives']).toBe('warn')
  })
})

describe('lint-baseline: renames (review1 info 1)', () => {
  it('parses git diff -M --name-status -z output', () => {
    expect(parseRenames('M\0a.tsx\0R087\0old/x.tsx\0new/x.tsx\0C100\0p.css\0q.css\0D\0gone.tsx\0')).toEqual([
      { from: 'old/x.tsx', to: 'new/x.tsx' },
    ])
  })

  it('moves counts along renames so a move is not growth', () => {
    const baseline: Counts = { 'old/x.tsx': { r: 2 }, 'y.tsx': { r: 1 } }
    const renamed = applyRenames(baseline, [{ from: 'old/x.tsx', to: 'new/x.tsx' }])
    expect(renamed).toEqual({ 'new/x.tsx': { r: 2 }, 'y.tsx': { r: 1 } })
    expect(compareCounts(renamed, { 'new/x.tsx': { r: 2 }, 'y.tsx': { r: 1 } }).increases).toEqual([])
    expect(compareCounts(renamed, { 'new/x.tsx': { r: 3 } }).increases).toHaveLength(1)
  })

  it('reads renames from git (working tree vs base)', () => {
    const repo = tempRepo()
    mkdirSync(join(repo, 'old'))
    writeFileSync(join(repo, 'old/Panel.tsx'), 'export const a = "z-50"\n'.repeat(20))
    git(repo, 'add', '.')
    git(repo, 'commit', '-qm', 'base')
    mkdirSync(join(repo, 'new'))
    git(repo, 'mv', 'old/Panel.tsx', 'new/Panel.tsx')
    expect(gitRenames(repo, 'HEAD')).toEqual([{ from: 'old/Panel.tsx', to: 'new/Panel.tsx' }])
  })
})

describe('lint-baseline: base-branch baseline (review1 W1)', () => {
  const severities = { 'rox/a': 'warn', 'rox/b': 'error' } as const
  const base: Baseline = buildBaseline({ 'x.tsx': { 'rox/a': 2 }, 'old.tsx': { 'rox/a': 1 } }, severities)

  it('passes when the committed baseline only shrinks or follows renames', () => {
    const head = buildBaseline({ 'x.tsx': { 'rox/a': 1 }, 'new.tsx': { 'rox/a': 1 } }, severities)
    expect(compareWithBase(base, head, [{ from: 'old.tsx', to: 'new.tsx' }])).toEqual({ increases: [], weakened: [] })
  })

  it('fails when a PR raises its own baseline count, adds a file, or weakens a rule', () => {
    const head = buildBaseline({ 'x.tsx': { 'rox/a': 3 }, 'z.tsx': { 'rox/b': 1 } }, { 'rox/a': 'warn', 'rox/b': 'warn' })
    const { increases, weakened } = compareWithBase(base, head)
    expect(increases.map((change) => `${change.file}:${change.rule}:${change.baseline}->${change.current}`)).toEqual([
      'x.tsx:rox/a:2->3',
      'z.tsx:rox/b:0->1',
    ])
    expect(weakened).toEqual([{ rule: 'rox/b', from: 'error', to: 'warn' }])
    const dropped = compareWithBase(base, buildBaseline({}, { 'rox/a': 'warn' }))
    expect(dropped.weakened).toEqual([{ rule: 'rox/b', from: 'error', to: 'removed' }])
  })

  it('reads the base baseline with git show, null when the base has none, throws on a missing ref', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'README'), 'x\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-qm', 'no baseline yet')
    expect(readBaseBaseline(repo, 'HEAD')).toBeNull()
    mkdirSync(join(repo, 'eslint-baselines'))
    writeFileSync(join(repo, DEFAULT_BASELINE), JSON.stringify(base))
    git(repo, 'add', '.')
    git(repo, 'commit', '-qm', 'baseline')
    expect(readBaseBaseline(repo, 'HEAD')?.files).toEqual(base.files)
    expect(() => readBaseBaseline(repo, 'origin/does-not-exist')).toThrow('not available')
  })
})

describe('lint-baseline: --targets / --allow-increase guards (review1 infos 1, 2)', () => {
  it('refuses --update --targets on the default baseline without --prefix-merge', async () => {
    expect(await main(['--update', '--targets', `${FIXTURES}/base`])).toBe(1)
    expect(await main(['--update', '--prefix-merge'])).toBe(1)
    expect(await main(['--update', '--allow-increase'])).toBe(1)
  })

  it('merges only the targeted prefixes', () => {
    const existing: Counts = { 'a/x.tsx': { r: 1 }, 'b/y.tsx': { r: 2 }, 'ab/z.tsx': { r: 3 } }
    expect(mergePrefixes(existing, { 'a/w.tsx': { r: 4 }, 'b/y.tsx': { r: 9 } }, ['a'])).toEqual({
      'a/w.tsx': { r: 4 },
      'ab/z.tsx': { r: 3 },
      'b/y.tsx': { r: 2 },
    })
  })

  it('--prefix-merge keeps other files; --allow-increase is scoped to the named files', () => {
    const baselineFile = `${WORK}/prefix-baseline.json`
    stage('base')
    writeFileSync(join(ROOT, baselineFile), JSON.stringify(buildBaseline({ 'elsewhere/Keep.tsx': { 'rox/no-hardcoded-z-index': 7 } }, {})))
    // New files under the prefix are growth too: refused unless named.
    const refusedNew = runCli(['--update', '--targets', WORK, '--baseline', baselineFile, '--prefix-merge'])
    expect(refusedNew.code, refusedNew.out).toBe(1)
    const merged = runCli([
      '--update', '--targets', WORK, '--baseline', baselineFile, '--prefix-merge',
      '--allow-increase', `${WORK}/Panel.tsx`, `${WORK}/panel.css`,
    ])
    expect(merged.code, merged.out).toBe(0)
    const written = JSON.parse(readFileSync(join(ROOT, baselineFile), 'utf8'))
    expect(written.files['elsewhere/Keep.tsx']).toEqual({ 'rox/no-hardcoded-z-index': 7 })
    expect(written.files[`${WORK}/Panel.tsx`]).toEqual({ 'rox/no-hardcoded-z-index': 1 })

    stage('new-z')
    const partly = runCli(['--update', '--targets', WORK, '--baseline', baselineFile, '--prefix-merge', '--allow-increase', `${WORK}/panel.css`])
    expect(partly.code, partly.out).toBe(1)
    expect(partly.out).toContain(`${WORK}/Panel.tsx: rox/no-hardcoded-z-index 1 -> 3`)
    expect(partly.out).not.toContain(`${WORK}/panel.css:`)
    const both = runCli([
      '--update', '--targets', WORK, '--baseline', baselineFile, '--prefix-merge',
      '--allow-increase', `${WORK}/panel.css`, `${WORK}/Panel.tsx`,
    ])
    expect(both.code, both.out).toBe(0)
    expect(JSON.parse(readFileSync(join(ROOT, baselineFile), 'utf8')).files['elsewhere/Keep.tsx']).toEqual({ 'rox/no-hardcoded-z-index': 7 })

    // --merge (repeatable) is per-file max with another tree's counts; growth it brings needs naming too.
    const otherTree = `${WORK}/other-tree.json`
    const mainTree = `${WORK}/main-tree.json`
    writeFileSync(join(ROOT, otherTree), JSON.stringify({ 'elsewhere/Keep.tsx': { 'rox/no-hardcoded-z-index': 9 } }))
    writeFileSync(join(ROOT, mainTree), JSON.stringify({ 'elsewhere/New.tsx': { 'rox/no-hardcoded-z-index': 2 } }))
    const mergeArgs = ['--update', '--targets', WORK, '--baseline', baselineFile, '--prefix-merge', '--merge', otherTree, '--merge', mainTree]
    const mergeRefused = runCli(mergeArgs)
    expect(mergeRefused.code, mergeRefused.out).toBe(1)
    expect(mergeRefused.out).toContain('elsewhere/Keep.tsx: rox/no-hardcoded-z-index 7 -> 9')
    expect(mergeRefused.out).toContain('elsewhere/New.tsx: rox/no-hardcoded-z-index 0 -> 2')
    const mergeOk = runCli([...mergeArgs, '--allow-increase', 'elsewhere/Keep.tsx', 'elsewhere/New.tsx'])
    expect(mergeOk.code, mergeOk.out).toBe(0)
    const afterMerge = JSON.parse(readFileSync(join(ROOT, baselineFile), 'utf8')).files
    expect(afterMerge['elsewhere/Keep.tsx']).toEqual({ 'rox/no-hardcoded-z-index': 9 })
    expect(afterMerge['elsewhere/New.tsx']).toEqual({ 'rox/no-hardcoded-z-index': 2 })
  }, 180_000)
})

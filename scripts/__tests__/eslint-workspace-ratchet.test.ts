/**
 * ESLint workspace ratchet (DX-03). The integration cases lint real gated workspaces with the
 * shared base config and check them against the committed baselines: the acceptance proof that the
 * workspaces are covered and that `--check` is green on a clean tree and would fail on growth or on
 * a counted file silently leaving the gate.
 *
 * The probe cases build a throwaway workspace on top of the real scripts/eslint/base-config.mjs to
 * pin the counting rule: a bare `/* eslint-disable *​/` no longer hides a violation (noInlineConfig),
 * a justified next-line directive still exempts one.
 */
import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compareCounts, compareWithBase, type Rename } from '../lint-baseline.ts'
import {
  WORKSPACES,
  baselinePath,
  buildWorkspaceBaseline,
  collectWorkspace,
  collectWorkspaceRun,
  main,
  readWorkspaceBaseline,
  staleCountedFiles,
} from '../eslint-workspace-ratchet.ts'

const ROOT = resolve(import.meta.dir, '../..')

/** A throwaway root with one `packages/probe` workspace wired to the real base config. */
function makeProbeRoot(): string {
  const root = mkdtempSync(`${tmpdir()}/ws-ratchet-`)
  const dir = resolve(root, 'packages/probe')
  mkdirSync(resolve(dir, 'src'), { recursive: true })
  const baseConfig = pathToFileURL(resolve(ROOT, 'scripts/eslint/base-config.mjs')).href
  writeFileSync(
    resolve(dir, 'eslint.config.mjs'),
    `import { workspaceConfig } from ${JSON.stringify(baseConfig)}\nexport default workspaceConfig()\n`,
  )
  return root
}

const PROBE = { name: 'probe', dir: 'packages/probe' }

describe('baseline construction', () => {
  it('records per-rule totals and the config severities', () => {
    const baseline = buildWorkspaceBaseline(
      { 'packages/x/src/a.ts': { 'no-empty': 2 }, 'packages/x/src/b.ts': { 'no-empty': 1, 'prefer-const': 4 } },
      { 'no-empty': 'warn', 'prefer-const': 'error' },
    )
    expect(baseline.rules['no-empty']).toEqual({ severity: 'warn', total: 3 })
    expect(baseline.rules['prefer-const']).toEqual({ severity: 'error', total: 4 })
    expect(baseline.files['packages/x/src/b.ts']).toEqual({ 'no-empty': 1, 'prefer-const': 4 })
  })
})

describe('disable comments never hide a violation (noInlineConfig)', () => {
  it('counts a violation a bare eslint-disable would have suppressed', async () => {
    const root = makeProbeRoot()
    writeFileSync(resolve(root, 'packages/probe/src/bare.ts'), '/* eslint-disable no-empty */\nif (globalThis) {}\n')
    const run = await collectWorkspaceRun(root, PROBE)
    expect(run.counts['packages/probe/src/bare.ts']?.['no-empty']).toBe(1)
  })

  it('exempts a justified next-line directive (parity with scripts/lint-baseline.ts)', async () => {
    const root = makeProbeRoot()
    writeFileSync(
      resolve(root, 'packages/probe/src/justified.ts'),
      '// eslint-disable-next-line no-empty -- deliberate empty block for the probe\nif (globalThis) {}\n',
    )
    const run = await collectWorkspaceRun(root, PROBE)
    expect(run.counts['packages/probe/src/justified.ts']).toBeUndefined()
    expect(run.exempt['packages/probe/src/justified.ts']?.['no-empty']).toBe(1)
  })
})

describe('staleCountedFiles', () => {
  const baseline = { 'packages/x/src/a.ts': { 'no-empty': 2 } }

  it('flags a baselined file the config no longer lints (skipped)', () => {
    expect(staleCountedFiles(baseline, new Set<string>(), ['packages/x/src/a.ts'])).toEqual([
      { file: 'packages/x/src/a.ts', violations: 2, reason: 'skipped' },
    ])
  })

  it('flags a rename whose target left the counted set', () => {
    const renames: Rename[] = [{ from: 'packages/x/src/a.ts', to: 'packages/x/src/a.test.ts' }]
    expect(staleCountedFiles(baseline, new Set<string>(), [], renames)).toEqual([
      { file: 'packages/x/src/a.ts', violations: 2, reason: 'moved-out' },
    ])
  })

  it('does not flag a plain delete or a rename that stays counted', () => {
    expect(staleCountedFiles(baseline, new Set<string>(), [])).toEqual([])
    const renames: Rename[] = [{ from: 'packages/x/src/a.ts', to: 'packages/x/src/b.ts' }]
    expect(staleCountedFiles(baseline, new Set(['packages/x/src/b.ts']), [], renames)).toEqual([])
  })

  it('does not flag a file that is still linted', () => {
    expect(staleCountedFiles(baseline, new Set(['packages/x/src/a.ts']), ['packages/x/src/a.ts'])).toEqual([])
  })
})

describe('renames versus false growth', () => {
  it('a renamed counted file is not growth in the base comparison', () => {
    const base = buildWorkspaceBaseline({ 'packages/x/src/old.ts': { 'no-empty': 3 } }, { 'no-empty': 'warn' })
    const head = buildWorkspaceBaseline({ 'packages/x/src/new.ts': { 'no-empty': 3 } }, { 'no-empty': 'warn' })
    const { increases, weakened } = compareWithBase(
      base,
      head,
      [{ from: 'packages/x/src/old.ts', to: 'packages/x/src/new.ts' }],
      new Set(['packages/x/src/new.ts']),
    )
    expect(increases).toEqual([])
    expect(weakened).toEqual([])
  })
})

describe('gated workspace coverage', () => {
  it('every registered workspace has a config and a committed baseline', () => {
    expect(WORKSPACES.length).toBe(10)
    for (const workspace of WORKSPACES) {
      const baseline = readWorkspaceBaseline(baselinePath(ROOT, workspace.name))
      expect(baseline, `${workspace.name} baseline`).not.toBeNull()
    }
  })

  it('lints a real workspace to the committed baseline (no growth on a clean tree)', async () => {
    const workspace = WORKSPACES.find((entry) => entry.name === 'core')!
    const baseline = readWorkspaceBaseline(baselinePath(ROOT, workspace.name))!
    const current = await collectWorkspace(ROOT, workspace)
    expect(Object.keys(current).length).toBeGreaterThan(0)
    expect(compareCounts(baseline.files, current).increases).toEqual([])
  })

  it(
    'checks more than one workspace in a single run',
    async () => {
      expect(await main(['--check', '--workspace', 'core', '--workspace', 'viewer'], {})).toBe(0)
    },
    180_000,
  )
})
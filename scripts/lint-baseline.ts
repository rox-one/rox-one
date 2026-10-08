#!/usr/bin/env bun
/**
 * lint-baseline.ts — UI token lint ratchet (UI-A2, #1568; UI-AUDIT §8).
 *
 * Runs the rox/* ESLint rules (apps/electron/eslint-rules/ui-tokens.cjs) over the UI sources and
 * stylelint (.stylelintrc.cjs) over the UI CSS, then compares per-rule, per-file counts with
 * eslint-baselines/ui-tokens.json.
 *
 *   bun scripts/lint-baseline.ts            # --check (CI): fail if any (file, rule) count grew,
 *                                           #   or a rule at 0 is still a warning
 *   bun scripts/lint-baseline.ts --update   # rewrite the baseline; refuses to record growth
 *                                           #   (the first run, with no baseline file, records all)
 *   bun scripts/lint-baseline.ts --print <out.json>   # write current counts, compare nothing
 *
 * Options:
 *   --baseline <file>      baseline path (default eslint-baselines/ui-tokens.json)
 *   --root <dir>           repository root (default: this script's parent)
 *   --allow-increase       with --update: record growth (owner-approved exceptions only)
 *   --merge <counts.json>  with --update: take the per-file max with counts from another tree
 *                          (for example a --print run on the merge result with main)
 *   --targets <a,b>        lint only these directories (fixtures/tests). A partial run skips the
 *                          whole-repo checks (flip-to-error at 0, severity drift).
 *
 * Counting rules: every message counts once; tests and fixtures are excluded (they quote banned
 * strings on purpose); files that are gone simply drop out. A justified
 * `// eslint-disable-next-line rox/<rule> -- reason` is the reviewed escape hatch.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { ESLint, type Linter } from 'eslint'
import tsParser from '@typescript-eslint/parser'

const require = createRequire(import.meta.url)
const SCRIPT_ROOT = resolve(import.meta.dir ?? dirname(new URL(import.meta.url).pathname), '..')

/** Source trees the ESLint rules run on. "Anywhere new" means every UI tree, not only the renderer. */
export const ESLINT_TARGETS = ['apps/electron/src', 'packages/ui/src', 'apps/viewer/src', 'apps/webui/src']
/** CSS the stylelint rules run on. */
export const CSS_TARGETS = ['apps/electron/src', 'packages/ui/src', 'apps/viewer/src', 'apps/webui/src']
export const DEFAULT_BASELINE = 'eslint-baselines/ui-tokens.json'
export const STYLELINT_PREFIX = 'stylelint/'

export type Counts = Record<string, Record<string, number>>
export type Severity = 'error' | 'warn'

export interface Baseline {
  description: string
  rules: Record<string, { severity: Severity; total: number }>
  files: Counts
}

export interface Comparison {
  increases: Array<{ file: string; rule: string; baseline: number; current: number }>
  decreases: Array<{ file: string; rule: string; baseline: number; current: number }>
}

interface UiTokensModule {
  plugin: { rules: Record<string, unknown> }
  rules: Record<string, Linter.RuleEntry>
  Z_INDEX_V1: Linter.RuleEntry
  TEST_FILES: string[]
}

function loadUiTokens(root: string): UiTokensModule {
  return require(resolve(root, 'apps/electron/eslint-rules/ui-tokens.cjs'))
}

function severityOf(entry: unknown): Severity | 'off' {
  const level = Array.isArray(entry) ? entry[0] : entry
  if (level === 'error' || level === 2) return 'error'
  if (level === 'warn' || level === 1) return 'warn'
  return 'off'
}

/** Severity of every ratcheted rule: ESLint from ui-tokens.cjs, stylelint from .stylelintrc.cjs. */
export function ruleSeverities(root: string): Record<string, Severity> {
  const uiTokens = loadUiTokens(root)
  const severities: Record<string, Severity> = {}
  for (const [rule, entry] of Object.entries({ ...uiTokens.rules, 'craft-styles/no-hardcoded-z-index': uiTokens.Z_INDEX_V1 })) {
    const severity = severityOf(entry)
    if (severity !== 'off') severities[rule] = severity
  }
  const stylelintConfig = require(resolve(root, '.stylelintrc.cjs'))
  const fallback: Severity = stylelintConfig.defaultSeverity === 'warning' ? 'warn' : 'error'
  for (const [rule, setting] of Object.entries<unknown>(stylelintConfig.rules ?? {})) {
    if (setting === null || setting === false) continue
    const secondary = Array.isArray(setting) && setting.length > 1 ? (setting[1] as { severity?: string }) : undefined
    const declared = secondary && typeof secondary === 'object' ? secondary.severity : undefined
    severities[`${STYLELINT_PREFIX}${rule}`] = declared ? (declared === 'warning' ? 'warn' : 'error') : fallback
  }
  return severities
}

function eslintConfig(root: string): Linter.Config[] {
  const uiTokens = loadUiTokens(root)
  const zIndexRule = require(resolve(root, 'apps/electron/eslint-rules/no-hardcoded-z-index.cjs'))
  return [
    { ignores: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', ...uiTokens.TEST_FILES] },
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        parser: tsParser as Linter.Parser,
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      },
      linterOptions: { reportUnusedDisableDirectives: 'off' },
      plugins: {
        rox: uiTokens.plugin as never,
        'craft-styles': { rules: { 'no-hardcoded-z-index': zIndexRule } },
      },
      rules: { ...uiTokens.rules, 'craft-styles/no-hardcoded-z-index': uiTokens.Z_INDEX_V1 },
    },
  ]
}

function add(counts: Counts, file: string, rule: string, by = 1) {
  const perFile = (counts[file] ??= {})
  perFile[rule] = (perFile[rule] ?? 0) + by
}

/**
 * Lint the given trees and return per-file, per-rule counts (paths relative to root, POSIX).
 * `eslintTargets` / `cssTargets` are directories relative to root.
 */
export async function collectCounts(
  root: string,
  { eslintTargets = ESLINT_TARGETS, cssTargets = CSS_TARGETS }: { eslintTargets?: string[]; cssTargets?: string[] } = {},
): Promise<Counts> {
  const counts: Counts = {}
  const severities = ruleSeverities(root)
  const toKey = (file: string) => relative(root, file).split('\\').join('/')

  const existingEslint = eslintTargets.filter((target) => existsSync(resolve(root, target)))
  if (existingEslint.length) {
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: eslintConfig(root),
      errorOnUnmatchedPattern: false,
    })
    const results = await eslint.lintFiles(existingEslint.map((target) => `${target}/**/*.{ts,tsx}`))
    for (const result of results) {
      for (const message of result.messages) {
        if (message.fatal) throw new Error(`ESLint could not parse ${toKey(result.filePath)}: ${message.message}`)
        if (message.ruleId && message.ruleId in severities) add(counts, toKey(result.filePath), message.ruleId)
      }
    }
  }

  const existingCss = cssTargets.filter((target) => existsSync(resolve(root, target)))
  if (existingCss.length) {
    const { default: stylelint } = await import('stylelint')
    const { results } = await stylelint.lint({
      cwd: root,
      configFile: resolve(root, '.stylelintrc.cjs'),
      configBasedir: root,
      files: existingCss.map((target) => `${target}/**/*.css`),
      allowEmptyInput: true,
    })
    for (const result of results) {
      const file = toKey(result.source ?? '')
      for (const parseError of result.parseErrors ?? []) {
        throw new Error(`stylelint could not parse ${file}: ${JSON.stringify(parseError)}`)
      }
      for (const warning of result.warnings) {
        if (warning.rule === 'CssSyntaxError') throw new Error(`stylelint could not parse ${file}: ${warning.text}`)
        const rule = `${STYLELINT_PREFIX}${warning.rule}`
        if (rule in severities) add(counts, file, rule)
      }
    }
  }
  return sortCounts(counts)
}

export function sortCounts(counts: Counts): Counts {
  const sorted: Counts = {}
  for (const file of Object.keys(counts).sort()) {
    const rules = counts[file]!
    const entries = Object.keys(rules).sort().filter((rule) => rules[rule]! > 0)
    if (entries.length) sorted[file] = Object.fromEntries(entries.map((rule) => [rule, rules[rule]!]))
  }
  return sorted
}

export function totals(counts: Counts): Record<string, number> {
  const result: Record<string, number> = {}
  for (const rules of Object.values(counts)) {
    for (const [rule, count] of Object.entries(rules)) result[rule] = (result[rule] ?? 0) + count
  }
  return result
}

/** Per (file, rule): growth fails, shrinkage is reported so the baseline can be tightened. */
export function compareCounts(baseline: Counts, current: Counts): Comparison {
  const comparison: Comparison = { increases: [], decreases: [] }
  const files = new Set([...Object.keys(baseline), ...Object.keys(current)])
  for (const file of [...files].sort()) {
    const before = baseline[file] ?? {}
    const after = current[file] ?? {}
    for (const rule of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const was = before[rule] ?? 0
      const now = after[rule] ?? 0
      if (now > was) comparison.increases.push({ file, rule, baseline: was, current: now })
      else if (now < was) comparison.decreases.push({ file, rule, baseline: was, current: now })
    }
  }
  return comparison
}

/** Rules whose baseline total is 0 must be errors: the "flip to error at 0" step of the ratchet. */
export function rulesToFlip(baselineCounts: Counts, severities: Record<string, Severity>): string[] {
  const sums = totals(baselineCounts)
  return Object.entries(severities)
    .filter(([rule, severity]) => severity === 'warn' && (sums[rule] ?? 0) === 0)
    .map(([rule]) => rule)
    .sort()
}

export function buildBaseline(counts: Counts, severities: Record<string, Severity>): Baseline {
  const sums = totals(counts)
  return {
    description:
      'UI token lint ratchet (UI-A2, #1568). Generated by `bun run lint:ui-tokens:update`; per-file counts may only go down. A rule at 0 must be an error.',
    rules: Object.fromEntries(
      Object.keys(severities).sort().map((rule) => [rule, { severity: severities[rule]!, total: sums[rule] ?? 0 }]),
    ),
    files: sortCounts(counts),
  }
}

export function mergeMax(a: Counts, b: Counts): Counts {
  const merged: Counts = {}
  for (const source of [a, b]) {
    for (const [file, rules] of Object.entries(source)) {
      for (const [rule, count] of Object.entries(rules)) {
        const perFile = (merged[file] ??= {})
        perFile[rule] = Math.max(perFile[rule] ?? 0, count)
      }
    }
  }
  return sortCounts(merged)
}

export function readBaseline(file: string): Baseline {
  if (!existsSync(file)) return { description: '', rules: {}, files: {} }
  return JSON.parse(readFileSync(file, 'utf8')) as Baseline
}

export function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function formatComparison(comparison: Comparison): string[] {
  return comparison.increases.map(
    ({ file, rule, baseline, current }) => `  ${file}: ${rule} ${baseline} -> ${current} (+${current - baseline})`,
  )
}

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function main(argv: string[]) {
  const root = resolve(argValue(argv, '--root') ?? SCRIPT_ROOT)
  const baselinePath = resolve(root, argValue(argv, '--baseline') ?? DEFAULT_BASELINE)
  const printPath = argValue(argv, '--print')
  const update = argv.includes('--update')
  const severities = ruleSeverities(root)

  const targetsArg = argValue(argv, '--targets')
  const targets = targetsArg ? targetsArg.split(',').map((target) => target.trim()).filter(Boolean) : undefined
  const partial = Boolean(targets)

  const started = Date.now()
  const current = await collectCounts(root, targets ? { eslintTargets: targets, cssTargets: targets } : {})
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  if (printPath) {
    writeJson(resolve(printPath), current)
    console.log(`lint-baseline: wrote current counts for ${Object.keys(current).length} files to ${printPath} (${elapsed}s)`)
    return 0
  }

  const baseline = readBaseline(baselinePath)
  const comparison = compareCounts(baseline.files, current)

  if (update) {
    const initial = !existsSync(baselinePath)
    if (comparison.increases.length && !initial && !argv.includes('--allow-increase')) {
      console.error('lint-baseline: refusing to record growth (pass --allow-increase only for an owner-approved exception):')
      console.error(formatComparison(comparison).join('\n'))
      return 1
    }
    const mergePath = argValue(argv, '--merge')
    const next = mergePath ? mergeMax(current, JSON.parse(readFileSync(resolve(mergePath), 'utf8'))) : current
    writeJson(baselinePath, buildBaseline(next, severities))
    const flips = partial ? [] : rulesToFlip(next, severities)
    console.log(`lint-baseline: wrote ${relative(root, baselinePath)} (${Object.keys(next).length} files, ${elapsed}s)`)
    for (const [rule, total] of Object.entries(totals(next)).sort()) console.log(`  ${rule}: ${total}`)
    if (flips.length) console.log(`lint-baseline: at 0, flip to error: ${flips.join(', ')}`)
    return 0
  }

  // --check
  let failed = false
  if (comparison.increases.length) {
    failed = true
    console.error('lint-baseline: UI token lint counts grew (per rule, per file counts may only go down):')
    console.error(formatComparison(comparison).join('\n'))
    console.error('Fix the new violations (see `bun x eslint <file>` / `bun x stylelint <file>`), or get an owner-approved exception.')
  }
  const flips = partial ? [] : rulesToFlip(baseline.files, severities)
  if (flips.length) {
    failed = true
    console.error(`lint-baseline: these rules are at 0 and must be flipped to 'error': ${flips.join(', ')}`)
    console.error('  ESLint: apps/electron/eslint-rules/ui-tokens.cjs; stylelint: .stylelintrc.cjs (severity: "error").')
  }
  const stale = partial ? [] : Object.keys(severities).filter((rule) => (baseline.rules[rule]?.severity ?? severities[rule]) !== severities[rule])
  if (stale.length) {
    failed = true
    console.error(`lint-baseline: severities changed since the baseline was written (${stale.join(', ')}); run --update.`)
  }
  if (comparison.decreases.length) {
    const saved = comparison.decreases.reduce((sum, entry) => sum + entry.baseline - entry.current, 0)
    console.log(`lint-baseline: ${saved} fewer violations than the baseline; run \`bun run lint:ui-tokens:update\` to lock them in.`)
  }
  if (!failed) {
    const sums = totals(current)
    const total = Object.values(sums).reduce((sum, count) => sum + count, 0)
    console.log(`lint-baseline: OK — ${total} baselined violations across ${Object.keys(current).length} files, none new (${elapsed}s).`)
  }
  return failed ? 1 : 0
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error)
      process.exit(2)
    },
  )
}

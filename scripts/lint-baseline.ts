#!/usr/bin/env bun
/**
 * lint-baseline.ts — UI token lint ratchet (UI-A2, #1568; UI-AUDIT §8).
 *
 * Runs the rox/* ESLint rules (apps/electron/eslint-rules/ui-tokens.cjs) over the UI sources and
 * stylelint (.stylelintrc.cjs) over the UI CSS, then compares per-rule, per-file counts with
 * eslint-baselines/ui-tokens.json. See eslint-baselines/README.md for the procedures.
 *
 *   bun scripts/lint-baseline.ts                    # --check: fail if any (file, rule) count grew,
 *                                                   #   or a rule at 0 is still a warning
 *   bun scripts/lint-baseline.ts --base origin/main # also: renames carry their counts, and the
 *                                                   #   committed baseline may not grow vs the base
 *                                                   #   branch's baseline (CI on pull_request)
 *   bun scripts/lint-baseline.ts --update           # rewrite the baseline; refuses to record growth
 *   bun scripts/lint-baseline.ts --print <out.json> # write current counts, compare nothing
 *
 * Options:
 *   --baseline <file>            baseline path (default eslint-baselines/ui-tokens.json)
 *   --root <dir>                 repository root (default: this script's parent)
 *   --base <ref>                 base branch ref: rename map (`git diff -M --name-status <ref>`) and
 *                                the base baseline (`git show <ref>:eslint-baselines/ui-tokens.json`)
 *   --override                   (or UI_BASELINE_OVERRIDE=1) report base-baseline growth without
 *                                failing; CI sets it for PRs labelled `ui-baseline-override`
 *   --allow-increase <file>...   with --update: record growth for exactly these files (owner-approved)
 *   --merge <counts.json>        with --update, repeatable: per-file max with counts from another
 *                                tree (a --print run on the merge result with main / other UI PRs);
 *                                growth it brings in needs --allow-increase like any other
 *   --targets <a,b>              lint only these directories. A partial run skips the whole-repo
 *                                checks (flip-to-error at 0, severity drift). With --update on the
 *                                default baseline it needs --prefix-merge.
 *   --prefix-merge               with --update --targets: replace only the targeted prefixes in the
 *                                existing baseline, keep every other file
 *
 * Counting:
 *   - Every message of a gated rule counts once. Tests and fixtures are excluded.
 *   - Inline config is ignored while counting (eslint noInlineConfig, stylelint ignoreDisables), so
 *     a disable comment never hides a violation. The one exemption: a next-line or same-line
 *     directive that names the rule and carries a non-empty `-- justification`. File-wide, block,
 *     bare (no rule) and reason-less disables still count.
 *   - Ungated rules / messageIds (ui-tokens.cjs UNGATED: no compliant fix exists yet) warn in
 *     editors and are reported here, but are outside the growth gate. TODO(#1569, #1592).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
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
  ungated?: Record<string, { until: string; messageIds: string[] | null; total: number }>
  files: Counts
}

export interface Change {
  file: string
  rule: string
  baseline: number
  current: number
}

export interface Comparison {
  increases: Change[]
  decreases: Change[]
}

export interface Rename {
  from: string
  to: string
}

export interface LintCollection {
  /** Gated counts: what the ratchet compares. */
  counts: Counts
  /** Ungated counts (editor warnings without a compliant fix yet). */
  ungated: Counts
  /** Violations exempted by a justified next-line/line directive, per file and rule. */
  exempt: Counts
}

interface UiTokensModule {
  plugin: { rules: Record<string, unknown> }
  rules: Record<string, Linter.RuleEntry>
  Z_INDEX_V1: Linter.RuleEntry
  TEST_FILES: string[]
  UNGATED: Record<string, { messageIds: string[] | null; until: string }>
  isUngated(ruleId: string, messageId?: string): boolean
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

function eslintRuleEntries(uiTokens: UiTokensModule): Record<string, Linter.RuleEntry> {
  return { ...uiTokens.rules, 'craft-styles/no-hardcoded-z-index': uiTokens.Z_INDEX_V1 }
}

/**
 * Severity of every gated rule: ESLint from ui-tokens.cjs, stylelint from .stylelintrc.cjs.
 * Rules that are wholly ungated are not listed (their gate starts when the fix lands).
 */
export function ruleSeverities(root: string): Record<string, Severity> {
  const uiTokens = loadUiTokens(root)
  const severities: Record<string, Severity> = {}
  for (const [rule, entry] of Object.entries(eslintRuleEntries(uiTokens))) {
    const severity = severityOf(entry)
    if (severity === 'off') continue
    if (uiTokens.UNGATED[rule]?.messageIds === null) continue
    severities[rule] = severity
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
      // Directives never hide a violation from the count; justified next-line directives are
      // exempted afterwards by justifiedDirectives().
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
      plugins: {
        rox: uiTokens.plugin as never,
        'craft-styles': { rules: { 'no-hardcoded-z-index': zIndexRule } },
      },
      rules: eslintRuleEntries(uiTokens),
    },
  ]
}

function add(counts: Counts, file: string, rule: string, by = 1) {
  const perFile = (counts[file] ??= {})
  perFile[rule] = (perFile[rule] ?? 0) + by
}

function lineOf(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) if (source.charCodeAt(i) === 10) line += 1
  return line
}

/**
 * `${line}:${rule}` keys exempted by a justified next-line / same-line directive.
 * `tool` is 'eslint' or 'stylelint'. Only directives that name the rule and carry a non-empty
 * `-- justification` qualify; anything else (file-wide, block, bare, reason-less) does not.
 */
export function justifiedDirectives(source: string, tool: 'eslint' | 'stylelint'): Set<string> {
  const exempt = new Set<string>()
  const patterns = [
    new RegExp(`/\\*\\s*${tool}-disable-(next-line|line)\\b([\\s\\S]*?)\\*/`, 'g'),
    ...(tool === 'eslint' ? [new RegExp(`//[ \\t]*${tool}-disable-(next-line|line)\\b([^\\n]*)`, 'g')] : []),
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const [whole, kind, body = ''] = match
      const start = match.index ?? 0
      const separator = /\s-{2,}\s/.exec(` ${body} `)
      if (!separator) continue
      const padded = ` ${body} `
      const rulesPart = padded.slice(0, separator.index)
      const justification = padded.slice(separator.index + separator[0].length).trim()
      if (!justification) continue
      const ruleNames = rulesPart.split(',').map((rule) => rule.trim()).filter(Boolean)
      if (!ruleNames.length) continue
      const target = kind === 'next-line' ? lineOf(source, start + whole.length) + 1 : lineOf(source, start)
      for (const rule of ruleNames) exempt.add(`${target}:${rule}`)
    }
  }
  return exempt
}

/**
 * Lint the given trees: gated, ungated and exempted counts per file and rule
 * (paths relative to root, POSIX). Targets are directories relative to root.
 */
export async function collectLint(
  root: string,
  { eslintTargets = ESLINT_TARGETS, cssTargets = CSS_TARGETS }: { eslintTargets?: string[]; cssTargets?: string[] } = {},
): Promise<LintCollection> {
  const counts: Counts = {}
  const ungated: Counts = {}
  const exempt: Counts = {}
  const uiTokens = loadUiTokens(root)
  const severities = ruleSeverities(root)
  const eslintRules = new Set(Object.keys(eslintRuleEntries(uiTokens)))
  const toKey = (file: string) => relative(root, file).split('\\').join('/')
  const directiveCache = new Map<string, Set<string>>()
  const directivesFor = (file: string, tool: 'eslint' | 'stylelint') => {
    let found = directiveCache.get(file)
    if (!found) {
      found = justifiedDirectives(readFileSync(file, 'utf8'), tool)
      directiveCache.set(file, found)
    }
    return found
  }

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
      const file = toKey(result.filePath)
      for (const message of result.messages) {
        if (message.fatal) throw new Error(`ESLint could not parse ${file}: ${message.message}`)
        const rule = message.ruleId
        if (!rule || !eslintRules.has(rule)) continue
        if (uiTokens.isUngated(rule, message.messageId)) {
          add(ungated, file, rule)
          continue
        }
        if (!(rule in severities)) continue
        if (directivesFor(result.filePath, 'eslint').has(`${message.line}:${rule}`)) {
          add(exempt, file, rule)
          continue
        }
        add(counts, file, rule)
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
      // Same as noInlineConfig: disable comments are counted, justified ones exempted below.
      ignoreDisables: true,
    })
    for (const result of results) {
      const source = result.source ?? ''
      const file = toKey(source)
      for (const parseError of result.parseErrors ?? []) {
        throw new Error(`stylelint could not parse ${file}: ${JSON.stringify(parseError)}`)
      }
      for (const warning of result.warnings) {
        // Also raised for inconsistent disable comments ("All rules have already been disabled"):
        // stylelint then reports nothing else for the file, so it must fail rather than pass.
        if (warning.rule === 'CssSyntaxError') throw new Error(`stylelint could not process ${file}: ${warning.text}`)
        const rule = `${STYLELINT_PREFIX}${warning.rule}`
        if (!(rule in severities)) continue
        if (directivesFor(source, 'stylelint').has(`${warning.line}:${warning.rule}`)) {
          add(exempt, file, rule)
          continue
        }
        add(counts, file, rule)
      }
    }
  }
  return { counts: sortCounts(counts), ungated: sortCounts(ungated), exempt: sortCounts(exempt) }
}

/** Gated counts only (see collectLint). */
export async function collectCounts(
  root: string,
  options: { eslintTargets?: string[]; cssTargets?: string[] } = {},
): Promise<Counts> {
  return (await collectLint(root, options)).counts
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

/** Parse `git diff -M --name-status -z` output into renames. */
export function parseRenames(nameStatusZ: string): Rename[] {
  const fields = nameStatusZ.split('\0').filter((field) => field.length > 0)
  const renames: Rename[] = []
  for (let i = 0; i < fields.length; ) {
    const status = fields[i]!
    if (/^[RC]\d*$/.test(status)) {
      if (status.startsWith('R')) renames.push({ from: fields[i + 1]!, to: fields[i + 2]! })
      i += 3
    } else {
      i += 2
    }
  }
  return renames
}

/** Renames between `base` and the working tree, via `git diff -M --name-status <base>`. */
export function gitRenames(root: string, base: string): Rename[] {
  const result = spawnSync('git', ['diff', '-M', '--name-status', '-z', base, '--'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git diff -M --name-status ${base} failed: ${result.stderr}`)
  return parseRenames(result.stdout)
}

/** Move counts along renames (old path -> new path), so a move is not growth. */
export function applyRenames(counts: Counts, renames: Rename[]): Counts {
  const moved: Counts = JSON.parse(JSON.stringify(counts))
  for (const { from, to } of renames) {
    const rules = moved[from]
    if (!rules) continue
    delete moved[from]
    for (const [rule, count] of Object.entries(rules)) add(moved, to, rule, count)
  }
  return sortCounts(moved)
}

/** Rules whose baseline total is 0 must be errors: the "flip to error at 0" step of the ratchet. */
export function rulesToFlip(baselineCounts: Counts, severities: Record<string, Severity>): string[] {
  const sums = totals(baselineCounts)
  return Object.entries(severities)
    .filter(([rule, severity]) => severity === 'warn' && (sums[rule] ?? 0) === 0)
    .map(([rule]) => rule)
    .sort()
}

/**
 * The committed baseline versus the base branch's baseline: a PR may not raise any
 * (file, rule) count (renames carry their counts) or weaken a rule (error -> warn, or drop it).
 */
export function compareWithBase(base: Baseline, head: Baseline, renames: Rename[] = []) {
  const { increases } = compareCounts(applyRenames(base.files, renames), head.files)
  const weakened: Array<{ rule: string; from: Severity; to: Severity | 'removed' }> = []
  for (const [rule, entry] of Object.entries(base.rules ?? {})) {
    const now = head.rules?.[rule]?.severity
    if (!now) weakened.push({ rule, from: entry.severity, to: 'removed' })
    else if (entry.severity === 'error' && now === 'warn') weakened.push({ rule, from: 'error', to: 'warn' })
  }
  return { increases, weakened }
}

export function buildBaseline(
  counts: Counts,
  severities: Record<string, Severity>,
  ungated: Baseline['ungated'] = undefined,
): Baseline {
  const sums = totals(counts)
  const baseline: Baseline = {
    description:
      'UI token lint ratchet (UI-A2, #1568). Generated by `bun run lint:ui-tokens:update`; per-file counts may only go down. A rule at 0 must be an error. See eslint-baselines/README.md.',
    rules: Object.fromEntries(
      Object.keys(severities).sort().map((rule) => [rule, { severity: severities[rule]!, total: sums[rule] ?? 0 }]),
    ),
    files: sortCounts(counts),
  }
  if (ungated) baseline.ungated = ungated
  return baseline
}

function ungatedSummary(root: string, ungated: Counts): Baseline['ungated'] {
  const uiTokens = loadUiTokens(root)
  const sums = totals(ungated)
  return Object.fromEntries(
    Object.entries(uiTokens.UNGATED).sort().map(([rule, entry]) => [
      rule,
      { until: entry.until, messageIds: entry.messageIds, total: sums[rule] ?? 0 },
    ]),
  )
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

function underPrefix(file: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    const normalized = prefix.replace(/\/+$/, '')
    return file === normalized || file.startsWith(`${normalized}/`)
  })
}

/** Keep the existing baseline outside `prefixes`; take `current` inside them. */
export function mergePrefixes(existing: Counts, current: Counts, prefixes: string[]): Counts {
  const merged: Counts = {}
  for (const [file, rules] of Object.entries(existing)) if (!underPrefix(file, prefixes)) merged[file] = { ...rules }
  for (const [file, rules] of Object.entries(current)) if (underPrefix(file, prefixes)) merged[file] = { ...rules }
  return sortCounts(merged)
}

export function restrictToPrefixes(counts: Counts, prefixes: string[]): Counts {
  return Object.fromEntries(Object.entries(counts).filter(([file]) => underPrefix(file, prefixes)))
}

export function readBaseline(file: string): Baseline {
  if (!existsSync(file)) return { description: '', rules: {}, files: {} }
  return JSON.parse(readFileSync(file, 'utf8')) as Baseline
}

/** The base branch's baseline (`git show <ref>:<path>`), or null when the base has none yet. */
export function readBaseBaseline(root: string, ref: string, path = DEFAULT_BASELINE): Baseline | null {
  const result = spawnSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) {
    const verify = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' })
    if (verify.status !== 0) throw new Error(`base ref ${ref} is not available (fetch it first)`)
    return null
  }
  return JSON.parse(result.stdout) as Baseline
}

export function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function formatChanges(changes: Change[]): string[] {
  return changes.map(({ file, rule, baseline, current }) => `  ${file}: ${rule} ${baseline} -> ${current} (+${current - baseline})`)
}

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

/** Values after `name` up to the next `--flag`. */
function argList(args: string[], name: string): string[] | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const values: string[] = []
  for (let i = index + 1; i < args.length && !args[i]!.startsWith('--'); i += 1) values.push(args[i]!)
  return values
}

/** Every value of a repeatable `name <value>` option. */
function argAll(args: string[], name: string): string[] {
  return args.flatMap((arg, index) => (arg === name && index + 1 < args.length ? [args[index + 1]!] : []))
}

/** A file argument as a root-relative path (accepts cwd-relative, absolute or root-relative). */
function rootRelative(root: string, file: string): string {
  const fromCwd = resolve(file)
  if (existsSync(fromCwd) && fromCwd.startsWith(`${root}/`)) return relative(root, fromCwd)
  return file.replace(/^\.\//, '')
}

export async function main(argv: string[], env: Record<string, string | undefined> = process.env): Promise<number> {
  const root = resolve(argValue(argv, '--root') ?? SCRIPT_ROOT)
  const baselineArg = argValue(argv, '--baseline')
  const baselinePath = resolve(root, baselineArg ?? DEFAULT_BASELINE)
  const isDefaultBaseline = baselinePath === resolve(root, DEFAULT_BASELINE)
  const printPath = argValue(argv, '--print')
  const update = argv.includes('--update')
  const baseRef = argValue(argv, '--base')
  const override = argv.includes('--override') || env.UI_BASELINE_OVERRIDE === '1'
  const prefixMerge = argv.includes('--prefix-merge')
  const allowIncrease = argList(argv, '--allow-increase')
  const severities = ruleSeverities(root)

  const targetsArg = argValue(argv, '--targets')
  const targets = targetsArg ? targetsArg.split(',').map((target) => target.trim().replace(/\/+$/, '')).filter(Boolean) : undefined
  const partial = Boolean(targets)

  if (update && partial && isDefaultBaseline && !prefixMerge) {
    console.error(
      `lint-baseline: refusing --update --targets on ${DEFAULT_BASELINE}: it would drop every other file. ` +
        'Add --prefix-merge to replace only the targeted prefixes.',
    )
    return 1
  }
  if (prefixMerge && !partial) {
    console.error('lint-baseline: --prefix-merge needs --targets')
    return 1
  }
  if (allowIncrease && allowIncrease.length === 0) {
    console.error('lint-baseline: --allow-increase needs the files it applies to: --allow-increase <file>...')
    return 1
  }

  const started = Date.now()
  const lint = await collectLint(root, targets ? { eslintTargets: targets, cssTargets: targets } : {})
  const current = lint.counts
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  const exemptTotal = Object.values(totals(lint.exempt)).reduce((sum, count) => sum + count, 0)
  const ungatedTotals = totals(lint.ungated)

  if (printPath) {
    writeJson(resolve(printPath), current)
    console.log(`lint-baseline: wrote current counts for ${Object.keys(current).length} files to ${printPath} (${elapsed}s)`)
    return 0
  }

  const renames = baseRef ? gitRenames(root, baseRef) : []
  const baseline = readBaseline(baselinePath)
  // A PR that moves a file without rebaselining keeps the old path in the committed baseline:
  // carry those counts to the new path (a no-op once the baseline uses the new path).
  const baselineFiles = applyRenames(baseline.files, renames)

  if (update) {
    const initial = !existsSync(baselinePath)
    let next = partial && prefixMerge ? mergePrefixes(baselineFiles, current, targets!) : current
    for (const mergePath of argAll(argv, '--merge')) {
      next = mergeMax(next, JSON.parse(readFileSync(resolve(mergePath), 'utf8')) as Counts)
    }
    // Growth is judged on what would be written (current counts plus any --merge'd trees).
    const comparison = compareCounts(baselineFiles, next)
    const allowed = new Set((allowIncrease ?? []).map((file) => rootRelative(root, file)))
    const refused = comparison.increases.filter((change) => !allowed.has(change.file))
    if (refused.length && !initial) {
      console.error('lint-baseline: refusing to record growth (name owner-approved files with --allow-increase <file>...):')
      console.error(formatChanges(refused).join('\n'))
      return 1
    }
    const ungated = partial ? baseline.ungated : ungatedSummary(root, lint.ungated)
    writeJson(baselinePath, buildBaseline(next, severities, ungated))
    const flips = partial ? [] : rulesToFlip(next, severities)
    console.log(`lint-baseline: wrote ${relative(root, baselinePath)} (${Object.keys(next).length} files, ${elapsed}s)`)
    for (const [rule, total] of Object.entries(totals(next)).sort()) console.log(`  ${rule}: ${total}`)
    for (const [rule, total] of Object.entries(ungatedTotals).sort()) console.log(`  (ungated) ${rule}: ${total}`)
    if (flips.length) console.log(`lint-baseline: at 0, flip to error: ${flips.join(', ')}`)
    return 0
  }

  // --check
  let failed = false
  const comparison = compareCounts(baselineFiles, current)
  if (comparison.increases.length) {
    failed = true
    console.error('lint-baseline: UI token lint counts grew (per rule, per file counts may only go down):')
    console.error(formatChanges(comparison.increases).join('\n'))
    console.error(
      'Fix the new violations (`bun x eslint <file>` / `bun x stylelint <file>`), or add a justified ' +
        '`// eslint-disable-next-line <rule> -- reason`. See eslint-baselines/README.md.',
    )
  }
  if (!partial) {
    const flips = rulesToFlip(baselineFiles, severities)
    if (flips.length) {
      failed = true
      console.error(`lint-baseline: these rules are at 0 and must be flipped to 'error': ${flips.join(', ')}`)
      console.error('  ESLint: apps/electron/eslint-rules/ui-tokens.cjs; stylelint: .stylelintrc.cjs (severity: "error").')
    }
    const stale = Object.keys(severities).filter((rule) => baseline.rules[rule]?.severity !== severities[rule])
    const dropped = Object.keys(baseline.rules).filter((rule) => !(rule in severities))
    if (stale.length || dropped.length) {
      failed = true
      console.error(`lint-baseline: rule set or severities differ from the baseline (${[...stale, ...dropped].join(', ')}); run --update.`)
    }
  }
  if (baseRef && isDefaultBaseline) {
    const base = readBaseBaseline(root, baseRef)
    if (!base) {
      console.log(`lint-baseline: ${baseRef} has no ${DEFAULT_BASELINE} yet; skipping the base-baseline comparison.`)
    } else {
      const { increases, weakened } = compareWithBase(base, baseline, renames)
      if (increases.length || weakened.length) {
        const header = override
          ? 'lint-baseline: override (ui-baseline-override): the baseline grows versus the base branch:'
          : `lint-baseline: ${DEFAULT_BASELINE} grows versus ${baseRef} (needs the ui-baseline-override label):`
        ;(override ? console.log : console.error)(header)
        const lines = [
          ...formatChanges(increases),
          ...weakened.map(({ rule, from, to }) => `  ${rule}: severity ${from} -> ${to}`),
        ]
        ;(override ? console.log : console.error)(lines.join('\n'))
        if (!override) failed = true
      }
    }
  }
  if (renames.length) console.log(`lint-baseline: ${renames.length} renames vs ${baseRef} carry their counts.`)
  if (exemptTotal) console.log(`lint-baseline: ${exemptTotal} violations exempted by justified next-line directives.`)
  for (const [rule, total] of Object.entries(ungatedTotals).sort()) {
    const until = loadUiTokens(root).UNGATED[rule]?.until ?? ''
    console.log(`lint-baseline: ungated ${rule}: ${total} (editor warning only until ${until})`)
  }
  if (comparison.decreases.length) {
    const saved = comparison.decreases.reduce((sum, entry) => sum + entry.baseline - entry.current, 0)
    console.log(`lint-baseline: ${saved} fewer violations than the baseline; lock them in with \`--update\` (merging in-flight UI trees: eslint-baselines/README.md).`)
  }
  if (!failed) {
    const total = Object.values(totals(current)).reduce((sum, count) => sum + count, 0)
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

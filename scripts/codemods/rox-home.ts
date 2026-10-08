#!/usr/bin/env bun
/**
 * W1-13 (#1510) codemod: hidden `~/.rox` → visible `~/rox`.
 *
 * Driven by `rox-home.manifest.json` (TECH-SPEC §10.2). Two transforms:
 * - `ast` (.ts): replacements apply ONLY inside string literals and
 *   comments (TypeScript compiler API). Code structure is never rewritten,
 *   so mechanical comment/path updates cannot change behavior.
 * - `text` (docs, tests, shell): plain replacement, for files whose whole
 *   content is prose or shell.
 *
 * `manual` entries verify post-state markers only. `frozenHistory` files
 * are dated evidence and are never rewritten.
 *
 * Usage:
 *   bun run scripts/codemods/rox-home.ts --check    # exit 1 when work remains
 *   bun run scripts/codemods/rox-home.ts --write    # apply, print changed files
 *
 * Only paths listed in the manifest, resolved under the repo root, are
 * touched. `--write` never runs against the real home directory.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

interface ManifestRule {
  from: string
  to: string
}

interface ManifestEntry {
  path: string
  mode: 'ast' | 'text' | 'manual'
  rules?: ManifestRule[]
  markers?: string[]
}

interface Manifest {
  files: ManifestEntry[]
  frozenHistory: string[]
}

const MANIFEST_PATH = join(import.meta.dir, 'rox-home.manifest.json')

function repoRoot(): string {
  const root = resolve(join(import.meta.dir, '..', '..'))
  if (!existsSync(join(root, '.git')) || !existsSync(join(root, 'package.json'))) {
    throw new Error(`Codemod must run from the repo checkout (bad root: ${root})`)
  }
  return root
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest
}

function loadTypeScript(): typeof import('typescript') {
  const require = createRequire(join(import.meta.dir, 'rox-home.ts'))
  try {
    return require('typescript') as typeof import('typescript')
  } catch {
    throw new Error('TypeScript compiler API is required for ast mode (devDependency `typescript`)')
  }
}

interface Span {
  start: number
  end: number
}

/** Comment + string-literal spans of a TS source (AST-scoped replacement). */
function replaceableSpans(ts: typeof import('typescript'), source: string): Span[] {
  const spans: Span[] = []
  const file = ts.createSourceFile('codemod.ts', source, ts.ScriptTarget.Latest, true)
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      spans.push({ start: node.getStart(file) + 1, end: node.getEnd() - 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  // Comments: line + block, via the scanner over the full text.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source)
  let token = scanner.scan()
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      spans.push({ start: scanner.getTokenStart(), end: scanner.getTextPos() })
    }
    token = scanner.scan()
  }
  return spans.sort((a, b) => a.start - b.start)
}

function applyAstRules(
  ts: typeof import('typescript'),
  source: string,
  rules: ManifestRule[],
): { text: string; applied: string[] } {
  let text = source
  const applied: string[] = []
  for (const rule of rules) {
    // One match at a time with fresh spans: replacements stay inside the
    // same comment/string scope, and coordinates never go stale.
    // Out-of-scope (code-position) matches are skipped, never rewritten.
    let cursor = 0
    for (;;) {
      const spans = replaceableSpans(ts, text)
      const at = text.indexOf(rule.from, cursor)
      if (at === -1) break
      const ok = spans.some((s) => at >= s.start && at + rule.from.length <= s.end)
      if (!ok) {
        cursor = at + rule.from.length
        continue
      }
      text = text.slice(0, at) + rule.to + text.slice(at + rule.from.length)
      cursor = at + rule.to.length
      if (!applied.includes(rule.from)) applied.push(rule.from)
    }
  }
  return { text, applied }
}

function pendingForEntry(
  ts: typeof import('typescript') | null,
  root: string,
  entry: ManifestEntry,
): string[] {
  const pending: string[] = []
  const full = join(root, entry.path)
  if (!existsSync(full)) return [`missing file: ${entry.path}`]
  const source = readFileSync(full, 'utf8')
  if (entry.mode === 'manual') {
    for (const marker of entry.markers ?? []) {
      if (!source.includes(marker)) pending.push(`${entry.path}: missing marker ${JSON.stringify(marker)}`)
    }
    return pending
  }
  for (const rule of entry.rules ?? []) {
    if (entry.mode === 'ast') {
      if (!ts) throw new Error('TypeScript compiler API is required for ast mode')
      const spans = replaceableSpans(ts, source)
      let cursor = 0
      for (;;) {
        const at = source.indexOf(rule.from, cursor)
        if (at === -1) break
        if (spans.some((s) => at >= s.start && at + rule.from.length <= s.end)) {
          pending.push(`${entry.path}: still contains ${JSON.stringify(rule.from)}`)
          break
        }
        cursor = at + rule.from.length
      }
    } else if (source.includes(rule.from)) {
      pending.push(`${entry.path}: still contains ${JSON.stringify(rule.from)}`)
    }
  }
  return pending
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const check = argv.includes('--check') || !write
  if (!write && !argv.includes('--check')) {
    console.log('Usage: bun run scripts/codemods/rox-home.ts --check|--write')
    process.exit(2)
  }
  const root = repoRoot()
  const manifest = loadManifest()
  const ts = manifest.files.some((f) => f.mode === 'ast') ? loadTypeScript() : null

  // Safety: every manifest path must resolve inside the repo.
  for (const entry of [...manifest.files.map((f) => f.path), ...manifest.frozenHistory]) {
    const full = resolve(join(root, entry))
    if (full !== join(root, entry) || !full.startsWith(root + '/')) {
      throw new Error(`Manifest path escapes the repo: ${entry}`)
    }
  }

  if (check) {
    const pending = manifest.files.flatMap((entry) => pendingForEntry(ts, root, entry))
    if (pending.length > 0) {
      for (const line of pending) console.log(`pending: ${line}`)
      console.log(`${pending.length} pending codemod item(s)`)
      process.exit(1)
    }
    console.log(`rox-home codemod clean (${manifest.files.length} manifest entries)`)
    return
  }

  if (!ts) throw new Error('TypeScript compiler API is required for ast mode')
  const changed: string[] = []
  for (const entry of manifest.files) {
    if (entry.mode === 'manual' || !entry.rules?.length) continue
    const full = join(root, entry.path)
    if (!existsSync(full)) {
      console.log(`skip (missing): ${entry.path}`)
      continue
    }
    const source = readFileSync(full, 'utf8')
    const next =
      entry.mode === 'ast' ? applyAstRules(ts, source, entry.rules).text : splitApply(source, entry.rules)
    if (next !== source) {
      writeFileSync(full, next)
      changed.push(entry.path)
    }
  }
  if (changed.length > 0) {
    for (const file of changed) console.log(`updated: ${file}`)
  }
  console.log(`${changed.length} file(s) updated`)
}

function splitApply(source: string, rules: ManifestRule[]): string {
  let text = source
  for (const rule of rules) text = text.split(rule.from).join(rule.to)
  return text
}

await main()

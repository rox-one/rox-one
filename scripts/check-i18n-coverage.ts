#!/usr/bin/env bun
/**
 * check-i18n-coverage.ts — CI-safe translation key coverage check.
 *
 * Scans TypeScript/TSX source for literal translation keys in bare translation
 * calls, i18n/i18next calls, and i18nKey JSX props, then verifies those keys
 * resolve against the English locale. Test fixtures and generated directories
 * are skipped. Dynamic keys are intentionally skipped because they cannot be
 * proven statically.
 *
 * Pass --all to print every missing key (default truncates to 20).
 */

import { readdirSync, readFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const LOCALES_DIR = resolve(REPO_ROOT, 'packages', 'shared', 'src', 'i18n', 'locales')
const EN_LOCALE_PATH = resolve(LOCALES_DIR, 'en.json')

const SOURCE_ROOTS = ['apps', 'packages', 'scripts']
const IGNORED_DIRS = new Set([
  '.git',
  '.turbo',
  '.vite',
  '__test__',
  '__tests__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playground',
  'registry',
  'release',
  'tests',
])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const TEST_FILE = /\.(?:test|spec)\.[cm]?tsx?$/

type Locale = Record<string, string>
type Reference = {
  kind: 't' | 'i18n.t' | 'i18next.t' | 'Trans'
  key: string
  file: string
  line: number
  column: number
}

function main(): void {
  const en = JSON.parse(readFileSync(EN_LOCALE_PATH, 'utf-8')) as Locale
  const enKeys = new Set(Object.keys(en))

  const sourceFiles = SOURCE_ROOTS.flatMap(root => collectSourceFiles(resolve(REPO_ROOT, root)))
    .sort((a, b) => a.localeCompare(b))
  const references = sourceFiles.flatMap(file => extractReferences(file))
  const missing = references.filter(ref => !hasLocaleKey(ref.key, enKeys))

  if (missing.length === 0) {
    const uniqueKeys = new Set(references.map(ref => ref.key))
    console.log(
      `i18n coverage OK (${references.length} literal references, ${uniqueKeys.size} unique keys, ${enKeys.size} English keys)`,
    )
    return
  }

  const firstByKey = new Map<string, Reference>()
  for (const ref of missing) {
    if (!firstByKey.has(ref.key)) firstByKey.set(ref.key, ref)
  }

  const showAll = process.argv.includes('--all')
  const items = [...firstByKey.values()]
  const limit = showAll ? items.length : Math.min(20, items.length)

  console.error(`i18n coverage check failed: ${firstByKey.size} missing keys`)
  console.error('')
  for (const ref of items.slice(0, limit)) {
    console.error(`${ref.file}:${ref.line}:${ref.column}`)
    console.error(`  ${ref.kind}("${ref.key}")`)
    console.error('')
  }
  if (!showAll && items.length > limit) {
    console.error(`… (truncated to first ${limit}; run with --all to see all)`)
    console.error('')
  }
  console.error(`${missing.length} unresolved literal reference(s).`)
  console.error('Add the keys to packages/shared/src/i18n/locales/en.json and every locale.')
  process.exit(1)
}

function collectSourceFiles(dir: string): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) files.push(...collectSourceFiles(path))
      continue
    }

    if (!entry.isFile()) continue
    if (basename(entry.name).endsWith('.d.ts')) continue
    if (TEST_FILE.test(entry.name)) continue
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue
    files.push(path)
  }

  return files
}

function extractReferences(file: string): Reference[] {
  const source = readFileSync(file, 'utf-8')
  const relFile = relative(REPO_ROOT, file)
  const refs: Reference[] = []

  const patterns: Array<{ kind: Reference['kind']; regex: RegExp }> = [
    { kind: 'i18n.t', regex: /(?<![\w$])i18n\.t\s*\(\s*'((?:\\.|[^'\\])*)'/g },
    { kind: 'i18n.t', regex: /(?<![\w$])i18n\.t\s*\(\s*"((?:\\.|[^"\\])*)"/g },
    { kind: 'i18next.t', regex: /(?<![\w$])i18next\.t\s*\(\s*'((?:\\.|[^'\\])*)'/g },
    { kind: 'i18next.t', regex: /(?<![\w$])i18next\.t\s*\(\s*"((?:\\.|[^"\\])*)"/g },
    { kind: 't', regex: /(?<![\w$.])t\s*\(\s*'((?:\\.|[^'\\])*)'/g },
    { kind: 't', regex: /(?<![\w$.])t\s*\(\s*"((?:\\.|[^"\\])*)"/g },
    { kind: 'Trans', regex: /\bi18nKey\s*=\s*'((?:\\.|[^'\\])*)'/g },
    { kind: 'Trans', regex: /\bi18nKey\s*=\s*"((?:\\.|[^"\\])*)"/g },
  ]

  for (const { kind, regex } of patterns) {
    for (const match of source.matchAll(regex)) {
      const rawKey = match[1]
      if (!rawKey) continue
      const key = unescapeStringLiteral(rawKey)
      const position = lineAndColumn(source, match.index ?? 0)
      refs.push({ kind, key, file: relFile, ...position })
    }
  }

  return refs.sort((a, b) => a.line - b.line || a.column - b.column || a.key.localeCompare(b.key))
}

function hasLocaleKey(key: string, enKeys: Set<string>): boolean {
  if (enKeys.has(key)) return true
  return enKeys.has(`${key}_one`) && enKeys.has(`${key}_other`)
}

function lineAndColumn(source: string, index: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: index - lineStart + 1 }
}

function unescapeStringLiteral(value: string): string {
  return value.replace(/\\(['"\\bfnrtv])/g, (_match, char: string) => {
    switch (char) {
      case 'b': return '\b'
      case 'f': return '\f'
      case 'n': return '\n'
      case 'r': return '\r'
      case 't': return '\t'
      case 'v': return '\v'
      default: return char
    }
  })
}

main()

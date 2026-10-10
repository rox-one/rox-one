#!/usr/bin/env bun
/**
 * check-rovers-strings.ts — no hardcoded user-visible strings in the
 * rovers-facing UI (Rovers Slice A).
 *
 * Every user-visible string in the Rovers surfaces must resolve through the
 * `rovers.*` i18n namespace (contract §6), so this guard scans the rovers UI
 * sources for two shapes of hardcoded copy:
 *
 *   1. JSX text nodes — literal text between a `>` and the next `<`;
 *   2. user-visible JSX attributes written as plain string literals
 *      (`placeholder="…"`, `title="…"`, `aria-label="…"`).
 *
 * Attribute values written as expressions (`placeholder={t('…')}`) and any
 * line that already routes through `t(` / `i18n.t(` are ignored, as are
 * comment lines. Developer-facing string literals in non-JSX positions
 * (log/diagnostic messages, parse reasons) are out of scope.
 *
 * Exits 1 with a file:line report when a violation is found, 0 otherwise.
 * Wired into the local `lint` script only (no CI workflow edits).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')

/** Rovers-facing UI sources: the markdown card and the Rovers renderer section. */
const TARGETS = [
  'packages/ui/src/components/markdown/MarkdownRoversCardBlock.tsx',
  'apps/electron/src/renderer/features/rovers',
  'apps/electron/src/renderer/lib/rovers-client.ts',
]

const SOURCE_EXT = /\.tsx?$/
const TEST_FILE = /\.(?:test|spec)\.[cm]?tsx?$/
const ATTR_RE = /\b(?:placeholder|title|aria-label)\s*=\s*"([^"]*[A-Za-zА-Яа-я][^"]*)"/g
const JSX_TEXT_RE = />[ \t]*([A-Za-zА-Яа-я][A-Za-zА-Яа-я0-9 ,.:;!?«»’'"()/–—-]*)[ \t]*</g
const I18N_LINE = /\b(?:i18n\.t|useTranslation|\bt)\(/

interface Violation {
  file: string
  line: number
  text: string
  kind: 'jsx-text' | 'attribute'
}

function collectFiles(target: string): string[] {
  const abs = resolve(ROOT, target)
  let st
  try {
    st = statSync(abs)
  } catch {
    return []
  }
  if (st.isFile()) return SOURCE_EXT.test(abs) && !TEST_FILE.test(abs) ? [abs] : []
  const out: string[] = []
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...collectFiles(join(relative(ROOT, abs), entry.name)))
      continue
    }
    if (SOURCE_EXT.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push(join(abs, entry.name))
    }
  }
  return out
}

function lineOf(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++
  return line
}

function scanFile(abs: string): Violation[] {
  const source = readFileSync(abs, 'utf-8')
  const file = relative(ROOT, abs)
  const violations: Violation[] = []

  for (const match of source.matchAll(ATTR_RE)) {
    const text = match[1]
    const index = match.index ?? 0
    violations.push({ file, line: lineOf(source, index), text, kind: 'attribute' })
  }

  for (const match of source.matchAll(JSX_TEXT_RE)) {
    const text = match[1].trim()
    if (text.length === 0) continue
    const start = match.index ?? 0
    const end = start + match[0].length
    // Skip TypeScript generics/arrows that look like JSX text: `=> Foo<Bar>`
    // and `<Foo>bar` never have a tag close/expression start right after the
    // text, whereas real JSX children are followed by `</`, `<` + lowercase, or `{`.
    const beforeGt = source[start]
    if (beforeGt !== '>' && beforeGt !== '}') continue
    if (source[start - 1] === '=') continue
    const rest = source.slice(end)
    if (/^<[A-Z]/.test(rest)) continue
    const index = start + match[0].indexOf(match[1])
    const line = lineOf(source, index)
    const lineText = (source.split('\n')[line - 1] ?? '').trim()
    if (lineText.startsWith('//') || lineText.startsWith('*')) continue
    violations.push({ file, line, text, kind: 'jsx-text' })
  }

  return violations
}

function main(): void {
  const files = [...new Set(TARGETS.flatMap(collectFiles))].sort()
  const violations = files.flatMap(scanFile)

  if (violations.length === 0) {
    console.log(`rovers strings OK (${files.length} file(s) scanned, no hardcoded user-visible strings)`)
    return
  }

  console.error('rovers strings check failed: hardcoded user-visible string(s)')
  console.error('')
  for (const v of violations) {
    console.error(`${v.file}:${v.line} (${v.kind})`)
    console.error(`  ${v.text}`)
  }
  console.error('')
  console.error('Route every user-visible string through the `rovers.*` i18n namespace.')
  process.exit(1)
}

main()
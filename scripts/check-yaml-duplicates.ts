#!/usr/bin/env bun
/**
 * Duplicate-YAML-key guard.
 *
 * js-yaml's load() throws on a duplicated mapping key, but Bun.YAML.parse
 * (used by scripts/rx-validate.ts) silently keeps the last one — verified:
 * Bun.YAML.parse('a: 1\na: 2\n') === { a: 2 }. GitHub Actions *rejects* a
 * workflow file whose YAML has a duplicate key, which is how one duplicated
 * `env:` key silently killed a whole workflow
 * (docs/plans/2026-10-08-rox-user-batch.md:555). This script walks a fixed
 * list of hand-maintained YAML files and fails on any duplicate key.
 *
 * Usage:
 *   bun scripts/check-yaml-duplicates.ts              # scan the default targets
 *   bun scripts/check-yaml-duplicates.ts <file>...    # scan explicit files (testing)
 *
 * Exit code: 1 if any duplicate key was found (or the target list matched no
 * files), 0 otherwise. js-yaml stops at the first duplicate in a file, so
 * after fixing one, re-run to reveal the next.
 */
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { load, YAMLException } from 'js-yaml'

const ROOT = process.env.ROX_YAML_ROOT ?? join(import.meta.dir, '..')

/** Fixed, explicit set of hand-maintained YAML locations. */
const TARGET_GLOBS = [
  '.github/workflows/*.yml',
  '.github/workflows/*.yaml',
  'apps/electron/electron-builder.yml',
  'registry/rx-registry.yaml',
  'registry/fragments/*.yaml',
  'deploy/**/*.yml',
  'deploy/**/*.yaml',
  'ops/**/*.yml',
  'ops/**/*.yaml',
  'services/*/docker-compose*.yml',
  'services/*/docker-compose*.yaml',
]

const displayPath = (abs: string): string => {
  const rel = relative(ROOT, abs)
  return rel.startsWith('..') ? abs : rel
}

const targets = new Map<string, string>() // display -> absolute
const explicit = process.argv.slice(2)
if (explicit.length > 0) {
  for (const p of explicit) {
    const abs = resolve(p)
    targets.set(displayPath(abs), abs)
  }
} else {
  for (const pattern of TARGET_GLOBS) {
    for (const rel of new Glob(pattern).scanSync(ROOT)) {
      targets.set(rel, join(ROOT, rel))
    }
  }
}

const sorted = [...targets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

const duplicateKeyOf = (err: YAMLException, text: string): string => {
  const line = text.split('\n')[err.mark.line] ?? ''
  const tail = line.slice(err.mark.column)
  const m = tail.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:\s][^:]*?)\s*:/)
  return m ? m[1].replace(/^['"]|['"]$/g, '') : tail.trim()
}

const offenders: { file: string; key: string; line: number }[] = []
const skipped: { file: string; reason: string }[] = []

for (const [display, abs] of sorted) {
  const text = readFileSync(abs, 'utf8')
  try {
    load(text)
  } catch (err) {
    if (err instanceof YAMLException && /duplicated mapping key/.test(err.message)) {
      offenders.push({ file: display, key: duplicateKeyOf(err, text), line: err.mark.line + 1 })
    } else if (err instanceof YAMLException) {
      skipped.push({ file: display, reason: err.message.split('\n')[0] })
    } else {
      throw err
    }
  }
}

if (sorted.length === 0) {
  console.error('check-yaml-duplicates: no files matched the target list (path list is broken)')
  process.exit(1)
}

for (const s of skipped) console.warn(`skip (not a duplicate-key error): ${s.file}: ${s.reason}`)

if (offenders.length > 0) {
  console.error(`Found duplicate mapping keys in ${offenders.length} file(s):`)
  for (const o of offenders) console.error(`  ${o.file}: duplicated key '${o.key}' (line ${o.line})`)
  process.exit(1)
}

console.log(`check-yaml-duplicates: no duplicate mapping keys in ${sorted.length} files.`)

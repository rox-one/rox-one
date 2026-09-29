/**
 * i18n key coverage guard (audit 2026-09-29).
 *
 * 1. Every literal `t('…')` / `i18n.t('…')` / `i18nKey="…"` key used in the
 *    electron app and packages/ui must exist in en.json AND ru.json.
 * 2. Locale strings must use i18next `{{var}}` interpolation — a single-brace
 *    `{var}` is rendered verbatim (e.g. «{status} · проблем: {count}»).
 *
 * KNOWN_MISSING is a shrink-only baseline for keys owned by in-flight work
 * (Connections / Accounts migration / Messaging). Do not add to it — add the
 * translation instead.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../../../..')
const LOCALES_DIR = join(REPO_ROOT, 'packages/shared/src/i18n/locales')
const SOURCE_ROOTS = ['apps/electron/src', 'packages/ui/src']
const IGNORED_DIRS = new Set(['node_modules', '__tests__', '__test__', 'dist', 'playground', 'tests'])

/** Keys with their own (non-i18next) placeholder syntax, e.g. `{source:GitHub}`. */
const CUSTOM_PLACEHOLDER_PREFIXES = ['hints.']

const KNOWN_MISSING_PREFIXES = [
  'connections.',
  'settings.accounts.migration.',
  'settings.messaging.telegram.access.allowedUsersSubtitleInbox',
]

function loadLocale(lang: string): Record<string, string> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${lang}.json`), 'utf-8'))
}

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (!IGNORED_DIRS.has(name)) collect(path, out)
      continue
    }
    if (!/\.tsx?$/.test(name) || /\.(test|spec)\.tsx?$/.test(name) || name.endsWith('.d.ts')) continue
    out.push(path)
  }
  return out
}

const KEY_PATTERNS = [
  /(?<![\w$.])t\s*\(\s*'([A-Za-z][\w-]*(?:\.[\w-]+)+)'/g,
  /(?<![\w$.])t\s*\(\s*"([A-Za-z][\w-]*(?:\.[\w-]+)+)"/g,
  /(?<![\w$])i18n(?:ext)?\.t\s*\(\s*['"]([A-Za-z][\w-]*(?:\.[\w-]+)+)['"]/g,
  /\bi18nKey\s*=\s*['"]([A-Za-z][\w-]*(?:\.[\w-]+)+)['"]/g,
]

function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  for (const root of SOURCE_ROOTS) {
    for (const file of collect(join(REPO_ROOT, root))) {
      const src = readFileSync(file, 'utf-8')
      for (const re of KEY_PATTERNS) {
        for (const m of src.matchAll(re)) {
          if (!keys.has(m[1]!)) keys.set(m[1]!, file.slice(REPO_ROOT.length + 1))
        }
      }
    }
  }
  return keys
}

function has(locale: Record<string, string>, key: string): boolean {
  return key in locale || (`${key}_one` in locale && `${key}_other` in locale)
}

describe('i18n key coverage', () => {
  const en = loadLocale('en')
  const ru = loadLocale('ru')
  const keys = usedKeys()

  it('finds a meaningful number of literal keys', () => {
    expect(keys.size).toBeGreaterThan(1000)
  })

  for (const [lang, locale] of [['en', en], ['ru', ru]] as const) {
    it(`every literal t() key exists in ${lang}.json`, () => {
      const missing = [...keys.entries()]
        .filter(([key]) => !has(locale, key))
        .filter(([key]) => !KNOWN_MISSING_PREFIXES.some(p => key.startsWith(p)))
        .map(([key, file]) => `${key}  (${file})`)
      expect(missing).toEqual([])
    })
  }
})

describe('i18n interpolation syntax', () => {
  const single = /(?<!\{)\{(\w+)\}(?!\})/
  const files = readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json'))
  for (const file of files) {
    it(`${file} uses {{var}} interpolation, never {var}`, () => {
      const locale = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf-8')) as Record<string, string>
      const bad = Object.entries(locale)
        .filter(([key]) => !CUSTOM_PLACEHOLDER_PREFIXES.some(p => key.startsWith(p)))
        .filter(([, value]) => typeof value === 'string' && single.test(value))
        .map(([key, value]) => `${key}: ${value}`)
      expect(bad).toEqual([])
    })
  }
})

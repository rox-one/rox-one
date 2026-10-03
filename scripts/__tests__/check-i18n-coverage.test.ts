import { afterEach, expect, test } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const checker = resolve(import.meta.dir, '../check-i18n-coverage.ts')
const fixtures: string[] = []
afterEach(() => { for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true }) })

function check(source: string, english: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'i18n-coverage-cli-'))
  fixtures.push(root)
  for (const directory of ['scripts', 'apps', 'packages/shared/src/i18n/locales']) {
    mkdirSync(join(root, directory), { recursive: true })
  }
  const entry = join(root, 'scripts/check-i18n-coverage.ts')
  copyFileSync(checker, entry)
  writeFileSync(join(root, 'apps/fixture.tsx'), source)
  writeFileSync(join(root, 'packages/shared/src/i18n/locales/en.json'), JSON.stringify(english))
  const child = Bun.spawnSync([process.execPath, '--no-env-file', entry, '--all'], {
    cwd: root,
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TMPDIR: tmpdir() },
    stdout: 'pipe', stderr: 'pipe',
  })
  return { exit: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() }
}

test('actual CLI skips concatenated key expressions while detecting completed literal arguments', () => {
  const result = check([
    "t('notes.blocks.diagnostic.' + diagnostic.code)",
    'i18n.t("notes.blocks.diagnostic." + diagnostic.code)',
    "i18next.t('notes.blocks.diagnostic.' + diagnostic.code)",
    "t('known', { count: 1 })",
    'i18n.t("known")',
    "i18next.t('known'   )",
    '<Trans i18nKey="known" />',
  ].join('\n'), { known: 'Known', 'notes.blocks.diagnostic.duplicateId': 'Duplicate block ID' })
  expect(result.exit).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('i18n coverage OK (4 literal references, 1 unique keys, 2 English keys)')
})

test('actual CLI retains missing complete keys and exact source lines for all supported reference forms', () => {
  const result = check([
    "t('missing.bare')",
    'i18n.t("missing.i18n", { count: 2 })',
    "i18next.t('missing.i18next')",
    '<Trans i18nKey="missing.trans" />',
    "t('missing.comment' /* comment */)",
    "i18n.t('missing.cast' as const)",
  ].join('\n'), { known: 'Known' })
  expect(result.exit).toBe(1)
  expect(result.stderr).toContain('6 missing keys')
  for (const [index, key] of ['missing.bare', 'missing.i18n', 'missing.i18next', 'missing.trans', 'missing.comment', 'missing.cast'].entries()) {
    expect(result.stderr).toContain(key)
    expect(result.stderr).toContain(`apps/fixture.tsx:${index + 1}:`)
  }
  expect(result.stdout).toBe('')
})

test('actual CLI preserves escaped literals and plural key resolution', () => {
  const result = check("t('quote\\'key')\ni18next.t('items', { count: 2 })", {
    "quote'key": 'Quoted', items_one: '{{count}} item', items_other: '{{count}} items',
  })
  expect(result.exit).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('2 literal references')
})

test('actual CLI still rejects invalid locale interpolation independently of key coverage', () => {
  const result = check("t('known')", { known: 'Hello {name}' })
  expect(result.exit).toBe(1)
  expect(result.stderr).toContain('i18n interpolation check failed: 1 string(s)')
  expect(result.stdout).toContain('i18n coverage OK')
})

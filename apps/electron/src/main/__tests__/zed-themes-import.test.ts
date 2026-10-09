/**
 * DISPATCH C1 — Zed theme scanner/importer.
 *
 * Fixtures cover both Zed file shapes (family `themes: [...]`, single theme) and
 * a corrupt file. The importer must produce schema-valid ROX presets, resolve
 * transparent surfaces to a solid base, never touch the three reserved ids,
 * suffix a conflicting id with `-2`, and skip unreadable/absent sources.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PresetThemeSchema } from '@rox/shared/config/validators'
import {
  RESERVED_IMPORT_IDS,
  importZedTheme,
  mapZedThemeToRox,
  parseZedThemeFile,
  resolveImportId,
  scanZedThemes,
  slugifyThemeId,
  toSolidColor,
} from '../zed-themes-import'

const fixtures = join(import.meta.dir, 'fixtures/zed-themes')
const fixture = (name: string) => readFileSync(join(fixtures, name), 'utf-8')

let home: string
let themesDir: string
let provenanceDir: string

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'rox-zed-home-'))
  themesDir = mkdtempSync(join(tmpdir(), 'rox-zed-themes-'))
  provenanceDir = mkdtempSync(join(tmpdir(), 'rox-zed-provenance-'))

  const extDir = join(home, 'Library', 'Application Support', 'Zed', 'extensions', 'installed')
  mkdirSync(join(extDir, 'nvim-nightfox', 'themes'), { recursive: true })
  writeFileSync(join(extDir, 'nvim-nightfox', 'themes', 'nvim-nightfox.json'), fixture('nightfox-family.json'))
  mkdirSync(join(extDir, 'blankeos', 'themes'), { recursive: true })
  writeFileSync(join(extDir, 'blankeos', 'themes', 'blankeos.json'), fixture('blankeos-single.json'))

  const userThemes = join(home, '.config', 'zed', 'themes')
  mkdirSync(userThemes, { recursive: true })
  writeFileSync(join(userThemes, 'user.json'), fixture('blankeos-single.json'))
  writeFileSync(join(userThemes, 'broken.json'), fixture('broken.json'))

  // Reserved ids already present in the catalog.
  for (const id of RESERVED_IMPORT_IDS) writeFileSync(join(themesDir, `${id}.json`), '{}')
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(themesDir, { recursive: true, force: true })
  rmSync(provenanceDir, { recursive: true, force: true })
})

describe('parse + scan', () => {
  it('parses both the family and single-theme shapes', () => {
    expect(parseZedThemeFile(JSON.parse(fixture('nightfox-family.json'))).map(t => t.name))
      .toEqual(['Nordfox - opaque', 'Dayfox'])
    expect(parseZedThemeFile(JSON.parse(fixture('blankeos-single.json'))).map(t => t.name))
      .toEqual(['Blankeos Minimal'])
  })

  it('scans extensions + user themes and skips a corrupt file', () => {
    const entries = scanZedThemes({ homeDir: home, themesDir, existingIds: new Set(RESERVED_IMPORT_IDS) })
    const names = entries.map(e => e.name).sort()
    expect(names).toEqual(['Blankeos Minimal', 'Blankeos Minimal', 'Dayfox', 'Nordfox - opaque'])
    const nordfox = entries.find(e => e.name === 'Nordfox - opaque')!
    expect(nordfox.appearance).toBe('dark')
    expect(nordfox.extensionId).toBe('nvim-nightfox')
    expect(nordfox.alreadyImported).toBe(true) // reserved id present
    const user = entries.find(e => e.extensionId === null)!
    expect(user.sourcePath).toContain(join('.config', 'zed', 'themes'))
  })
})

describe('role mapping', () => {
  it('maps a single theme, resolving transparent surfaces to the editor base', () => {
    const theme = parseZedThemeFile(JSON.parse(fixture('blankeos-single.json')))[0]!
    const mapped = mapZedThemeToRox(theme)
    // panel.background was fully transparent → solid editor.background.
    expect(mapped.navigator).toBe('#1a1a1a')
    // element.background carried alpha → solid.
    expect(mapped.input).toBe('#ffffff')
    expect(mapped.background).toBe('#1a1a1a')
    expect(mapped.success).toBe('#6c9c77')
    expect(mapped.destructive).toBe('#f97583')
    // Chrome keeps its source alpha; tabs stay translucent over the panel.
    expect(mapped.toolbar).toBe('#1a1a1acc')
    expect(mapped.tabInactive).toBe('#1a1a1a99')
    expect(mapped.terminalAnsi?.red).toBe('#f97583')
    expect(mapped.supportedModes).toEqual(['dark'])
    expect(PresetThemeSchema.safeParse(mapped).success).toBe(true)
  })

  it('captures player cursor and the syntax palette (dark nightfox)', () => {
    const theme = parseZedThemeFile(JSON.parse(fixture('nightfox-family.json')))[0]!
    const mapped = mapZedThemeToRox(theme)
    expect(mapped.syntax?.comment).toEqual({ color: '#60728a', fontStyle: 'italic' })
    expect(mapped.syntax?.keyword).toEqual({ color: '#b48ead', fontWeight: 700 })
    expect(mapped.textMuted).toBe('#cdcecf')
    expect(PresetThemeSchema.safeParse(mapped).success).toBe(true)
  })

  it('toSolidColor strips alpha but leaves #rgb alone', () => {
    expect(toSolidColor('#aabbccdd')).toBe('#aabbcc')
    expect(toSolidColor('#abc')).toBe('#abc')
    expect(toSolidColor(undefined)).toBeUndefined()
  })

  it('slugifies names into safe preset ids', () => {
    expect(slugifyThemeId('Nordfox - opaque')).toBe('nordfox-opaque')
    expect(slugifyThemeId('  Siri Light  ')).toBe('siri-light')
  })
})

describe('import id resolution', () => {
  it('never rewrites a reserved id that already exists', () => {
    expect(resolveImportId('Nordfox - opaque', new Set(RESERVED_IMPORT_IDS))).toBeNull()
  })

  it('suffixes a conflicting non-reserved id with -2', () => {
    expect(resolveImportId('Blankeos Minimal', new Set(['blankeos-minimal']))).toBe('blankeos-minimal-2')
  })
})

describe('import', () => {
  it('writes a schema-valid preset and a provenance entry', () => {
    const sourcePath = join(home, '.config', 'zed', 'themes', 'user.json')
    const result = importZedTheme({ sourcePath, name: 'Blankeos Minimal' }, { themesDir, provenanceDir })
    expect(result).toEqual({ status: 'imported', id: 'blankeos-minimal' })
    const written = JSON.parse(readFileSync(join(themesDir, 'blankeos-minimal.json'), 'utf-8'))
    expect(PresetThemeSchema.safeParse(written).success).toBe(true)

    const manifest = JSON.parse(readFileSync(join(provenanceDir, 'theme-imports.json'), 'utf-8'))
    expect(Array.isArray(manifest)).toBe(true)
    expect(manifest[0]).toMatchObject({ id: 'blankeos-minimal', sourcePath, sourceTheme: 'Blankeos Minimal' })
    expect(manifest[0].sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('suffixes a repeated import and never overwrites the first file', () => {
    const sourcePath = join(home, '.config', 'zed', 'themes', 'user.json')
    const result = importZedTheme({ sourcePath, name: 'Blankeos Minimal' }, { themesDir })
    expect(result).toEqual({ status: 'imported', id: 'blankeos-minimal-2' })
    expect(existsSync(join(themesDir, 'blankeos-minimal-2.json'))).toBe(true)
  })

  it('skips a reserved id instead of overwriting it', () => {
    const sourcePath = join(home, 'Library', 'Application Support', 'Zed', 'extensions', 'installed', 'nvim-nightfox', 'themes', 'nvim-nightfox.json')
    expect(importZedTheme({ sourcePath, name: 'Nordfox - opaque' }, { themesDir }))
      .toEqual({ status: 'skipped', reason: 'already-imported' })
  })

  it('skips an unreadable/absent source', () => {
    expect(importZedTheme({ sourcePath: join(home, 'missing.json'), name: 'x' }, { themesDir }))
      .toEqual({ status: 'skipped', reason: 'not-found' })
    expect(importZedTheme({ sourcePath: join(home, '.config', 'zed', 'themes', 'broken.json'), name: 'Broken' }, { themesDir }))
      .toEqual({ status: 'skipped', reason: 'not-found' })
  })
})
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const settingsDir = join(import.meta.dir, '..')

function source(file: string): string {
  return readFileSync(join(settingsDir, file), 'utf8')
}

describe('settings select i18n', () => {
  it('does not hardcode Select… placeholders', () => {
    const select = source('SettingsSelect.tsx')
    const menu = source('SettingsMenuSelect.tsx')
    expect(select).not.toContain("'Select...'")
    expect(select).not.toContain('"Select..."')
    expect(menu).not.toContain("'Select...'")
    expect(menu).not.toContain('"Select..."')
    expect(select).toContain("t('common.select')")
    expect(menu).toContain("t('common.select')")
  })

  it('translates empty search results and keeps the chevron at 70% contrast', () => {
    const menu = source('SettingsMenuSelect.tsx')
    expect(menu).toContain("t('common.noResults')")
    expect(menu).not.toContain('No results found')
    expect(menu).toContain('text-foreground/70')
    expect(menu).not.toContain('opacity-50 shrink-0 size-3.5')
  })
})

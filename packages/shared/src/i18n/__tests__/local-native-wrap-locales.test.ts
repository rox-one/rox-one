import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'settings.cloudRuns.providerHint'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-182 leftover local/native wrapping in settings.cloudRuns.providerHint', () => {
  it('wraps leftover local and native to match sibling cloud-run labels in Russian', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe('Daytona — облачный раннер; локальный и нативный sidecar остаются на этой машине')
    expect(ru[KEY]).not.toMatch(/\blocal\b/)
    expect(ru[KEY]).not.toMatch(/\bnative\b/)
    expect(ru[KEY]).toContain('Daytona')
    expect(ru[KEY]).toContain('локальный')
    expect(ru[KEY]).toContain('нативный sidecar')
    expect(ru['settings.cloudRuns.providerLocal']).toBe('Локально (этот компьютер)')
    expect(ru['settings.cloudRuns.providerNative']).toBe('Нативный sidecar (этот компьютер)')
  })

  it('keeps English local and native as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Daytona is the cloud runner; local and native stay on this machine')
    expect(i18n.t(KEY)).toContain('local')
    expect(i18n.t(KEY)).toContain('native')
    expect(i18n.t(KEY)).not.toContain('локальный')
    expect(i18n.t(KEY)).not.toContain('нативный')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('Daytona — облачный раннер; локальный и нативный sidecar остаются на этой машине')
    expect(i18n.t(KEY)).not.toMatch(/\blocal\b/)
    expect(i18n.t(KEY)).not.toMatch(/\bnative\b/)
    expect(i18n.t(KEY)).not.toBe(i18n.t(KEY, { lng: 'en' }))
    expect(i18n.t(KEY)).not.toBe('Daytona is the cloud runner; local and native stay on this machine')
    expect(i18n.t(KEY)).not.toBe('Daytona — облачный раннер; local и native остаются на этой машине')
  })

  it('defines the key in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      expect(locale[KEY]?.length, file).toBeGreaterThan(0)
    }
  })
})

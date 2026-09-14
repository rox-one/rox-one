import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'notes.inspector.frontmatter',
  'entityView.outlineCheckout',
  'entityView.flowLive',
] as const

const EN: Record<(typeof keys)[number], string> = {
  'notes.inspector.frontmatter': 'frontmatter',
  'entityView.outlineCheckout': 'Checkout',
  'entityView.flowLive': 'Live',
}

const RU: Record<(typeof keys)[number], string> = {
  'notes.inspector.frontmatter': 'YAML-шапка',
  'entityView.outlineCheckout': 'Перейти',
  'entityView.flowLive': 'Живой',
}

describe('notes inspector + entityView leftover chrome locales', () => {
  it('keeps Russian copy distinct from English', () => {
    for (const key of keys) {
      expect(en[key], key).toBe(EN[key])
      expect(ru[key], key).toBe(RU[key])
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['notes.inspector.frontmatter']).not.toContain('frontmatter')
    expect(ru['entityView.outlineCheckout']).not.toContain('Checkout')
    expect(ru['entityView.flowLive']).not.toBe('Live')
  })

  it('setupI18n ru is not English; en stays English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(RU[key])
      expect(i18n.t(key)).not.toBe(EN[key])
    }
    expect(i18n.t('notes.inspector.frontmatter')).not.toContain('OMP')
    expect(i18n.t('entityView.outlineCheckout')).not.toContain('Craft Agents')
    expect(i18n.t('entityView.flowLive')).not.toContain('Vercel')

    await setupI18n().changeLanguage('en')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(EN[key])
    }
  })
})

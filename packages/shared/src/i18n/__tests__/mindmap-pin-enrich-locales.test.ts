import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const KEYS = [
  'mindmap.enrichDraftBanner',
  'mindmap.enrichNoWorkspace',
  'mindmap.enrichReady',
  'mindmap.enrichUnavailable',
  'mindmap.keepPin',
] as const

const LEFTOVER = /\b(pin|enrich|outline|workspace)\b/i

describe('P35-122 mindmap pin/enrich leftover wrapping', () => {
  it('Russian copy drops leftover English wrapping', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('mindmap.keepPin')).toBe('Оставить закрепление')
    expect(i18n.t('mindmap.enrichDraftBanner')).toBe(
      'Превью улучшенной карты — принять (закрепить) или отменить.',
    )
    expect(i18n.t('mindmap.enrichNoWorkspace')).toBe(
      'Нет рабочего пространства для улучшения карты',
    )
    expect(i18n.t('mindmap.enrichReady')).toBe('Улучшенная структура готова')
    expect(i18n.t('mindmap.enrichUnavailable')).toBe('Улучшение недоступно')
    expect(i18n.t('mindmap.pinned')).toBe('Закреплено')
    expect(i18n.t('mindmap.pin')).toBe('Закрепить')
    for (const key of KEYS) {
      const value = String(i18n.t(key))
      expect(value, key).not.toMatch(LEFTOVER)
    }
  })

  it('English locale still uses the original wrapping', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('mindmap.keepPin')).toBe('Keep pin')
    expect(i18n.t('mindmap.enrichDraftBanner')).toBe(
      'Preview improved map — accept to pin, or discard.',
    )
    expect(i18n.t('mindmap.enrichNoWorkspace')).toBe('No workspace for enrich')
    expect(i18n.t('mindmap.enrichReady')).toBe('Improved outline ready')
    expect(i18n.t('mindmap.enrichUnavailable')).toBe('Enrich unavailable')
  })
})

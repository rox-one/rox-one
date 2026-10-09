import { describe, test, expect } from 'bun:test'
import { EXTERNAL_IMPORT_NOTICES } from '../external-imports'

describe('external import tiles — honest states', () => {
  test('no importer claims availability this wave', () => {
    expect(EXTERNAL_IMPORT_NOTICES.google.available).toBe(false)
    expect(EXTERNAL_IMPORT_NOTICES.other.available).toBe(false)
  })

  test('each tile points at its own honest i18n copy', () => {
    expect(EXTERNAL_IMPORT_NOTICES.google.titleKey).toBe('drive.notice.google.title')
    expect(EXTERNAL_IMPORT_NOTICES.google.bodyKey).toBe('drive.notice.google.body')
    expect(EXTERNAL_IMPORT_NOTICES.other.titleKey).toBe('drive.notice.other.title')
    expect(EXTERNAL_IMPORT_NOTICES.other.bodyKey).toBe('drive.notice.other.body')
  })

  test('the "other storages" tile names the three wave-2 providers', () => {
    expect(EXTERNAL_IMPORT_NOTICES.other.providers).toEqual(['OneDrive', 'iCloud', 'Яндекс Диск'])
    expect(EXTERNAL_IMPORT_NOTICES.google.providers).toEqual([])
  })
})
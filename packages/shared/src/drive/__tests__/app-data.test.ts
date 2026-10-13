/**
 * R13 — the shared side of the «Данные приложения» section and the 1 ТБ quota.
 *
 * These tests pin the two facts the surface must show: the quota constant is
 * exactly 1 TiB, and the app-data inventory is honest (every entry maps to a
 * real i18n key present in all 12 locales) with no invented statuses.
 */
import { describe, test, expect } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DRIVE_APP_DATA_ENTRIES,
  DRIVE_APP_DATA_STATUS_I18N_KEY,
  DRIVE_DEFAULT_QUOTA_BYTES,
  type DriveAppDataStatus,
} from '../index'

const LOCALES_DIR = join(import.meta.dir, '../../i18n/locales')
const localeFiles = readdirSync(LOCALES_DIR).filter(file => file.endsWith('.json'))
const locales = Object.fromEntries(
  localeFiles.map(file => [file.replace('.json', ''), JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as Record<string, string>]),
)

describe('Drive default quota (R13 «1 ТБ»)', () => {
  test('is exactly one tebibyte', () => {
    expect(DRIVE_DEFAULT_QUOTA_BYTES).toBe(1024 ** 4)
    expect(DRIVE_DEFAULT_QUOTA_BYTES).toBe(1_099_511_627_776)
  })
})

describe('Drive app-data inventory (R13 «все данные приложения»)', () => {
  test('covers the four known data slices exactly once', () => {
    expect(DRIVE_APP_DATA_ENTRIES.map(entry => entry.id)).toEqual([
      'uploads',
      'cloud-imports',
      'device-folders',
      'app-config',
    ])
  })

  test('statuses tell the honest truth: nothing is silently unbacked-up', () => {
    const byId = Object.fromEntries(DRIVE_APP_DATA_ENTRIES.map(entry => [entry.id, entry.status]))
    expect(byId.uploads).toBe('in-drive')
    expect(byId['cloud-imports']).toBe('in-drive')
    expect(byId['device-folders']).toBe('on-demand')
    // The app config directory is mirrored on demand (R13 mirror engine).
    expect(byId['app-config']).toBe('on-demand')
  })

  test('every status has a locale key', () => {
    const statuses: DriveAppDataStatus[] = ['in-drive', 'on-demand', 'not-backed-up']
    for (const status of statuses) expect(DRIVE_APP_DATA_STATUS_I18N_KEY[status]).toBeTruthy()
  })

  test('every entry key and status key exists in all 12 locales', () => {
    const langCount = Object.keys(locales).length
    expect(langCount).toBe(12)
    const keys = [
      ...DRIVE_APP_DATA_ENTRIES.flatMap(entry => [entry.titleKey, entry.detailKey]),
      ...Object.values(DRIVE_APP_DATA_STATUS_I18N_KEY),
      'drive.appData.label',
      'drive.appData.title',
      'drive.appData.subtitle',
      'drive.appData.action.backup',
      'drive.appData.note',
    ]
    for (const [lang, catalog] of Object.entries(locales)) {
      for (const key of keys) {
        expect(catalog[key], `${lang} is missing ${key}`).toBeTruthy()
      }
    }
  })
})
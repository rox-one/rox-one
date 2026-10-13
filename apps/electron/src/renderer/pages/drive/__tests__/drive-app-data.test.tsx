/**
 * R13 surface render tests — «1 ТБ» meter and the «Данные приложения» section.
 *
 * Static markup (react-dom/server) with the shipped RU/EN locale catalogs, so
 * the assertions exercise the real i18n keys the app loads, not test-local
 * stand-ins.
 */
import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { DRIVE_DEFAULT_QUOTA_BYTES } from '@rox/shared/drive'
import { formatBytes } from '../format'
import { DriveQuotaMeter } from '../DriveQuotaMeter'
import { DriveAppDataSection } from '../DriveAppDataSection'

const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')
const locale = (lang: string) =>
  JSON.parse(readFileSync(join(localesDir, `${lang}.json`), 'utf8')) as Record<string, string>

function i18nFor(lang: string) {
  const instance = createInstance()
  void instance.init({
    lng: lang,
    fallbackLng: 'ru',
    resources: { ru: { translation: locale('ru') }, en: { translation: locale('en') } },
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    initAsync: false,
  })
  return instance
}

function render(node: React.ReactNode, lang = 'ru') {
  return renderToStaticMarkup(<I18nextProvider i18n={i18nFor(lang)}>{node}</I18nextProvider>)
}

describe('Drive quota meter («1 ТБ»)', () => {
  it('formats the default quota as 1 ТБ', () => {
    expect(formatBytes(DRIVE_DEFAULT_QUOTA_BYTES, 0)).toBe('1 ТБ')
  })

  it('shows the 1 ТБ title and total even before a quota arrives (RU)', () => {
    const html = render(<DriveQuotaMeter quota={null} />)
    expect(html).toContain('data-testid="drive-quota-meter"')
    expect(html).toContain('data-level="ok"')
    expect(html).toContain('1 ТБ')
    expect(html).toContain('из 1 ТБ доступно')
  })

  it('localizes the figure for EN while the byte units stay canonical', () => {
    const html = render(<DriveQuotaMeter quota={null} />, 'en')
    expect(html).toContain('1 TB')
    expect(html).toContain('of 1 ТБ available')
  })
})

describe('Drive app-data section (R13 «все данные приложения»)', () => {
  it('renders the honest four-slice inventory with data-status attributes', () => {
    const html = render(<DriveAppDataSection onOpenBackup={() => {}} />)
    expect(html).toContain('data-testid="drive-app-data"')
    expect(html).toContain('data-testid="drive-app-data-uploads"')
    expect(html).toContain('data-status="in-drive"')
    expect(html).toContain('data-testid="drive-app-data-device-folders"')
    expect(html).toContain('data-testid="drive-app-data-app-config"')
    // Both on-demand slices: device folders and the app config mirror.
    expect(html).toContain('data-status="on-demand"')
    expect(html).not.toContain('data-status="not-backed-up"')
  })

  it('states honestly that device folders and app config are on demand (RU)', () => {
    const html = render(<DriveAppDataSection onOpenBackup={() => {}} />)
    expect(html).toContain('По требованию')
    expect(html).not.toContain('Не бэкапится')
    expect(html).toContain('Доступно по кнопке')
    expect(html).toContain('автоматически ничего не бэкапится')
    expect(html).toContain('Настроить бэкап устройства')
  })

  it('localizes the section for EN', () => {
    const html = render(<DriveAppDataSection onOpenBackup={() => {}} />, 'en')
    expect(html).toContain('App data')
    expect(html).not.toContain('Not backed up')
    expect(html).toContain('On demand')
    expect(html).toContain('Available on demand')
  })

  it('mounts the app-config mirror card next to that entry', () => {
    const html = render(<DriveAppDataSection onOpenBackup={() => {}} />)
    expect(html).toContain('data-testid="drive-mirror-status"')
    // Before the first status arrives the card claims nothing but "checking".
    expect(html).toContain('data-testid="drive-mirror-state"')
    expect(html).toContain('Проверяем состояние…')
  })
})
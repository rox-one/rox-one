/**
 * R13 — the app-config mirror card (`DriveMirrorStatus`).
 *
 * Two layers:
 *  - static markup of the presentational `DriveMirrorStatusCard` against the
 *    shipped RU/EN catalogs (progress, buttons, honest «unavailable» line);
 *  - a happy-dom mount of the container with a stubbed `drive:mirror*` client,
 *    so the real poll/action effects — including the UNSUPPORTED_OPERATION
 *    mapping — run end-to-end.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { MirrorQueueStatus } from '@rox/shared/drive'
import { useDomForFile as installDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { DriveMirrorStatus, DriveMirrorStatusCard, type DriveMirrorApi, type DriveMirrorView } from '../DriveMirrorStatus'

installDomForFile()

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

function renderStatic(node: React.ReactNode, lang = 'ru') {
  return renderToStaticMarkup(<I18nextProvider i18n={i18nFor(lang)}>{node}</I18nextProvider>)
}

async function renderLive(node: React.ReactNode, lang = 'ru'): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<I18nextProvider i18n={i18nFor(lang)}>{node}</I18nextProvider>)
  })
  return { container, root }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount()
  })
}

afterEach(() => {
  resetDom()
})

const IDLE_STATUS: MirrorQueueStatus = { state: 'idle', filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 }
const RUNNING_STATUS: MirrorQueueStatus = { state: 'running', filesDone: 3, filesTotal: 7, bytesDone: 6 * 1024 * 1024, bytesTotal: 20 * 1024 * 1024 }

const RUNNING_VIEW: DriveMirrorView = { kind: 'ready', status: RUNNING_STATUS, lastResult: null }

const IDLE_VIEW: DriveMirrorView = {
  kind: 'ready',
  status: IDLE_STATUS,
  lastResult: { added: 2, changed: 1, removed: 0, bytesUploaded: 4096, paused: false, cancelled: false, errors: [] },
}

/** A `drive:mirror*` client whose status reflects the actions taken on it. */
function mirrorApi(initial: MirrorQueueStatus): DriveMirrorApi {
  let state = initial
  return {
    driveMirrorStatus: async () => ({ configured: true, status: state }),
    driveMirrorStart: async () => {
      state = { ...state, state: 'running' }
      return { configured: true, started: true, status: state }
    },
    driveMirrorPause: async () => {
      state = { ...state, state: 'paused' }
      return { configured: true, status: state }
    },
    driveMirrorCancel: async () => {
      state = { ...state, state: 'cancelled' }
      return { configured: true, status: state }
    },
  }
}

describe('DriveMirrorStatusCard (presentational)', () => {
  it('renders files/bytes progress and the state label while running (RU)', () => {
    const html = renderStatic(<DriveMirrorStatusCard view={RUNNING_VIEW} busy={false} onStart={() => {}} onPause={() => {}} onCancel={() => {}} />)
    expect(html).toContain('data-testid="drive-mirror-status"')
    expect(html).toContain('data-state="running"')
    expect(html).toContain('Зеркалирование')
    expect(html).toContain('3 из 7 файлов')
    expect(html).toContain('data-testid="drive-mirror-progress"')
  })

  it('disables Старт while running and enables Пауза/Отмена', () => {
    const html = renderStatic(<DriveMirrorStatusCard view={RUNNING_VIEW} busy={false} onStart={() => {}} onPause={() => {}} onCancel={() => {}} />)
    expect(html).toMatch(/data-testid="drive-mirror-start"[^>]*disabled/)
    expect(html).not.toMatch(/data-testid="drive-mirror-pause"[^>]*disabled/)
    expect(html).not.toMatch(/data-testid="drive-mirror-cancel"[^>]*disabled/)
  })

  it('keeps Пауза/Отмена disabled while idle and shows the last run', () => {
    const html = renderStatic(<DriveMirrorStatusCard view={IDLE_VIEW} busy={false} onStart={() => {}} onPause={() => {}} onCancel={() => {}} />)
    expect(html).toContain('data-state="idle"')
    expect(html).toContain('data-testid="drive-mirror-last-result"')
    expect(html).not.toMatch(/data-testid="drive-mirror-start"[^>]*disabled/)
    expect(html).toMatch(/data-testid="drive-mirror-pause"[^>]*disabled/)
    expect(html).toMatch(/data-testid="drive-mirror-cancel"[^>]*disabled/)
  })

  it('states the honest unavailable reason and disables every button', () => {
    const html = renderStatic(<DriveMirrorStatusCard view={{ kind: 'unavailable' }} busy={false} onStart={() => {}} onPause={() => {}} onCancel={() => {}} />)
    expect(html).toContain('data-testid="drive-mirror-unavailable"')
    expect(html).toContain('Зеркалирование недоступно')
    expect(html).toMatch(/data-testid="drive-mirror-start"[^>]*disabled/)
    expect(html).toMatch(/data-testid="drive-mirror-pause"[^>]*disabled/)
    expect(html).toMatch(/data-testid="drive-mirror-cancel"[^>]*disabled/)
  })

  it('localizes the card for EN', () => {
    const html = renderStatic(<DriveMirrorStatusCard view={RUNNING_VIEW} busy={false} onStart={() => {}} onPause={() => {}} onCancel={() => {}} />, 'en')
    expect(html).toContain('Mirroring')
    expect(html).toContain('3 of 7 files')
  })
})

describe('DriveMirrorStatus container', () => {
  it('renders the honest unavailable line when the host answers UNSUPPORTED_OPERATION', async () => {
    const api: DriveMirrorApi = {
      ...mirrorApi(IDLE_STATUS),
      driveMirrorStatus: async () => {
        throw { code: 'UNSUPPORTED_OPERATION', message: 'Drive operations are unavailable on this host' }
      },
    }
    const { container, root } = await renderLive(<DriveMirrorStatus api={api} />)
    expect(container.querySelector('[data-testid="drive-mirror-unavailable"]')).not.toBeNull()
    expect(container.textContent).toContain('Зеркалирование недоступно')
    const start = container.querySelector('[data-testid="drive-mirror-start"]') as HTMLButtonElement | null
    expect(start?.disabled).toBe(true)
    await unmount(root)
  })

  it('renders live progress and pauses through the RPC surface', async () => {
    const { container, root } = await renderLive(<DriveMirrorStatus api={mirrorApi(RUNNING_STATUS)} />)
    expect(container.textContent).toContain('3 из 7 файлов')
    const pause = container.querySelector('[data-testid="drive-mirror-pause"]') as HTMLButtonElement | null
    expect(pause?.disabled).toBe(false)
    await act(async () => {
      pause?.click()
    })
    expect(container.querySelector('[data-testid="drive-mirror-state"]')?.getAttribute('data-state')).toBe('paused')
    await unmount(root)
  })
})
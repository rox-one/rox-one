/**
 * W1-08 (#1505 fix2) — Settings toggle for `entities.previews.v1`, next to
 * #1499's `entities.links.v1` toggle: disabled (and shown off) with a hint
 * while links is off, persists to localStorage like the links toggle.
 */
import { flush, mount, resetDom, setupEntityTestEnv, testWindow, useLang } from './test-env'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { act } from 'react'
import { createStore, Provider } from 'jotai'
import { EntitiesPreviewsSettingsToggle } from '../EntitiesPreviewsSettingsToggle'
import { ENTITIES_PREVIEWS_STORAGE_KEY, entitiesLinksRequestedAtom, entitiesPreviewsRequestedAtom, entityUiFlagsAtom } from '../flags'

setupEntityTestEnv()

beforeEach(() => { testWindow.localStorage.clear() })
afterEach(() => { resetDom() })

async function render(links: boolean) {
  await useLang('ru')
  const store = createStore()
  store.set(entitiesLinksRequestedAtom, links)
  const mounted = await mount(<Provider store={store}><EntitiesPreviewsSettingsToggle /></Provider>)
  const toggle = mounted.container.querySelector('[role="switch"]') as HTMLButtonElement
  return { store, mounted, toggle }
}

describe('entities.previews.v1 Settings toggle', () => {
  it('is disabled and off with a hint while entity links are off', async () => {
    const { store, mounted, toggle } = await render(false)
    store.set(entitiesPreviewsRequestedAtom, true)
    await flush()
    expect(toggle.disabled).toBe(true)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(mounted.container.textContent).toContain('Превью сущностей (экспериментально)')
    expect(mounted.container.textContent).toContain('Сначала включите связи сущностей.')
    await act(async () => { toggle.click() })
    expect(store.get(entityUiFlagsAtom).previews).toBe(false)
    await mounted.unmount()
  })

  it('turns previews on (persisted, default off) once links is on', async () => {
    const { store, mounted, toggle } = await render(true)
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(mounted.container.textContent).not.toContain('Сначала включите связи сущностей.')
    await act(async () => { toggle.click() })
    await flush()
    expect(store.get(entitiesPreviewsRequestedAtom)).toBe(true)
    expect(store.get(entityUiFlagsAtom)).toEqual({ links: true, previews: true })
    expect(testWindow.localStorage.getItem(ENTITIES_PREVIEWS_STORAGE_KEY)).toBe('true')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await mounted.unmount()
  })

  it('is rendered right after the entity links toggle in WorkbenchChromeSettings', () => {
    const src = readFileSync(join(import.meta.dir, '../../../pages/settings/WorkbenchChromeSettings.tsx'), 'utf8')
    const links = src.indexOf("t('settings.appearance.entitiesLinks')")
    const previews = src.indexOf('<EntitiesPreviewsSettingsToggle />')
    expect(links).toBeGreaterThan(-1)
    expect(previews).toBeGreaterThan(links)
  })
})

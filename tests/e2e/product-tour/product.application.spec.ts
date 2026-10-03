import { test, expect, type Page, type TestInfo } from '@playwright/test'

const marker = 'rox-product-tour-application-test-only'
const flag = 'craft-feature-product-tour-v1'
async function waitForApp(page: Page) {
  await page.waitForFunction(() => document.getElementById('root')?.childElementCount || (window as any).__productTourApplicationImportError, undefined, { timeout: 60_000 })
  expect(await page.evaluate(() => (window as any).__productTourApplicationImportError ?? null)).toBeNull()
}
async function openApp(page: Page, route: string, enabled = false) {
  await page.addInitScript(({ flag, enabled }) => {
    localStorage.setItem('i18nextLng', 'en')
    const original = indexedDB.open.bind(indexedDB)
    const opens: string[] = []
    indexedDB.open = ((name: string, version?: number) => { opens.push(name); return original(name, version) }) as typeof indexedDB.open
    ;(window as any).__productTourDatabaseOpens = opens
    if (enabled) localStorage.setItem(flag, JSON.stringify(true))
    else localStorage.removeItem(flag)
  }, { flag, enabled })
  await page.goto(`/?mode=web&route=${encodeURIComponent(route)}`, { waitUntil: 'domcontentloaded' })
  await waitForApp(page)
  await expect.poll(() => page.evaluate(() => (window as any).__productTourApplication?.marker)).toBe(marker)
}
async function evidence(page: Page) {
  return page.request.get('/__fixture/evidence').then(response => response.json())
}
async function attachEvidence(page: Page, info: TestInfo) {
  await info.attach('application-evidence', { body: Buffer.from(JSON.stringify(await evidence(page), null, 2)), contentType: 'application/json' })
}

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await attachEvidence(page, info).catch(() => {})
})

test('APP-01/APP-06: an existing profile without the tour flag loads the real App without a forced tour', async ({ page }, info) => {
  await openApp(page, 'allSessions')
  await expect(page.getByText('Sessions: Unavailable', { exact: true })).toBeVisible()
  await expect(page.locator('[data-product-tour-overlay]')).toHaveCount(0)
  await expect(page.locator('[data-product-tour-popover]')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('craft-feature-product-tour-v1'))).toBeNull()
  expect(await page.evaluate(() => (window as any).__productTourDatabaseOpens.includes('rox-product-tour'))).toBe(false)
  const calls = (await evidence(page)).operations as Array<{ method: string }>
  expect(calls.some(call => ['sendMessage', 'respondToPermission', 'startRecording', 'performOAuth', 'runAutomation'].includes(call.method))).toBe(false)
  await attachEvidence(page, info)
})

test('APP-05: restricted WebUI keeps host inventory unavailable and denies a direct host-session read', async ({ page }, info) => {
  await openApp(page, 'allSessions', true)
  await expect(page.getByText('Sessions: Unavailable', { exact: true })).toBeVisible()
  expect(await page.evaluate(async () => {
    try { await window.electronAPI.getSessions(); return false }
    catch { return true }
  })).toBe(true)
  expect(await page.evaluate(() => (window as any).__productTourApplication.restricted)).toBe(true)
  await expect(page.locator('[data-product-tour-overlay]')).toHaveCount(0)
  await attachEvidence(page, info)
})

test('DOMAIN-12: the real Notes UI creates, edits, commits, reloads, and finds a canonical native note', async ({ page }, info) => {
  await openApp(page, 'notes')
  const title = `Acceptance note ${Date.now()}`
  const content = 'Unique acceptance phrase 49217; persisted by the actual native journal.'
  await page.getByRole('button', { name: 'New note', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(title)
  await dialog.getByRole('textbox').press('Enter')
  await expect(dialog).toHaveCount(0)
  const editor = page.locator('[contenteditable="true"]').first()
  await expect(editor).toBeVisible()
  await editor.fill(content)
  await expect.poll(async () => {
    const result = await evidence(page)
    return result.nativeFiles.some((file: { actualContent: string; content: string }) => file.actualContent.includes(content) && file.actualContent === file.content)
  }).toBe(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForApp(page)
  await expect(page.locator('[contenteditable="true"]').first()).toContainText(content)
  const search = await page.evaluate(async (phrase) => {
    const workspaceId = (window as any).__productTourApplication.workspaceId
    return window.electronAPI.searchNotes(workspaceId, phrase)
  }, '49217')
  expect(search.some((note: { title: string }) => note.title === title)).toBe(true)
  const result = await evidence(page)
  expect(result.canonicalNotes.some((note: { revision: number }) => note.revision >= 2)).toBe(true)
  await attachEvidence(page, info)
})

test('T-LEARNING-LIBRARY/T-LEARNING-CONTROLS: production learning controls start a voluntary non-mutating tour', async ({ page }, info) => {
  await openApp(page, 'settings/learning', true)
  await expect(page.getByTestId('learning-settings')).toBeVisible()
  await page.getByTestId('learning-start-OBT-25').click()
  const popup = page.locator('[data-product-tour-popover]')
  await expect(popup).toBeVisible()
  await expect(popup).toHaveAttribute('data-product-tour-step', 'learning.library')
  await popup.getByRole('button', { name: /^(Next|Continue)$/i }).click()
  await expect(popup).toHaveAttribute('data-product-tour-step', 'learning.controls')
  await popup.getByRole('button', { name: /^(Next|Continue|Finish)$/i }).click()
  await expect(popup).toHaveCount(0)
  const calls = (await evidence(page)).operations as Array<{ method: string }>
  expect(calls.some(call => ['sendMessage', 'respondToPermission', 'performOAuth', 'runAutomation', 'toggleAutomation'].includes(call.method))).toBe(false)
  await attachEvidence(page, info)
})

test('T-NOTES-CREATE/T-NOTES-SAVE: the real Notes tour verifies canonical creation and save only after ordinary user actions', async ({ page }, info) => {
  await openApp(page, 'settings/learning', true)
  await expect(page.getByTestId('learning-settings')).toBeVisible()
  await page.getByTestId('learning-start-OBT-17').click()
  const popup = page.locator('[data-product-tour-popover]')
  await expect(popup).toHaveAttribute('data-product-tour-step', 'notes.create')
  await expect(popup.getByRole('heading', { name: 'Create a note', exact: true })).toBeVisible()
  // The production Focus action selects the registered control, among several create buttons.
  await popup.getByRole('button', { name: 'Focus the control', exact: true }).click()
  const focused = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement
    const bounds = element.getBoundingClientRect()
    const mask = document.querySelector('[data-product-tour-mask] rect')!
    const x = Number(mask.getAttribute('x')) + Number(mask.getAttribute('width')) / 2
    const y = Number(mask.getAttribute('y')) + Number(mask.getAttribute('height')) / 2
    return { label: element.getAttribute('aria-label'), target: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, mask: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, mask.getAttribute(key)])), hit: document.elementFromPoint(x, y)?.tagName, pointerEvents: getComputedStyle(element).pointerEvents }
  })
  await info.attach('highlighted-control-layout', { body: Buffer.from(JSON.stringify(focused)), contentType: 'application/json' })
  expect(focused.label).toBe('New note')
  await expect.poll(() => page.evaluate(() => {
    const target = document.activeElement!.getBoundingClientRect()
    const mask = document.querySelector('[data-product-tour-mask] rect')!
    return Math.max(Math.abs(Number(mask.getAttribute('x')) - (target.x - 8)), Math.abs(Number(mask.getAttribute('y')) - (target.y - 8)), Math.abs(Number(mask.getAttribute('width')) - (target.width + 16)), Math.abs(Number(mask.getAttribute('height')) - (target.height + 16)))
  })).toBeLessThanOrEqual(2)
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox') })
  await dialog.getByRole('textbox').fill(`Guided canonical note ${Date.now()}`)
  await dialog.getByRole('textbox').press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(popup).toHaveAttribute('data-product-tour-step', 'notes.save')
  const content = 'User-written guided note canonical acceptance 72194.'
  await page.locator('[contenteditable="true"]').first().fill(content)
  await expect.poll(async () => (await evidence(page)).nativeFiles.some((file: { actualContent: string; content: string }) => file.actualContent.includes(content) && file.actualContent === file.content)).toBe(true)
  await expect(popup).toHaveCount(0)
  await expect(page.getByTestId('product-tour-status')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open('rox-product-tour')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const read = db.transaction('progress', 'readonly').objectStore('progress').getAll()
      read.onerror = () => { db.close(); reject(read.error) }
      read.onsuccess = () => { db.close(); resolve(read.result.some((record: any) => record.tourId === 'OBT-17' && record.steps['notes.create']?.verifiedAt !== undefined && record.steps['notes.save']?.verifiedAt !== undefined)) }
    }
  }))).toBe(true)
  await attachEvidence(page, info)
})

test('T-WORKSPACE-SCOPE: the real App resolves a shell target for the voluntary workspace explanation', async ({ page }, info) => {
  await openApp(page, 'settings/learning', true)
  await page.getByTestId('learning-start-OBT-02').click()
  const popup = page.locator('[data-product-tour-popover]')
  await expect(popup).toHaveAttribute('data-product-tour-step', 'workspace.scope')
  await popup.getByRole('button', { name: /^(Next|Finish)$/i }).click()
  await expect(popup).toHaveCount(0)
  await attachEvidence(page, info)
})

test('APP-03: ordinary navigation away from an active Learning step pauses its real App presentation', async ({ page }, info) => {
  await openApp(page, 'settings/learning', true)
  await page.getByTestId('learning-start-OBT-25').click()
  await expect(page.locator('[data-product-tour-popover]')).toHaveAttribute('data-product-tour-step', 'learning.library')
  const sections = page.locator('[data-application-sections]')
  if (await sections.count() && await sections.getAttribute('open') === null) await sections.locator('summary').click()
  await page.locator('[data-tutorial="sources-nav"]').first().click()
  await expect(page.locator('[data-product-tour-popover]')).toHaveCount(0)
  await expect(page.getByTestId('product-tour-status')).toContainText(/changed|paused/i)
  await attachEvidence(page, info)
})

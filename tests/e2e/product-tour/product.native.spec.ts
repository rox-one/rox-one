import { test, expect } from '@playwright/test'
import { bootNativeProduct } from './native-harness'

test('NATIVE-01/NATIVE-02: fresh product setup appears and tour cannot auto-start', async ({}, info) => {
  const product = await bootNativeProduct()
  try {
    await expect(product.page.locator('#root')).not.toBeEmpty()
    await expect(product.page.locator('#onboarding-username')).toBeVisible()
    await expect(product.page.getByTestId('welcome-browser-import-preferences')).toBeVisible()
    await expect(product.page.locator('[data-product-tour-overlay]')).toHaveCount(0)
    await expect.poll(() => product.app.windows().length).toBe(1)
    await product.page.keyboard.press('Escape')
    await expect(product.page.locator('[data-product-tour-overlay]')).toHaveCount(0)
    await info.attach('evidence-level', { body: Buffer.from(JSON.stringify({ entrypoint: 'apps/electron/dist/main.cjs', platform: process.platform, scope: 'fresh native setup smoke', dialogsAndMicrophone: 'NOT_RUN' })), contentType: 'application/json' })
  } finally { await product.dispose() }
})

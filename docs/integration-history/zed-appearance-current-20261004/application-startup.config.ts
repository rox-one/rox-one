import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from '../../../tests/e2e/product-tour/playwright.config'
// Only the cold-build startup envelope changes. Test bodies and case deadlines
// remain exactly those of the checked-in application acceptance configuration.
export default defineConfig({ ...base, testDir: resolve(import.meta.dirname, '../../../tests/e2e/product-tour'), webServer: { ...(base.webServer as object), timeout: 600_000 } })

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../useOnboarding.ts'), 'utf8')

describe('onboarding connection errors hide OMP', () => {
  it('uses i18n Rox fallbacks instead of hardcoded OMP copy', () => {
    expect(source).not.toContain('Failed to create OMP connection')
    expect(source).not.toContain('OMP connection test failed')
    expect(source).not.toMatch(/check `omp` CLI/)
    expect(source).toContain("'onboarding.ompCredential.createFailed'")
    expect(source).toContain("'onboarding.ompCredential.testFailed'")
    expect(source).toContain('visibleError')
  })
})

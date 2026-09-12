import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = readFileSync(join(import.meta.dir, '..', 'AiSettingsPage.tsx'), 'utf-8')
const RUNTIME = readFileSync(join(import.meta.dir, '..', 'RuntimeSettingsPage.tsx'), 'utf-8')

describe('AI settings visible identity', () => {
  it('labels omp connections as Rox, not OMP', () => {
    expect(SOURCE).toContain('ROX_VISIBLE_TERMS')
    expect(SOURCE).not.toMatch(/parts\.push\('OMP'\)/)
    expect(SOURCE).not.toMatch(/providerType === 'omp' \? 'OMP'/)
    expect(SOURCE).toContain('case \'omp\': parts.push(ROX_VISIBLE_TERMS.product)')
  })

  it('labels the omp toolchain row as Rox CLI runtime', () => {
    expect(RUNTIME).toContain('ROX_VISIBLE_TERMS.cli')
    expect(RUNTIME).not.toMatch(/omp: 'OMP runtime'/)
  })
})

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = readFileSync(join(import.meta.dir, '..', 'provider-icons.ts'), 'utf-8')

describe('provider icons identity', () => {
  it('does not ship a Pi runtime mark in the normal-UI icon map', () => {
    expect(SOURCE).not.toContain("from '@/assets/provider-icons/pi.svg'")
    expect(SOURCE).not.toMatch(/^\s*pi:\s*piIcon/m)
  })

  it('maps omp and rox to the Rox mark and labels Pi as Rox Backend', () => {
    expect(SOURCE).toContain('omp: roxIcon')
    expect(SOURCE).toContain('rox: roxIcon')
    expect(SOURCE).toContain("omp: 'Rox'")
    expect(SOURCE).toContain("pi: 'Rox Backend'")
  })
})

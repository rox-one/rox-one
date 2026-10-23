import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const body = readFileSync(join(import.meta.dir, '../SessionList.tsx'), 'utf8')

describe('SessionList empty/zero-data (P5.1)', () => {
  it('uses EntityListEmptyScreen for catalog empty and search zero-results', () => {
    expect(body).toContain('EntityListEmptyScreen')
    expect(body).toContain('session.noSessionsYet')
    expect(body).toContain('session.noSessionsFound')
    // Search zero-results must not keep the ad-hoc muted py-12 stack
    expect(body).not.toMatch(/noSessionsFound[\s\S]{0,200}py-12/)
    expect(body).toMatch(/noSessionsFound[\s\S]{0,400}EntityListEmptyScreen|EntityListEmptyScreen[\s\S]{0,400}noSessionsFound/)
  })

  it('keeps live isProcessing Spinner on SessionItem path (busy)', () => {
    const item = readFileSync(join(import.meta.dir, '../SessionItem.tsx'), 'utf8')
    expect(item).toMatch(/isProcessing && <Spinner/)
  })
})

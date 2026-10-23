import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const body = readFileSync(join(import.meta.dir, '../ProjectInfoPage.tsx'), 'utf8')

describe('ProjectInfoPage tabs (P4 fill-selected)', () => {
  it('uses SE subtle fill for selected tabs, not border-b-2 underline', () => {
    expect(body).toContain('bg-foreground/5 font-medium text-foreground')
    expect(body).toContain('rounded-[var(--radius-control)]')
    expect(body).not.toMatch(/rounded-t-md\s+border-b-2/)
    expect(body).not.toMatch(/active\s*\?[\s\S]{0,80}border-foreground/)
    // Selected chrome must be fill, not a bottom-border underline recipe
    expect(body).toMatch(/active\s*[\s\S]{0,120}bg-foreground\/5/)
  })
})

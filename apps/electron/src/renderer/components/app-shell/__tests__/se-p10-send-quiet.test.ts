import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(
  join(import.meta.dir, '../SendToWorkspaceDialog.tsx'),
  'utf8',
)

describe('P10.1 SendToWorkspace quiet progress', () => {
  it('uses SE accent stroke without violet LED glow', () => {
    expect(src).toContain('text-accent')
    expect(src).toContain('stroke="currentColor"')
    expect(src.includes('8B5CF6')).toBe(false)
    expect(src.includes('purple LED')).toBe(false)
    expect(src.includes('drop-shadow')).toBe(false)
  })
})

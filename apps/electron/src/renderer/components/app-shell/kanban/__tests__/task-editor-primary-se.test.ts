import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../TaskEditor.tsx'), 'utf8')

describe('TaskEditor primary hierarchy (P5b)', () => {
  it('primary Btn uses SE accent, not indigo', () => {
    expect(src).toContain("primary: 'bg-accent text-white hover:bg-accent/90'")
    expect(src).not.toContain('bg-indigo-500')
    expect(src).not.toContain('text-indigo-500')
    expect(src).toContain('text-accent hover:underline')
  })
})

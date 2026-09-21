import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('background finished chip clarity', () => {
  it('uses solid fill without backdrop blur', () => {
    const src = readFileSync(join(import.meta.dir, '../BackgroundFinishedChip.tsx'), 'utf8')
    expect(src).not.toContain('backdrop-blur')
    expect(src).toContain('bg-purple-100')
    expect(src).toContain('dark:bg-purple-950')
  })
})

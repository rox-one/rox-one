import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../switch.tsx'), 'utf8')

describe('Switch contrast', () => {
  it('keeps the unchecked track darker than 35% so Appearance toggles stay visible', () => {
    expect(source).not.toContain('data-[state=unchecked]:bg-foreground/35')
    expect(source).not.toContain('dark:data-[state=unchecked]:bg-foreground/30')
    expect(source).not.toContain('border-foreground/25')
    expect(source).toContain('data-[state=unchecked]:bg-foreground/55')
    expect(source).toContain('dark:data-[state=unchecked]:bg-foreground/50')
    expect(source).toContain('border-foreground/45')
  })
})

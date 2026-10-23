import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name)
    if (name.isDirectory()) walk(p, out)
    else if (name.name.endsWith('.tsx')) out.push(p)
  }
  return out
}

const settingsRoot = join(import.meta.dir, '..')
const sessionList = readFileSync(join(import.meta.dir, '../../../components/app-shell/SessionList.tsx'), 'utf8')

describe('P6.1 surface weight (SE)', () => {
  it('settings panels drop bg-muted gray wells', () => {
    for (const file of walk(settingsRoot)) {
      if (file.includes('/__tests__/')) continue
      const src = readFileSync(file, 'utf8')
      expect(src.includes('bg-muted/'), `${file} still has bg-muted/`).toBe(false)
    }
  })

  it('SessionList empty CTAs use SE surface tokens', () => {
    expect(sessionList).toContain('bg-surface-hover hover:bg-surface-pressed')
    expect(sessionList).not.toMatch(/EntityListEmptyScreen[\s\S]{0,400}bg-foreground\/\[0\.06\]/)
  })
})

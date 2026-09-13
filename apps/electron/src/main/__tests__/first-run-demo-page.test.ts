import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mainSrc = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')

describe('first-run demo page', () => {
  it('seeds a Getting started Page when creating the default workspace', () => {
    expect(mainSrc).toContain('ensureDemoPage')
    expect(mainSrc).toContain('defaultPath')
  })
})

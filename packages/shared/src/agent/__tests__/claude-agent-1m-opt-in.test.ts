import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../claude-agent.ts'), 'utf8')

describe('ClaudeAgent 1M context suffix', () => {
  it('appends [1m] only when enable1MContext is explicitly true', () => {
    expect(source).toContain('this.config.enable1MContext === true')
    expect(source).not.toContain('this.config.enable1MContext !== false')
  })
})

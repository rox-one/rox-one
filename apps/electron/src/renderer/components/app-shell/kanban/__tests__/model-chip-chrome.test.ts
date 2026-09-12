import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const CHIP = readFileSync(join(__dirname, '..', 'ModelChip.tsx'), 'utf8')

describe('ModelChip harness icons', () => {
  it('classifies from model + connection and never defaults to Anthropic', () => {
    expect(CHIP).toContain('collectionHarnessProvider')
    expect(CHIP).toContain('llmConnection')
    expect(CHIP).not.toContain("?? 'anthropic'")
    expect(CHIP).toContain('getModelProvider(model)')
  })
})

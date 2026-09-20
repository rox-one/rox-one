import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const inputPath = join(__dirname, '../input/FreeFormInput.tsx')
const badgePath = join(__dirname, '../input/FreeFormInputContextBadge.tsx')

describe('composer toolbar type', () => {
  it('uses 11px on input-toolbar-btn and the context badge', () => {
    const input = readFileSync(inputPath, 'utf8')
    const badge = readFileSync(badgePath, 'utf8')

    const toolbarLines = [
      ...input.split('\n').filter((line) => line.includes('input-toolbar-btn')),
      ...badge.split('\n').filter((line) => line.includes('input-toolbar-btn')),
    ]

    expect(input.split('\n').some((line) => line.includes('input-toolbar-btn') && line.includes('text-[11px]'))).toBe(true)
    expect(badge.split('\n').some((line) => line.includes('input-toolbar-btn') && line.includes('text-[11px]'))).toBe(true)
    expect(toolbarLines.every((line) => !line.includes('text-[13px]'))).toBe(true)
  })
})

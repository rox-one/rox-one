import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const badgePath = join(__dirname, '../input/FreeFormInputContextBadge.tsx')
const cssPath = join(__dirname, '../../../../index.css')

describe('composer toolbar type', () => {
  it('uses 9px on context badge and chrome CSS override for toolbar buttons', () => {
    const badge = readFileSync(badgePath, 'utf8')
    const css = readFileSync(cssPath, 'utf8')

    expect(badge.split('\n').some((line) => line.includes('input-toolbar-btn') && line.includes('text-[9px]'))).toBe(true)
    expect(badge.split('\n').every((line) => !line.includes('text-[13px]') && !line.includes('text-[11px]'))).toBe(true)
    expect(css).toContain('button.input-toolbar-btn')
    expect(css).toContain('font-size: 9px')
  })
})

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const badgePath = join(__dirname, '../input/FreeFormInputContextBadge.tsx')
const cssPath = join(import.meta.dir, '../../../chat-chrome-clarity.css')
const mainPath = join(import.meta.dir, '../../../main.tsx')

describe('composer toolbar type', () => {
  it('keeps the ramp class on the context badge and the 9px chrome CSS override for toolbar buttons', () => {
    const badge = readFileSync(badgePath, 'utf8')
    const css = readFileSync(cssPath, 'utf8')
    const main = readFileSync(mainPath, 'utf8')

    // G7: the badge sits on the type ramp (text-xs = 11px); the 9px optical
    // size for toolbar buttons comes from the chrome CSS override below.
    expect(badge.split('\n').some((line) => line.includes('input-toolbar-btn') && line.includes('text-xs'))).toBe(true)
    expect(badge.split('\n').every((line) => !line.includes('text-[13px]') && !line.includes('text-[11px]') && !line.includes('text-[9px]'))).toBe(true)
    expect(css).toContain('button.input-toolbar-btn')
    expect(css).toContain('font-size: 9px')
    expect(main).toContain("chat-chrome-clarity.css")
  })
})

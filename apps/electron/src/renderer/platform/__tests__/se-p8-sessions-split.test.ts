/**
 * P8.2 — Sessions mid-band: ModeBar labels @720; header actions full @640;
 * SessionSearchHeader min-w-0.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dir, '../../index.css'), 'utf8')
const search = readFileSync(
  join(import.meta.dir, '../../components/app-shell/SessionSearchHeader.tsx'),
  'utf8',
)

describe('P8.2 Sessions responsive chrome', () => {
  it('shows view-switch labels only from 720px panel', () => {
    expect(css).toMatch(/@container panel \(min-width: 720px\)[\s\S]*?\.rox-view-switch-label/)
    expect(css).not.toMatch(/@container panel \(min-width: 640px\)\s*\{\s*\.rox-view-switch-label/)
  })

  it('shows full header actions only from 640px panel', () => {
    expect(css).toMatch(/@container panel \(min-width: 640px\)[\s\S]*?\.rox-header-actions-full/)
    expect(css).not.toMatch(/@container panel \(min-width: 560px\)[\s\S]*?\.rox-header-actions-full/)
  })

  it('SessionSearchHeader is min-w-0', () => {
    expect(search).toMatch(/min-w-0 shrink-0/)
  })
})

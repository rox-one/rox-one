import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const pages = join(import.meta.dir, '..')
const settingsUi = join(import.meta.dir, '../../../components/settings/SettingsUIConstants.ts')

function read(name: string) {
  return readFileSync(join(pages, name), 'utf8')
}

describe('settings narrow overflow (Account/Rox/Knowledge)', () => {
  it('AccountSettingsPage drops rigid min-w control floors', () => {
    const body = read('AccountSettingsPage.tsx')
    expect(body).not.toMatch(/className="[^"]*min-w-\[240px\]/)
    expect(body).not.toMatch(/className="[^"]*min-w-\[220px\]/)
    expect(body).toContain('w-full min-w-0 max-w-[240px]')
    expect(body).toContain('w-full min-w-0 max-w-[220px]')
  })

  it('RoxAccountManagement handle row can shrink', () => {
    const body = read('RoxAccountManagement.tsx')
    expect(body).not.toContain('min-w-[260px]')
    expect(body).toContain('w-full min-w-0 max-w-[260px]')
    expect(body).toContain('h-8 min-w-0 flex-1')
  })

  it('KnowledgeSettingsPage inputs prefer max-w over fixed w-80', () => {
    const body = read('KnowledgeSettingsPage.tsx')
    expect(body).not.toMatch(/className="w-80"/)
    expect(body).toContain('w-full min-w-0 max-w-80')
  })

  it('settings control slot allows min-w-0 for shrink', () => {
    const body = readFileSync(settingsUi, 'utf8')
    expect(body).toMatch(/control:\s*'flex min-w-0 shrink-0 items-center gap-2'/)
  })
})


describe('448px settings stack CQ (index.css)', () => {
  const css = readFileSync(join(import.meta.dir, '../../../index.css'), 'utf8')
  const start = css.indexOf('/* Settings rows: stack vertically in narrow panels.')
  const block = start < 0 ? '' : css.slice(start, start + 2800)

  it('extends fixed-width neutralization beyond w-[180]/w-[200]', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(block).toContain('@container panel (max-width: 448px)')
    expect(block).toContain('[data-slot="input"]')
    expect(block).toContain('.w-80')
    expect(block.includes(String.raw`.min-w-\[240px\]`)).toBe(true)
    expect(block.includes(String.raw`.max-w-\[260px\]`)).toBe(true)
    expect(block).toContain('.max-w-80')
    expect(block).toContain(':not(:has([data-slot="switch"]))')
  })
})

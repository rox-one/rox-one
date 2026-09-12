import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../ElementInspectConfirm.tsx'), 'utf8')

describe('ElementInspectConfirm (issue 16)', () => {
  it('uses t() for every user-facing label', () => {
    expect(source).toContain("t('browser.inspect.title')")
    expect(source).toContain("t('browser.inspect.pageUnchanged')")
    expect(source).toContain("t('browser.inspect.approve')")
    expect(source).toContain("t('browser.inspect.deny')")
    expect(source).toContain('pendingDestructiveKind')
  })

  it('keeps destructive actions behind explicit approval controls', () => {
    expect(source).toContain('onApproveDestructive')
    expect(source).toContain('onDenyDestructive')
    expect(source).toContain('onApproveEdit')
  })
})

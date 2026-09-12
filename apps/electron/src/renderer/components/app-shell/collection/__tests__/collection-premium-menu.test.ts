import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const dir = join(import.meta.dir, '..')

describe('collection chrome PremiumMenu', () => {
  it('uses PremiumMenu for the view cycle picker', () => {
    const src = readFileSync(join(dir, 'CollectionViewCycleButton.tsx'), 'utf8')
    expect(src).toContain("import { PremiumMenu } from '@craft-agent/ui'")
    expect(src).toContain('<PremiumMenu')
    expect(src).toContain('variant="compact"')
    expect(src).not.toContain('StyledDropdownMenuContent')
  })

  it('uses PremiumMenu for group-by instead of StyledDropdown', () => {
    const src = readFileSync(join(dir, 'CollectionGroupByMenu.tsx'), 'utf8')
    expect(src).toContain("import { PremiumMenu } from '@craft-agent/ui'")
    expect(src).toContain('<PremiumMenu')
    expect(src).toContain('selectedId={display.groupBy}')
    expect(src).toContain('variant="compact"')
    expect(src).not.toContain('StyledDropdown')
    expect(src).not.toContain('DropdownMenuTrigger')
  })
})

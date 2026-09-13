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

  it('playground collection chrome wires table, heatmap empty-day and a 390 viewport', () => {
    const playground = readFileSync(
      join(import.meta.dir, '../../../../playground/registry/collection.tsx'),
      'utf8',
    )
    expect(playground).toContain("id: 'collection-chrome'")
    expect(playground).toContain("id: 'collection-chrome-narrow'")
    expect(playground).toContain("id: 'collection-heatmap-empty'")
    expect(playground).toContain('onCollapseAll')
    expect(playground).toContain('onSelectGroup')
    expect(playground).toContain("width: 390")
    expect(playground).toContain("t('collection.heatmap.emptyDay')")
    expect(playground).toContain('ActionRegistryProvider')
    expect(playground).toContain('SessionTablePropertyHeader')
    expect(playground).toContain('playgroundGroupBucket')
    expect(playground).toContain("label: STATUSES.find((status) => status.id === id)?.label ?? id")
    expect(playground).not.toContain("label: key === 'all' ? 'All' : key")
    expect(playground).not.toContain('<select')
  })
})

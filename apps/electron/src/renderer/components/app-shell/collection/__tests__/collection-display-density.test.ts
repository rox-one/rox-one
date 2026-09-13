import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const popover = readFileSync(join(__dirname, '../CollectionDisplayPopover.tsx'), 'utf8')
const flags = readFileSync(
  join(__dirname, '../../../../../../../../packages/core/src/platform/workbench/flags.ts'),
  'utf8',
)

describe('CollectionDisplayPopover density toggle', () => {
  it('exposes compact/comfortable density as an opt-in Display control', () => {
    expect(popover).toContain('collection.display.densityLabel')
    expect(popover).toContain('collection.display.density.compact')
    expect(popover).toContain('collection.display.density.comfortable')
    expect(popover).toContain('COLLECTION_DENSITY_VALUES')
    expect(popover).toContain('patch({ density: value })')
  })

  it('does not invent a Timeline surface', () => {
    expect(popover).not.toMatch(/Timeline|timeline/)
  })
})

describe('workbench harness flags default on', () => {
  it('keeps Conation defaultValue false and harness experimental flags on', () => {
    expect(flags).toContain('id: WORKBENCH_FLAG.harnessAgentTeams')
    expect(flags).toMatch(/id: WORKBENCH_FLAG\.conationShell[\s\S]*?defaultValue: false/)
    for (const id of [
      'harnessInspectorV1',
      'harnessChatChromeV1',
      'harnessAgentIntelV1',
      'harnessExtCenterV1',
      'harnessAgentTeams',
    ]) {
      expect(flags).toContain(`id: WORKBENCH_FLAG.${id}`)
      expect(flags).toMatch(new RegExp(`id: WORKBENCH_FLAG\\.${id}[\\s\\S]*?defaultValue: true`))
    }
    expect(flags.match(/defaultValue: false/g)?.length ?? 0).toBeGreaterThanOrEqual(11)
  })
})

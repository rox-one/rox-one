import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const header = readFileSync(join(__dirname, '..', 'SessionTableGroupHeader.tsx'), 'utf8')
const host = readFileSync(join(__dirname, '..', 'SessionTableHost.tsx'), 'utf8')

describe('session table group header chrome', () => {
  it('exposes select-group plus collapse-all like the session list', () => {
    expect(header).toContain("t('entityList.selectGroup')")
    expect(header).toContain("t('entityList.collapseAll')")
    expect(header).toContain("t('entityList.expandAll')")
    expect(header).toContain('selectGroupDisabled(bucket.count)')
    expect(header).toContain('data-empty-group={bucketKey}')
    expect(header).toContain("t('entityList.emptyGroupDrop')")
  })

  it('wires group selection and empty-group drop on the table host', () => {
    expect(host).toContain('addToSelection')
    expect(host).toContain('selectTableGroupSessionIds')
    expect(host).toContain('collapsibleTableGroupKeys')
    expect(host).toContain('SessionTableEmptyDropLane')
    expect(host).toContain('onSelectGroup=')
    expect(host).toContain('emptyLaneHeight: TABLE_EMPTY_LANE_HEIGHT')
    expect(host).toContain('finalizeEmptyGroupDrop')
  })
})

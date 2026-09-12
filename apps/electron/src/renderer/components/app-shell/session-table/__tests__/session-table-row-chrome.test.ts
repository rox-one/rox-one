import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROW = readFileSync(join(__dirname, '..', 'SessionTableRow.tsx'), 'utf8')

describe('session table row chrome', () => {
  it('replaces native status/priority selects with compact PremiumMenu', () => {
    expect(ROW).not.toContain('<select')
    expect(ROW).toContain("import { PremiumMenu, type PremiumMenuItem } from '@craft-agent/ui'")
    expect(ROW).toContain('<PremiumMenu')
    expect(ROW).toContain('variant="compact"')
    expect(ROW).toContain("t('collection.table.column.status')")
    expect(ROW).toContain("t('collection.table.column.priority')")
    expect(ROW).toContain('selectedId={value}')
  })

  it('renders optional metric columns when enabled', () => {
    expect(ROW).toContain('showSize')
    expect(ROW).toContain('showToolCalls')
    expect(ROW).toContain('showCommits')
    expect(ROW).toContain('showParallelAgents')
    expect(ROW).toContain('formatTranscriptSize')
  })
})

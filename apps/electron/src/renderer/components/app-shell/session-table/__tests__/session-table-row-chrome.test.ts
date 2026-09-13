import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROW = readFileSync(join(__dirname, '..', 'SessionTableRow.tsx'), 'utf8')
const HOST = readFileSync(join(__dirname, '..', 'SessionTableHost.tsx'), 'utf8')

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

  it('collapses status/label/priority/due/agent/project into one icon cluster', () => {
    expect(ROW).toContain('data-property-cluster')
    expect(ROW).toContain('<Circle className="h-3.5 w-3.5" />')
    expect(ROW).toContain('<Tag className="h-3.5 w-3.5" />')
    expect(ROW).toContain('<ChevronsUp className="h-3.5 w-3.5" />')
    expect(ROW).toContain('<Calendar className="h-3.5 w-3.5" />')
    expect(ROW).toContain('<Bot className="h-3.5 w-3.5" />')
    expect(ROW).toContain('<FolderKanban className="h-3.5 w-3.5" />')
    expect(ROW).not.toContain('w-28 shrink-0')
    expect(ROW).not.toContain('w-32 shrink-0')
    expect(ROW).toContain('{icon}')
    expect(ROW).not.toContain('ModelChip')
  })

  it('keeps an accessible name and t() tooltip on every property icon', () => {
    expect(ROW).toContain('aria-label={name}')
    expect(ROW).toContain('title={name}')
    expect(ROW).toContain("t('collection.table.column.labels')")
    expect(ROW).toContain("t('collection.table.column.dueDate')")
    expect(ROW).toContain("t('collection.table.column.model')")
    expect(ROW).toContain("t('collection.table.column.project')")
  })

  it('renders optional metric columns when enabled', () => {
    expect(ROW).toContain('showSize')
    expect(ROW).toContain('showToolCalls')
    expect(ROW).toContain('showCommits')
    expect(ROW).toContain('showParallelAgents')
    expect(ROW).toContain('formatTranscriptSize')
  })
})

describe('session table header chrome', () => {
  it('uses the same icon cluster instead of six text property columns', () => {
    expect(HOST).toContain('<SessionTablePropertyHeader')
    expect(HOST).not.toContain("w-28 shrink-0")
    expect(HOST).not.toContain("w-32 shrink-0")
    expect(HOST).not.toContain("w-24 shrink-0")
    expect(HOST).toContain('setProjectId')
    expect(HOST).toContain('setLabels')
  })
})

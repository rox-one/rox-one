import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const HOST = readFileSync(join(__dirname, '..', 'SessionTableHost.tsx'), 'utf8')
const ROW = readFileSync(join(__dirname, '..', 'SessionTableRow.tsx'), 'utf8')
const GROUP = readFileSync(join(__dirname, '..', 'SessionTableGroupHeader.tsx'), 'utf8')

describe('session table a11y roles (GG #561)', () => {
  it('stamps role=table/row/columnheader on virtual header without rewriting virtualization', () => {
    expect(HOST).toContain('role="table"')
    expect(HOST).toContain("t('collection.table.a11yLabel')")
    expect(HOST).toContain('role="row"')
    expect(HOST).toContain('role="columnheader"')
    expect(HOST).toContain('role="rowgroup"')
    expect(HOST).toContain('virtualTableWindow')
    expect(HOST).not.toContain('role="grid"')
  })

  it('marks virtual data/group rows as role=row', () => {
    expect(ROW).toContain('role="row"')
    expect(ROW).toContain('role="columnheader"')
    expect(GROUP).toContain('role="row"')
  })
})

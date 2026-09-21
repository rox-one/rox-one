import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const editorSource = readFileSync(join(__dirname, '..', 'SessionWorkflowEditor.tsx'), 'utf8')
const ruSource = readFileSync(
  join(__dirname, '../../../../../../../packages/shared/src/i18n/locales/ru.json'),
  'utf8',
)

describe('session map toolbar compact', () => {
  test('primary cluster stays single-row; secondary actions live in overflow menu', () => {
    const toolbarStart = editorSource.indexOf('role="toolbar"')
    expect(toolbarStart).toBeGreaterThan(-1)
    const nextSection = editorSource.indexOf('relative min-h-0 flex-1', toolbarStart)
    const toolbarSlice = editorSource.slice(toolbarStart, nextSection === -1 ? undefined : nextSection)
    expect(toolbarSlice).toContain('flex-nowrap')
    expect(toolbarSlice).not.toContain('flex-wrap')
    expect(toolbarSlice).toContain('DropdownMenu')
    expect(toolbarSlice).toContain('MoreHorizontal')
    expect(toolbarSlice).toContain('entityView.mapImportSpec')
    expect(toolbarSlice).toContain('entityView.mapResetLayout')
    expect(toolbarSlice).toContain('entityView.mapRunPipeline')
    expect(toolbarSlice).toMatch(
      /<Button\b[\s\S]*?onClick=\{handlePromoteTrace\}[\s\S]*?entityView\.mapPromoteTrace/,
    )
  })

  test('RU mapPromoteTrace reads as draft-from-run', () => {
    expect(ruSource).toContain('"entityView.mapPromoteTrace": "В черновик с прогона"')
    expect(ruSource).not.toContain('"entityView.mapPromoteTrace": "Повысить след"')
  })
})

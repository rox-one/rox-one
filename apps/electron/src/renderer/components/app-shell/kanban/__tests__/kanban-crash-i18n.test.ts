import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../KanbanBoardContainer.tsx'), 'utf8')

describe('kanban crash chrome i18n', () => {
  it('translates editor and board crash fallbacks', () => {
    expect(source).toContain("t('kanban.editorFailed')")
    expect(source).toContain("t('kanban.backToBoard')")
    expect(source).toContain("t('kanban.boardFailed')")
    expect(source).toContain("t('common.retry')")
    expect(source).not.toContain('Task editor failed to open.')
    expect(source).not.toContain('Board failed to open.')
  })
})

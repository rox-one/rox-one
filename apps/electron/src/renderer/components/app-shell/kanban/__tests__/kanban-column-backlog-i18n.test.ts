import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import { KANBAN_COLUMNS } from '../status-column'

const COLUMN = readFileSync(join(import.meta.dir, '../KanbanColumn.tsx'), 'utf8')

describe('P35-95 kanban backlog column title is i18n', () => {
  it('renders backlog as a column header through labelKey', () => {
    expect(KANBAN_COLUMNS[0]?.id).toBe('backlog')
    expect(KANBAN_COLUMNS[0]?.labelKey).toBe('kanban.column.backlog')
    expect(COLUMN).toContain('t(column.labelKey)')
  })

  it('English locale keeps Backlog', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('kanban.column.backlog')).toBe('Backlog')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('kanban.column.backlog')).toBe('Бэклог')
    expect(i18n.t('kanban.column.backlog')).not.toBe('Backlog')
    expect(i18n.t('status.backlog')).toBe('Бэклог')
  })
})

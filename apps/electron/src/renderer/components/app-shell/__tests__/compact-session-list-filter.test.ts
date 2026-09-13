import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const FILTER = readFileSync(join(__dirname, '..', 'CompactSessionListFilter.tsx'), 'utf8')
const CHROME = readFileSync(join(__dirname, '..', 'collection', 'CollectionViewChrome.tsx'), 'utf8')
const GROUP_MENU = readFileSync(join(__dirname, '..', 'collection', 'CollectionGroupByMenu.tsx'), 'utf8')

describe('session list grouping chrome', () => {
  it('hides the leftover compact groupingMode cycle (date/status/unread)', () => {
    expect(FILTER).not.toContain("t('sidebar.groupByDate')")
    expect(FILTER).not.toContain("t('sidebar.groupByStatus')")
    expect(FILTER).not.toContain("t('sidebar.groupByUnread')")
    expect(FILTER).not.toContain("t('sidebar.group')")
    expect(FILTER).toContain('Leftover compact groupingMode cycle')
    expect(FILTER).toContain('groupBy === \'none\'')
  })

  it('leaves CollectionGroupByMenu as the grouping control in collection chrome', () => {
    expect(CHROME).toContain('<CollectionGroupByMenu')
    expect(GROUP_MENU).toContain('selectedId={display.groupBy}')
    expect(GROUP_MENU).toContain("t('collection.display.groupByLabel')")
  })
})

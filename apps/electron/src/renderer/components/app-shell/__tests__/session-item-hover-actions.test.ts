import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ITEM = readFileSync(join(import.meta.dir, '..', 'SessionItem.tsx'), 'utf8')
const MENU = readFileSync(join(import.meta.dir, '..', 'SessionMenu.tsx'), 'utf8')
const ROW = readFileSync(join(import.meta.dir, '..', '..', 'ui', 'entity-row.tsx'), 'utf8')
const hover = ITEM.slice(ITEM.indexOf('hoverActions={'), ITEM.indexOf('titleTrailing='))

describe('session row hover actions', () => {
  test('fork, copy transcript, archive, flag — in that order, compact', () => {
    const order = ['sessionMenu.fork', 'sessionMenu.copyTranscript', 'sessionMenu.archive', 'sessionMenu.flag'].map((key) => hover.indexOf(key))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(ITEM).toContain('hoverActionSize="compact"')
  })
  test('mark-unread moved out of hover into the … menu', () => {
    expect(hover).not.toContain('markAsUnread')
    expect(hover).not.toContain('<Mail')
    expect(MENU).toContain('sessionMenu.markAsUnread')
  })
  test('flag toggles with a filled icon and aria-pressed', () => {
    expect(hover).toContain('pressed={!!item.isFlagged}')
    expect(hover).toContain('fill-current')
  })
  test('buttons are labelled and reachable by keyboard (focus-within reveal)', () => {
    expect(ITEM).toMatch(/aria-label=\{label\}[\s\S]*title=\{label\}/)
    expect(ROW).toContain('group-focus-within:opacity-100')
    expect(ROW).toContain('[&_button]:size-[22px]!')
  })
  test('compact density: 13px title, 11px meta, time on the title line', () => {
    expect(ITEM).toContain('text-[13px]')
    expect(ITEM).toContain('text-[11px]')
    expect(ITEM).toContain('const showLastActivityInTrailing = Boolean(lastActivityText)')
  })
})

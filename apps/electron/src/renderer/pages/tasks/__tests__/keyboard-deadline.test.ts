import { describe, expect, it } from 'bun:test'
import { deadlineTone, navigateIndex } from '../task-model'

describe('navigateIndex', () => {
  it('steps, jumps and pages within bounds', () => {
    expect(navigateIndex('ArrowDown', -1, 5)).toBe(0)
    expect(navigateIndex('ArrowDown', 4, 5)).toBe(4)
    expect(navigateIndex('ArrowUp', 0, 5)).toBe(0)
    expect(navigateIndex('ArrowUp', 3, 5)).toBe(2)
    expect(navigateIndex('Home', 3, 5)).toBe(0)
    expect(navigateIndex('End', 0, 5)).toBe(4)
    expect(navigateIndex('PageDown', 1, 30)).toBe(11)
    expect(navigateIndex('PageDown', 25, 30)).toBe(29)
    expect(navigateIndex('PageUp', 5, 30)).toBe(0)
    expect(navigateIndex('PageDown', -1, 3)).toBe(2)
  })
  it('ignores other keys and empty lists', () => {
    expect(navigateIndex('x', 0, 5)).toBeNull()
    expect(navigateIndex('Home', -1, 0)).toBeNull()
  })
})

describe('deadlineTone', () => {
  it('flags overdue/today as danger and the next two days as warning', () => {
    expect(deadlineTone(-3)).toBe('danger')
    expect(deadlineTone(0)).toBe('danger')
    expect(deadlineTone(1)).toBe('warning')
    expect(deadlineTone(2)).toBe('warning')
    expect(deadlineTone(3)).toBe('muted')
  })
})

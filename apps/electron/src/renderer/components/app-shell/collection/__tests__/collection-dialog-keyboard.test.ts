import { describe, expect, it } from 'bun:test'
import { nextCollectionDialogIndex } from '../collection-dialog-keyboard'

describe('nextCollectionDialogIndex', () => {
  it('wraps arrow keys and jumps home/end', () => {
    expect(nextCollectionDialogIndex(4, 0, 'ArrowDown')).toBe(1)
    expect(nextCollectionDialogIndex(4, 3, 'ArrowDown')).toBe(0)
    expect(nextCollectionDialogIndex(4, 0, 'ArrowUp')).toBe(3)
    expect(nextCollectionDialogIndex(4, -1, 'ArrowDown')).toBe(0)
    expect(nextCollectionDialogIndex(4, 2, 'Home')).toBe(0)
    expect(nextCollectionDialogIndex(4, 2, 'End')).toBe(3)
  })

  it('ignores unrelated keys and empty lists', () => {
    expect(nextCollectionDialogIndex(4, 1, 'Enter')).toBeNull()
    expect(nextCollectionDialogIndex(0, 0, 'ArrowDown')).toBeNull()
  })
})

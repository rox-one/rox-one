import { describe, expect, it } from 'bun:test'
import { countObjectsBytes } from '../clone.ts'

describe('O9 clone size guard', () => {
  it('sums size and size-pack (KiB) into bytes from `git count-objects -v`', () => {
    const stdout = [
      'count: 12',
      'size: 1024',
      'in-pack: 4021',
      'packs: 1',
      'size-pack: 2048',
      'prune-packable: 0',
      'garbage: 0',
      'size-garbage: 0',
    ].join('\n')
    expect(countObjectsBytes(stdout)).toBe((1024 + 2048) * 1024)
  })

  it('tolerates CRLF and indentation, and ignores unrelated counters', () => {
    expect(countObjectsBytes('size: 5\r\n  size-pack: 6\r\ncount: 9\r\n')).toBe(11 * 1024)
    expect(countObjectsBytes('count: 9\nin-pack: 4\n')).toBe(0)
    expect(countObjectsBytes('')).toBe(0)
  })
})
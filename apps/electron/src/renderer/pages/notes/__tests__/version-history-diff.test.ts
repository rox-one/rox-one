import { describe, expect, it } from 'bun:test'
import { previewDiff } from '../version-history-diff.ts'

describe('previewDiff', () => {
  it('marks added and removed lines for restore preview', () => {
    const rows = previewDiff('# Now\nline\n', '# Then\nline\nextra\n')
    expect(rows.some((row) => row.type === 'del' && row.text === '# Now')).toBe(true)
    expect(rows.some((row) => row.type === 'add' && row.text === '# Then')).toBe(true)
    expect(rows.some((row) => row.type === 'add' && row.text === 'extra')).toBe(true)
    expect(rows.some((row) => row.type === 'same' && row.text === 'line')).toBe(true)
  })
})

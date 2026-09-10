import { describe, expect, it } from 'bun:test'
import { emptyGitWorkingTreeStatus, parseGitPorcelainV1 } from './status.ts'

describe('parseGitPorcelainV1', () => {
  it('parses branch, ahead/behind, and entries', () => {
    const parsed = parseGitPorcelainV1(
      [
        '## main...origin/main [ahead 1, behind 2]',
        ' M src/a.ts',
        '?? new.md',
      ].join('\n'),
    )
    expect(parsed.isRepo).toBe(true)
    expect(parsed.branch).toBe('main')
    expect(parsed.ahead).toBe(1)
    expect(parsed.behind).toBe(2)
    expect(parsed.entries).toEqual([
      { index: ' ', worktree: 'M', path: 'src/a.ts' },
      { index: '?', worktree: '?', path: 'new.md' },
    ])
  })

  it('treats empty stdout as not a repo snapshot', () => {
    expect(parseGitPorcelainV1('')).toEqual(emptyGitWorkingTreeStatus())
  })
})

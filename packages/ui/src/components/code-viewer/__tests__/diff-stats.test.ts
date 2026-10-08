import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDiffFromFile } from '@pierre/diffs'
import { getDiffStats, getUnifiedDiffStats, parseUnifiedDiff } from '../diff-stats'
import { getShikiThemeType, resolveShikiTheme, ZED_SHIKI_THEMES } from '../zedShikiThemeData'

describe('diff-stats (startup-safe diff helpers)', () => {
  it('sums hunk counts of a unified diff, with or without file headers', () => {
    const hunk = '@@ -1,3 +1,4 @@\n a\n-b\n+B\n+C\n c\n'
    const parsed = parseUnifiedDiff(hunk, 'x.ts')!
    const expected = {
      additions: parsed.hunks.reduce((sum, h) => sum + h.additionCount, 0),
      deletions: parsed.hunks.reduce((sum, h) => sum + h.deletionCount, 0),
    }
    expect(expected.additions).toBeGreaterThan(0)
    expect(getUnifiedDiffStats(hunk, 'x.ts')).toEqual(expected)
    expect(getUnifiedDiffStats(`--- a/x.ts\n+++ b/x.ts\n${hunk}`)).toEqual(expected)
    expect(getDiffStats(parsed)).toEqual(expected)
    expect(getUnifiedDiffStats('   ')).toBeNull()
    expect(parseUnifiedDiff('', 'x.ts')).toBeNull()
  })

  it('sums hunk counts of a two-file diff', () => {
    const diff = parseDiffFromFile({ name: 'a.txt', contents: 'one\ntwo\n' }, { name: 'a.txt', contents: 'one\n2\nthree\n' })
    expect(getDiffStats(diff)).toEqual({
      additions: diff.hunks.reduce((sum, h) => sum + h.additionCount, 0),
      deletions: diff.hunks.reduce((sum, h) => sum + h.deletionCount, 0),
    })
  })
})

describe('startup modules stay free of the Shiki runtime', () => {
  const read = (path: string) => readFileSync(join(import.meta.dir, '..', path), 'utf8')
  const valueImportsShiki = (source: string) => /^import\s+(?!type\b)[^;\n]*from\s+['"](shiki|@pierre\/diffs\/react)['"]/m.test(source)

  it('theme data, diff stats and the code viewer import no Shiki runtime', () => {
    expect(valueImportsShiki(read('zedShikiThemeData.ts'))).toBe(false)
    expect(valueImportsShiki(read('diff-stats.ts'))).toBe(false)
    expect(valueImportsShiki(read('ShikiCodeViewer.tsx'))).toBe(false)
  })

  it('theme lookups keep their behaviour', () => {
    expect(getShikiThemeType('rox-siri-light')).toBe(ZED_SHIKI_THEMES['rox-siri-light']!.type)
    expect(getShikiThemeType('github-dark')).toBeUndefined()
    expect(resolveShikiTheme('github-dark')).toBe('github-dark')
    expect(resolveShikiTheme('rox-nordfox-opaque')).toBe(ZED_SHIKI_THEMES['rox-nordfox-opaque']!)
  })
})

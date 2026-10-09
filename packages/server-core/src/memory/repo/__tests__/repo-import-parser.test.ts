import { describe, expect, it } from 'bun:test'
import {
  isLessonRepoPath,
  parseLessonRepoFile,
  parseRepoEdits,
  repoRuleHash,
  unifiedDiff,
  type RepoImportFile,
  type RepoImportKnownLesson,
} from '../repo-import-parser'

function lessonFile(fields: {
  id: string
  rule: string
  disabled?: boolean
  baseHash?: string
  category?: string
}): string {
  return [
    '---',
    `id: ${fields.id}`,
    'scope: workspace',
    `category: ${fields.category ?? 'workflow'}`,
    `disabled: ${fields.disabled ? 'true' : 'false'}`,
    ...(fields.baseHash ? [`baseHash: ${fields.baseHash}`] : []),
    '---',
    fields.rule,
    '',
  ].join('\n')
}

function file(path: string, content: string): RepoImportFile {
  return { path, content }
}

function known(over: Partial<RepoImportKnownLesson> & { lessonId: string; rule: string }): RepoImportKnownLesson {
  return {
    path: over.path ?? `lessons/workflow/rule--${over.lessonId}.md`,
    lessonId: over.lessonId,
    rule: over.rule,
    ruleHash: over.ruleHash ?? repoRuleHash(over.rule),
    disabled: over.disabled ?? false,
    baseHash: over.baseHash,
  }
}

describe('repoRuleHash', () => {
  it('is stable under NFKC + trim but differs for real changes', () => {
    expect(repoRuleHash('  Always run checks  ')).toBe(repoRuleHash('Always run checks'))
    expect(repoRuleHash('Always run checks')).not.toBe(repoRuleHash('Always run checks now'))
  })
})

describe('parseLessonRepoFile', () => {
  it('reads id, disabled and the rule body', () => {
    const parsed = parseLessonRepoFile(file('lessons/workflow/a.md', lessonFile({ id: 'ws:1', rule: 'Never force push' })))
    expect(parsed.id).toBe('ws:1')
    expect(parsed.rule).toBe('Never force push')
    expect(parsed.disabled).toBe(false)
  })

  it('degrades a file without frontmatter to a rule-only record', () => {
    const parsed = parseLessonRepoFile(file('lessons/workflow/a.md', 'Just a rule'))
    expect(parsed.id).toBeUndefined()
    expect(parsed.rule).toBe('Just a rule')
  })
})

describe('parseRepoEdits classification', () => {
  it('classifies a changed rule as update with a diff containing the changed line', () => {
    const oldRule = 'Always run checks'
    const newRule = 'Always run the full checks'
    const edits = parseRepoEdits({
      bankId: 'ws:1',
      files: [file('lessons/workflow/a--id1.md', lessonFile({ id: 'id1', rule: newRule, baseHash: repoRuleHash(oldRule) }))],
      known: [known({ lessonId: 'id1', rule: oldRule, baseHash: repoRuleHash(oldRule) })],
    })
    expect(edits).toHaveLength(1)
    expect(edits[0]!.kind).toBe('update')
    expect(edits[0]!.lessonId).toBe('id1')
    expect(edits[0]!.conflict).toBeUndefined()
    expect(edits[0]!.diff).toContain(`+${newRule}`)
    expect(edits[0]!.diff).toContain(`-${oldRule}`)
  })

  it('tags a baseHash mismatch as conflict:rule-changed', () => {
    const edits = parseRepoEdits({
      bankId: 'ws:1',
      files: [file('lessons/workflow/a--id1.md', lessonFile({ id: 'id1', rule: 'New rule', baseHash: 'fileHash' }))],
      known: [known({ lessonId: 'id1', rule: 'Old rule', baseHash: 'storedHash' })],
    })
    expect(edits).toHaveLength(1)
    expect(edits[0]!.kind).toBe('update')
    expect(edits[0]!.conflict).toBe('rule-changed')
  })

  it('classifies an unknown lesson id as add', () => {
    const edits = parseRepoEdits({
      bankId: 'ws:1',
      files: [file('lessons/workflow/new--id2.md', lessonFile({ id: 'id2', rule: 'Brand new rule' }))],
      known: [],
    })
    expect(edits).toHaveLength(1)
    expect(edits[0]!.kind).toBe('add')
    expect(edits[0]!.lessonId).toBe('id2')
    expect(edits[0]!.rule).toBe('Brand new rule')
  })

  it('classifies a known lesson whose file is gone as delete', () => {
    const edits = parseRepoEdits({
      bankId: 'ws:1',
      files: [],
      known: [known({ lessonId: 'id1', rule: 'Removed rule' })],
    })
    expect(edits).toHaveLength(1)
    expect(edits[0]!.kind).toBe('delete')
    expect(edits[0]!.lessonId).toBe('id1')
  })

  it('classifies a lesson file with no id as conflict:unknown-id', () => {
    const edits = parseRepoEdits({
      bankId: 'ws:1',
      files: [file('lessons/workflow/broken.md', 'no frontmatter here')],
      known: [],
    })
    expect(edits).toHaveLength(1)
    expect(edits[0]!.kind).toBe('add')
    expect(edits[0]!.conflict).toBe('unknown-id')
  })

  it('skips shell files entirely', () => {
    const edits = parseRepoEdits({
      bankId: 'ws:1',
      files: [
        file('README.md', '# Repo\nhuman docs'),
        file('.gitignore', '.snapshots/\n*.tmp'),
        file('MEMORY.md', '---\ntitle: MEMORY\n---\n## Правила'),
        file('PROFILE.md', 'profile'),
        file('history/2026-01-01.md', 'daily'),
        file('DREAMS.md', 'dreams'),
        file('.meta.json', '{}'),
      ],
      known: [],
    })
    expect(edits).toEqual([])
    expect(isLessonRepoPath('README.md')).toBe(false)
    expect(isLessonRepoPath('lessons/workflow/a--id1.md')).toBe(true)
  })

  it('classifies a disabled flip as update without a rule diff', () => {
    const rule = 'Always run checks'
    const edits = parseRepoEdits({
      bankId: 'ws:1',
      files: [file('lessons/workflow/a--id1.md', lessonFile({ id: 'id1', rule, disabled: true }))],
      known: [known({ lessonId: 'id1', rule, disabled: false })],
    })
    expect(edits).toHaveLength(1)
    expect(edits[0]!.kind).toBe('update')
    expect(edits[0]!.diff).toBeUndefined()
  })

  it('skips a file whose rule and disabled flag are unchanged', () => {
    const rule = 'Always run checks'
    const edits = parseRepoEdits({
      bankId: 'ws:1',
      files: [file('lessons/workflow/a--id1.md', lessonFile({ id: 'id1', rule }))],
      known: [known({ lessonId: 'id1', rule })],
    })
    expect(edits).toEqual([])
  })
})

describe('parseRepoEdits ordering', () => {
  it('sorts edits deterministically by path regardless of input order', () => {
    const rule = 'Rule'
    const edits = parseRepoEdits({
      bankId: 'ws:1',
      files: [
        file('lessons/z/z--idz.md', lessonFile({ id: 'idz', rule })),
        file('lessons/a/a--ida.md', lessonFile({ id: 'ida', rule })),
        file('lessons/m/m--idm.md', lessonFile({ id: 'idm', rule })),
      ],
      known: [],
    })
    expect(edits.map((edit) => edit.path)).toEqual([
      'lessons/a/a--ida.md',
      'lessons/m/m--idm.md',
      'lessons/z/z--idz.md',
    ])
  })

  it('is stable across repeated runs', () => {
    const input = {
      bankId: 'ws:1',
      files: [file('lessons/b/b--b.md', lessonFile({ id: 'b', rule: 'B' }))],
      known: [known({ lessonId: 'a', rule: 'A' })],
    }
    expect(parseRepoEdits(input)).toEqual(parseRepoEdits(input))
  })
})

describe('unifiedDiff', () => {
  it('returns an empty string for identical texts', () => {
    expect(unifiedDiff('a\nb', 'a\nb')).toBe('')
  })

  it('emits a hunk with 3 lines of context and the changed line', () => {
    const oldText = ['1', '2', '3', '4', 'old', '5', '6', '7'].join('\n')
    const newText = ['1', '2', '3', '4', 'new', '5', '6', '7'].join('\n')
    const diff = unifiedDiff(oldText, newText, 'lessons/x.md')
    expect(diff).toContain('-old')
    expect(diff).toContain('+new')
    expect(diff).toContain('@@')
    expect(diff.startsWith('--- a/lessons/x.md')).toBe(true)
  })

  it('handles a pure insertion', () => {
    const diff = unifiedDiff('a\nb', 'a\nx\nb')
    expect(diff).toContain('+x')
  })
})
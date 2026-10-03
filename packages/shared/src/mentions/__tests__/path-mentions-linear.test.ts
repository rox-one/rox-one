import { describe, expect, it } from 'bun:test'
import { parseMentions, replacePathMentions, resolveFileMentions } from '../index.ts'

describe('path token grammar', () => {
  it('preserves first-closing-bracket, nested opener, whitespace and empty-token semantics', () => {
    const text = '[file:] [file: [file:深い/путь\n.txt]] [folder:[folder:x]] [file:a] [file:a]'
    const parsed = parseMentions(text, [], [])
    expect(parsed.files).toEqual([' [file:深い/путь\n.txt', 'a'])
    expect(parsed.folders).toEqual(['[folder:x'])
    expect(replacePathMentions(text, 'file', p => `{${p}}`)).toBe('[file:] { [file:深い/путь\n.txt}] [folder:[folder:x]] {a} {a}')
  })
  it('does not discard or truncate repeated unterminated prefixes', () => {
    const text = '[file:'.repeat(16384) + '[folder:'.repeat(16384)
    expect(parseMentions(text, [], []).files).toEqual([])
    expect(parseMentions(text, [], []).folders).toEqual([])
    expect(resolveFileMentions(text, '/owned')).toBe(text)
  })
  it('keeps file-then-folder replacement order, including nested mixed tokens', () => {
    expect(resolveFileMentions('[file:[folder:x]]', '/owned')).toBe('[Mentioned file: [Mentioned folder: [folder:x) (at /owned/x (at /owned/[folder:x))]]')
    expect(parseMentions('[file:[folder:x]]', [], [])).toMatchObject({ files: ['[folder:x'], folders: ['x'] })
  })
  it('retains distinct path order and deduplicates without changing other mention kinds', () => {
    const files = Array.from({ length: 2048 }, (_, i) => `src/${i}.ts`)
    const result = parseMentions(files.concat(files).map(p => `[file:${p}]`).join(' ') + ' [skill:build] [source:git]', ['build'], ['git'])
    expect(result.files).toEqual(files)
    expect(result.skills).toEqual(['build'])
    expect(result.sources).toEqual(['git'])
  })
})

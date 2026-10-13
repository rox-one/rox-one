import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import matter from 'gray-matter'
import {
  closeAllVaultIndexes,
  ensureVaultIndex,
  ensureVaultIndexAsync,
  getVaultBacklinks,
  getVaultInsights,
  listVaultTasks,
  resetVaultIndexIoForTests,
  setVaultIndexIoForTests,
} from '../vault-index.ts'
import { parseVaultMarkdown } from '../vault-markdown.ts'

const dirs: string[] = []

function tmpNotes(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vault-idx-inc-'))
  dirs.push(dir)
  const notesRoot = join(dir, 'notes')
  mkdirSync(join(notesRoot, 'daily'), { recursive: true })
  return notesRoot
}

function trackNoteReads(notesRoot: string): string[] {
  const reads: string[] = []
  setVaultIndexIoForTests({
    readFileSync(absPath, encoding) {
      reads.push(relative(notesRoot, absPath).split('\\').join('/'))
      return readFileSync(absPath, encoding)
    },
    readFile(absPath, encoding) {
      reads.push(relative(notesRoot, absPath).split('\\').join('/'))
      return readFile(absPath, encoding)
    },
  })
  return reads
}

afterEach(() => {
  resetVaultIndexIoForTests()
  closeAllVaultIndexes()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('incremental vault index reads', () => {
  it('reads zero note contents on a second ensure of an unchanged vault', async () => {
    const notesRoot = tmpNotes()
    writeFileSync(
      join(notesRoot, 'alpha.md'),
      `---
title: Alpha
---

See [[Beta]]

- [ ] file the report
`,
    )
    writeFileSync(
      join(notesRoot, 'beta.md'),
      `---
title: Beta
---

plain body
`,
    )
    const reads = trackNoteReads(notesRoot)
    expect(ensureVaultIndex(notesRoot).ok).toBe(true)
    expect(listVaultTasks(notesRoot).map(task => ({
      documentId: task.documentId,
      checked: task.checked,
      text: task.text,
    }))).toEqual([
      { documentId: 'alpha', checked: false, text: 'file the report' },
    ])

    reads.length = 0
    expect(ensureVaultIndex(notesRoot).ok).toBe(true)
    expect(reads).toEqual([])
    expect(listVaultTasks(notesRoot).map(task => task.text)).toEqual(['file the report'])

    expect((await ensureVaultIndexAsync(notesRoot)).ok).toBe(true)
    expect(reads).toEqual([])
  })

  it('re-reads exactly the edited note and updates entities, backlinks, and tasks', () => {
    const notesRoot = tmpNotes()
    writeFileSync(
      join(notesRoot, 'alpha.md'),
      `---
title: Alpha
---

- [ ] file the report
`,
    )
    writeFileSync(
      join(notesRoot, 'beta.md'),
      `---
title: Beta
---

plain body
`,
    )
    const reads = trackNoteReads(notesRoot)
    expect(ensureVaultIndex(notesRoot).ok).toBe(true)
    expect(getVaultBacklinks(notesRoot, 'beta')).toEqual([])
    expect(listVaultTasks(notesRoot).map(task => task.text)).toEqual(['file the report'])

    writeFileSync(
      join(notesRoot, 'alpha.md'),
      `---
title: Alpha
people:
  - Zara Quill
---

See [[Beta]]

- [ ] ship the slice
`,
    )
    reads.length = 0
    expect(ensureVaultIndex(notesRoot).ok).toBe(true)
    expect(reads).toEqual(['alpha.md'])
    expect(getVaultBacklinks(notesRoot, 'beta').map(item => item.noteId)).toEqual(['alpha'])
    expect(listVaultTasks(notesRoot).map(task => ({
      documentId: task.documentId,
      checked: task.checked,
      text: task.text,
    }))).toEqual([
      { documentId: 'alpha', checked: false, text: 'ship the slice' },
    ])
    expect(getVaultInsights(notesRoot, 'alpha').entities.some(
      item => item.name === 'Zara Quill' && item.kind === 'person',
    )).toBe(true)
  })

  it('drops deleted-note entities and backlinks without reading remaining notes', () => {
    const notesRoot = tmpNotes()
    writeFileSync(
      join(notesRoot, 'alpha.md'),
      `---
title: Alpha
people:
  - Zara Quill
---

See [[Beta]]

- [ ] file the report
`,
    )
    writeFileSync(
      join(notesRoot, 'beta.md'),
      `---
title: Beta
---

plain body
`,
    )
    const reads = trackNoteReads(notesRoot)
    expect(ensureVaultIndex(notesRoot).ok).toBe(true)
    expect(getVaultBacklinks(notesRoot, 'beta').map(item => item.noteId)).toEqual(['alpha'])

    rmSync(join(notesRoot, 'alpha.md'))
    reads.length = 0
    expect(ensureVaultIndex(notesRoot).ok).toBe(true)
    expect(reads).toEqual([])
    expect(getVaultBacklinks(notesRoot, 'beta')).toEqual([])
    expect(listVaultTasks(notesRoot)).toEqual([])
    expect(getVaultInsights(notesRoot, 'alpha').entities).toEqual([])
    expect(getVaultInsights(notesRoot, 'beta').entities.map(item => item.name)).not.toContain('Zara Quill')
  })

  it('shares one in-flight refresh across concurrent ensureVaultIndexAsync callers', async () => {
    const notesRoot = tmpNotes()
    writeFileSync(
      join(notesRoot, 'alpha.md'),
      `---
title: Alpha
---

See [[Beta]]
`,
    )
    writeFileSync(
      join(notesRoot, 'beta.md'),
      `---
title: Beta
---

plain body
`,
    )
    const reads = trackNoteReads(notesRoot)
    const results = await Promise.all([
      ensureVaultIndexAsync(notesRoot),
      ensureVaultIndexAsync(notesRoot),
      ensureVaultIndexAsync(notesRoot),
    ])
    expect(results.map(result => result.ok)).toEqual([true, true, true])
    expect([...reads].sort()).toEqual(['alpha.md', 'beta.md'])
  })

  it('does not add keys to gray-matter cache', () => {
    const cache = (matter as any).cache as Record<string, unknown>
    const before = Object.keys(cache)
    parseVaultMarkdown('---\ntitle: Cache\n---\n\nbody\n', 'cache.md')
    const notesRoot = tmpNotes()
    writeFileSync(join(notesRoot, 'cache.md'), '---\ntitle: Cache\n---\n\nbody\n')
    expect(ensureVaultIndex(notesRoot).ok).toBe(true)
    expect(Object.keys((matter as any).cache as Record<string, unknown>)).toEqual(before)
  })
})

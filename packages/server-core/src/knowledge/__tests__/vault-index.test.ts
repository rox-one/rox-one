import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  closeAllVaultIndexes,
  ensureVaultIndex,
  getVaultBacklinks,
  getVaultInsights,
  hashVaultMarkdownFiles,
  isVaultIndexAvailable,
  listVaultDocuments,
  listVaultTasks,
  queryVaultDocuments,
  rebuildVaultIndex,
  vaultIndexHealth,
  vaultIndexPath,
} from '../vault-index.ts'
import { parseVaultMarkdown } from '../vault-markdown.ts'

const dirs: string[] = []

function tmpNotes(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vault-idx-'))
  dirs.push(dir)
  const notesRoot = join(dir, 'notes')
  mkdirSync(join(notesRoot, 'daily'), { recursive: true })
  return notesRoot
}

function sha(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

afterEach(() => {
  closeAllVaultIndexes()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('vault markdown extractors', () => {
  it('parses wikilinks, tags, tasks, footnotes, blocks, session and calendar refs', () => {
    const parsed = parseVaultMarkdown(
      `---
title: Alpha
aliases:
  - A1
tags:
  - inbox
---

See [[Beta|the beta]] and [[session:sess-9]] plus [[2026-09-12]].

- [ ] write tests
- [x] ship slice

A claim[^fn].

Paragraph with a block. ^blk-1

[^fn]: footnote body
#project
`,
      'projects/alpha.md',
    )
    expect(parsed.title).toBe('Alpha')
    expect(parsed.aliases).toEqual(['A1'])
    expect(parsed.tags).toEqual(['inbox', 'project'])
    expect(parsed.links.map(link => link.target)).toEqual(['Beta', 'session:sess-9', '2026-09-12'])
    expect(parsed.tasks.map(task => ({ checked: task.checked, text: task.text }))).toEqual([
      { checked: false, text: 'write tests' },
      { checked: true, text: 'ship slice' },
    ])
    expect(parsed.footnotes.some(item => item.footnoteId === 'fn' && item.definition)).toBe(true)
    expect(parsed.blocks.map(block => ({ id: block.id, text: block.text }))).toEqual([
      { id: 'blk-1', text: 'Paragraph with a block.' },
    ])
    expect(parsed.sessionRefs.map(item => item.sessionId)).toEqual(['sess-9'])
    expect(parsed.calendarRefs.map(item => item.date)).toContain('2026-09-12')
  })
})

describe('local vault index', () => {
  it('is available under bun test', () => {
    expect(isVaultIndexAvailable()).toBe(true)
  })

  it('rebuilds from markdown, lists and queries notes, and restores links/tasks', () => {
    const notesRoot = tmpNotes()
    writeFileSync(
      join(notesRoot, 'alpha.md'),
      `---
title: Alpha note
tags: [inbox]
---

Link to [[Beta]] and a task:

- [ ] index the vault
`,
    )
    writeFileSync(
      join(notesRoot, 'beta.md'),
      `---
title: Beta
---

Back to [[Alpha note]].
`,
    )
    mkdirSync(join(notesRoot, 'assets'), { recursive: true })
    writeFileSync(join(notesRoot, 'assets', 'skip.md'), 'not a note')
    mkdirSync(join(notesRoot, 'imports'), { recursive: true })
    writeFileSync(join(notesRoot, 'imports', 'hidden.md'), 'import provenance')

    const before = hashVaultMarkdownFiles(notesRoot)
    const rebuilt = rebuildVaultIndex(notesRoot)
    expect(rebuilt.ok).toBe(true)
    expect(rebuilt.indexed).toBe(2)
    expect(rebuilt.available).toBe(true)
    expect(vaultIndexHealth(notesRoot).documentCount).toBe(2)

    const listed = listVaultDocuments(notesRoot)
    expect(listed.map(doc => doc.id).sort()).toEqual(['alpha', 'beta'])
    expect(listed.find(doc => doc.id === 'alpha')?.tags).toEqual(['inbox'])
    expect(listed.find(doc => doc.id === 'alpha')?.links.map(link => link.target)).toEqual(['Beta'])

    const hits = queryVaultDocuments(notesRoot, 'index the vault')
    expect(hits.map(doc => doc.id)).toEqual(['alpha'])

    const backlinks = getVaultBacklinks(notesRoot, 'beta')
    expect(backlinks.map(item => item.noteId)).toEqual(['alpha'])

    const tasks = listVaultTasks(notesRoot)
    expect(tasks.map(task => ({ documentId: task.documentId, checked: task.checked, text: task.text }))).toEqual([
      { documentId: 'alpha', checked: false, text: 'index the vault' },
    ])

    expect(hashVaultMarkdownFiles(notesRoot)).toEqual(before)
  })

  it('rebuilds a deleted or corrupt index from markdown without changing notes', () => {
    const notesRoot = tmpNotes()
    const alpha = `---
title: Alpha
---

[[Beta]]

- [x] recovered
`
    const beta = `---
title: Beta
aliases: [Bee]
---

body
`
    writeFileSync(join(notesRoot, 'alpha.md'), alpha)
    writeFileSync(join(notesRoot, 'beta.md'), beta)
    expect(rebuildVaultIndex(notesRoot).ok).toBe(true)
    const before = {
      alpha: sha(readFileSync(join(notesRoot, 'alpha.md'), 'utf8')),
      beta: sha(readFileSync(join(notesRoot, 'beta.md'), 'utf8')),
    }

    closeAllVaultIndexes()
    writeFileSync(vaultIndexPath(notesRoot), 'definitely not a sqlite database')
    const recovered = ensureVaultIndex(notesRoot)
    expect(recovered.ok).toBe(true)
    expect(recovered.recovered).toBe(true)
    expect(listVaultDocuments(notesRoot).map(doc => doc.id).sort()).toEqual(['alpha', 'beta'])
    expect(getVaultBacklinks(notesRoot, 'beta').map(item => item.noteId)).toEqual(['alpha'])
    expect(listVaultTasks(notesRoot)[0]?.text).toBe('recovered')
    expect(queryVaultDocuments(notesRoot, 'Bee').map(doc => doc.id)).toEqual(['beta'])

    closeAllVaultIndexes()
    rmSync(vaultIndexPath(notesRoot), { force: true })
    const restored = ensureVaultIndex(notesRoot)
    expect(restored.ok).toBe(true)
    expect(listVaultDocuments(notesRoot)).toHaveLength(2)

    expect(sha(readFileSync(join(notesRoot, 'alpha.md'), 'utf8'))).toBe(before.alpha)
    expect(sha(readFileSync(join(notesRoot, 'beta.md'), 'utf8'))).toBe(before.beta)
    expect(readFileSync(join(notesRoot, 'alpha.md'), 'utf8')).toBe(alpha)
    expect(readFileSync(join(notesRoot, 'beta.md'), 'utf8')).toBe(beta)
  })

  it('skips unchanged files on incremental rebuild', () => {
    const notesRoot = tmpNotes()
    writeFileSync(join(notesRoot, 'one.md'), '---\ntitle: One\n---\n\nhello\n')
    expect(rebuildVaultIndex(notesRoot).indexed).toBe(1)
    const second = ensureVaultIndex(notesRoot)
    expect(second.ok).toBe(true)
    expect(second.indexed).toBe(0)
    expect(second.unchanged).toBe(1)

    writeFileSync(join(notesRoot, 'two.md'), '---\ntitle: Two\n---\n\nworld\n')
    const third = ensureVaultIndex(notesRoot)
    expect(third.indexed).toBe(1)
    expect(third.unchanged).toBe(1)
    expect(listVaultDocuments(notesRoot).map(doc => doc.id).sort()).toEqual(['one', 'two'])
  })

  it('indexes named entities and ranked link insights without mutating markdown', () => {
    const notesRoot = tmpNotes()
    const alpha = `---
title: Alpha
aliases: [A1]
people:
  - Alice Smith
---

Ask Bee about the work.

A claim[^fn].

[^fn]: source
`
    const beta = `---
title: Beta
aliases: [Bee]
---

body
`
    writeFileSync(join(notesRoot, 'alpha.md'), alpha)
    writeFileSync(join(notesRoot, 'beta.md'), beta)
    expect(rebuildVaultIndex(notesRoot).ok).toBe(true)
    const insights = getVaultInsights(notesRoot, 'alpha')
    expect(insights.entities.some((item) => item.name === 'Alice Smith' && item.kind === 'person')).toBe(true)
    expect(insights.linkSuggestions.some((item) => item.targetTitle === 'Beta' && item.mention === 'Bee')).toBe(true)
    expect(insights.footnotes.some((item) => item.id === 'fn' && item.hasDef && item.hasRef)).toBe(true)
    expect(readFileSync(join(notesRoot, 'alpha.md'), 'utf8')).toBe(alpha)
  })
})

/**
 * MemoryRepoMaterializer tests — purity, determinism and the spec §5 file map.
 *
 * The materializer is a pure function: no fs/git/network/clock. Every assertion
 * here runs on plain data, so the suite never touches a real memory directory.
 */
import { describe, expect, it } from 'bun:test'
import { createHash } from 'crypto'
import {
  lessonFileId,
  lessonSlug,
  renderRepoFiles,
  ruleHash,
  type RenderedRepoFile,
  type RepoSourceBundle,
  type RepoSourceLesson,
} from '../MemoryRepoMaterializer'

const GENERATED_AT = '2026-10-09T00:00:00.000Z'
/** sha1("hello") — the canonical value ruleHash must reproduce. */
const HELLO_SHA1 = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'

function makeLesson(overrides: Partial<RepoSourceLesson> & { lessonKey: string; rule: string }): RepoSourceLesson {
  return {
    category: 'workflow',
    negative: false,
    pinned: false,
    disabled: false,
    tags: [],
    createdAt: '2026-08-05T10:00:00.000Z',
    ...overrides,
  }
}

function makeBundle(overrides: Partial<RepoSourceBundle> = {}): RepoSourceBundle {
  return {
    bankId: 'main',
    scope: 'main',
    lessons: [],
    context: '# Контекст\nживём здесь',
    preferences: 'предпочитаю bun',
    history: [],
    ...overrides,
  }
}

function render(bundle: RepoSourceBundle): RenderedRepoFile[] {
  return renderRepoFiles(bundle, { generatedAt: GENERATED_AT })
}

function byPath(files: RenderedRepoFile[]): Map<string, RenderedRepoFile> {
  return new Map(files.map(f => [f.path, f]))
}

function requireFile(files: RenderedRepoFile[], path: string): RenderedRepoFile {
  const file = files.find(f => f.path === path)
  if (!file) throw new Error(`missing rendered file: ${path}`)
  return file
}

/** Parse the leading `--- ... ---` block as a simple `key: value` list. */
function parseFrontmatter(content: string): Record<string, string> {
  expect(content.startsWith('---\n')).toBe(true)
  const end = content.indexOf('\n---\n', 4)
  expect(end).toBeGreaterThan(0)
  const out: Record<string, string> = {}
  for (const line of content.slice(4, end).split('\n')) {
    const idx = line.indexOf(':')
    expect(idx).toBeGreaterThan(-1)
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

describe('ruleHash', () => {
  it('is sha1 hex of the NFKC-normalized, trimmed rule text', () => {
    expect(ruleHash('hello')).toBe(HELLO_SHA1)
    expect(ruleHash('hello')).toMatch(/^[0-9a-f]{40}$/)
  })

  it('trims and NFKC-normalizes before hashing', () => {
    expect(ruleHash('  hello  ')).toBe(ruleHash('hello'))
    // U+FB01 LATIN SMALL LIGATURE FI normalizes to "fi" under NFKC.
    expect(ruleHash('\uFB01')).toBe(ruleHash('fi'))
  })
})

describe('lessonSlug', () => {
  it('transliterates Cyrillic into a readable ASCII slug', () => {
    expect(lessonSlug('никогда')).toBe('nikogda')
    expect(lessonSlug('Никогда не деплой в пятницу')).toBe('nikogda-ne-deploy-v-pyatnitsu')
  })

  it('lowercases, replaces non-alphanumerics and collapses runs', () => {
    expect(lessonSlug('Never deploy on Friday')).toBe('never-deploy-on-friday')
    expect(lessonSlug('a!!!   b??c')).toBe('a-b-c')
    expect(lessonSlug('--hello--')).toBe('hello')
  })

  it('falls back to "rule" when nothing survives', () => {
    expect(lessonSlug('')).toBe('rule')
    expect(lessonSlug('🎉🎉')).toBe('rule')
    expect(lessonSlug('   ')).toBe('rule')
  })

  it('caps the slug at 60 characters without a trailing dash', () => {
    const slug = lessonSlug('a'.repeat(80))
    expect(slug.length).toBe(60)
    const dashed = lessonSlug(`${'a'.repeat(59)}-${'b'.repeat(10)}`)
    expect(dashed.length).toBeLessThanOrEqual(60)
    expect(dashed.endsWith('-')).toBe(false)
  })
})

describe('lessonFileId', () => {
  it('uses the scope-scoped hash of the lesson key', () => {
    const bundle = makeBundle({ scope: 'workspace' })
    const lesson = makeLesson({ lessonKey: 'always test', rule: 'Always test' })
    const keyHash = createHash('sha1').update('always test', 'utf8').digest('hex').slice(0, 10)
    expect(lessonFileId(bundle, lesson)).toBe(`workspace:${keyHash}`)
  })

  it('prefers the proposal id when present', () => {
    const bundle = makeBundle()
    const lesson = makeLesson({
      lessonKey: 'x',
      rule: 'X',
      source: { proposalId: 'p_44' },
    })
    expect(lessonFileId(bundle, lesson)).toBe('p:p_44')
  })
})

describe('renderRepoFiles — determinism', () => {
  const bundle = makeBundle({
    lessons: [
      makeLesson({ lessonKey: 'b', rule: 'Second rule', createdAt: '2026-08-05T10:00:00.000Z' }),
      makeLesson({ lessonKey: 'a', rule: 'First rule', createdAt: '2026-08-05T09:00:00.000Z' }),
      makeLesson({ lessonKey: 'c', rule: 'Третье правило', category: 'correction', createdAt: '2026-08-05T09:00:00.000Z' }),
    ],
    history: [
      { date: '2026-08-04', content: 'day 1\n' },
      { date: '2026-08-05', content: 'day 2\n' },
    ],
  })

  it('does not depend on object identity (aliasing check)', () => {
    // Rebuilt from the same values in the same order, this only proves the
    // renderer reads plain values and not live object references (aliasing);
    // non-determinism from input *order* is covered by the shuffled test below.
    const twin = JSON.parse(JSON.stringify(bundle)) as RepoSourceBundle
    expect(twin).not.toBe(bundle)
    expect(JSON.stringify(render(twin))).toBe(JSON.stringify(render(bundle)))
  })

  it('is invariant to source ordering (shuffled input ⇒ byte-identical output)', () => {
    const shuffled = makeBundle({
      bankId: bundle.bankId,
      scope: bundle.scope,
      lessons: [bundle.lessons[1], bundle.lessons[2], bundle.lessons[0]],
      history: [bundle.history[1], bundle.history[0]],
      context: bundle.context,
      preferences: bundle.preferences,
    })
    expect(JSON.stringify(render(shuffled))).toBe(JSON.stringify(render(bundle)))
  })

  it('a one-rule change diverges exactly that lesson file and MEMORY.md', () => {
    // proposalId keeps the file id (and thus the path) stable across the change.
    const lesson = makeLesson({ lessonKey: 'k', rule: 'First rule', createdAt: '2026-08-05T09:00:00.000Z', source: { proposalId: 'p_x' } })
    const other = makeLesson({ lessonKey: 'k2', rule: 'Second rule', createdAt: '2026-08-05T10:00:00.000Z' })
    const base = makeBundle({ lessons: [lesson, other], history: [{ date: '2026-08-05', content: 'h\n' }] })
    const revised = makeBundle({
      lessons: [{ ...lesson, rule: 'First rule!' }, other],
      history: base.history,
      context: base.context,
      preferences: base.preferences,
    })

    const before = byPath(render(base))
    const after = byPath(render(revised))
    const lessonPath = render(base).find(f => f.kind === 'lesson' && f.lessonKey === 'k')!.path
    // The changed lesson keeps its path, so the divergence is content-only.
    expect(before.has(lessonPath)).toBe(true)
    expect(after.has(lessonPath)).toBe(true)

    const paths = [...before.keys(), ...after.keys()]
    const differing = paths
      .filter((path, index) => paths.indexOf(path) === index)
      .filter(path => before.get(path)?.content !== after.get(path)?.content)
      .sort()
    expect(differing).toEqual([lessonPath, 'MEMORY.md'].sort())
  })

  it('sorts rendered files by path', () => {
    const paths = render(bundle).map(f => f.path)
    expect(paths).toEqual([...paths].sort())
    expect(paths).toContain('.gitignore')
  })

  it('sorts lessons by (ts, id)', () => {
    const files = byPath(render(bundle))
    const memory = requireFile(render(bundle), 'MEMORY.md').content
    const order = [...memory.matchAll(/\[\[(lessons\/[^\]]+)\]\]/g)].map(m => `${m[1]}.md`)
    for (const path of order) expect(files.has(path)).toBe(true)
    // "First rule" (09:00) precedes "Second rule" (10:00); the 09:00 Cyrillic one
    // follows it by id tiebreak, deterministically.
    const first = memory.indexOf('First rule')
    const second = memory.indexOf('Second rule')
    expect(first).toBeLessThan(second)
  })
})

describe('renderRepoFiles — file map', () => {
  it('renders MEMORY.md, README.md, .gitignore and one file per lesson', () => {
    const bundle = makeBundle({
      lessons: [makeLesson({ lessonKey: 'a', rule: 'Always test' })],
    })
    const paths = render(bundle).map(f => f.path)
    expect(paths).toContain('MEMORY.md')
    expect(paths).toContain('README.md')
    expect(paths).toContain('.gitignore')
    expect(paths).toContain('lessons/workflow/always-test--' + lessonFileId(bundle, bundle.lessons[0]).slice(-8) + '.md')
  })

  it('never renders DREAMS.md (owned by the dream)', () => {
    const paths = render(makeBundle()).map(f => f.path)
    expect(paths.some(p => p.includes('DREAMS'))).toBe(false)
  })

  it('has the required .gitignore entries', () => {
    const gitignore = requireFile(render(makeBundle()), '.gitignore').content
    for (const entry of ['.snapshots/', '*.tmp', '.conflicts/', '.meta.json']) {
      expect(gitignore).toContain(entry)
    }
  })
})

describe('renderRepoFiles — encoding and MEMORY frontmatter', () => {
  it('parses MEMORY.md frontmatter as a simple key: value list', () => {
    const bundle = makeBundle({ bankId: 'ws:42', scope: 'workspace', workspaceName: 'acme', lessons: [makeLesson({ lessonKey: 'a', rule: 'A' })] })
    const fm = parseFrontmatter(requireFile(render(bundle), 'MEMORY.md').content)
    expect(fm).toEqual({ bank: 'ws:42', scope: 'workspace', workspace: 'acme', lessons: '1' })
  })

  it('renders LF-only files that end with a newline (history copied verbatim)', () => {
    const bundle = makeBundle({
      lessons: [makeLesson({ lessonKey: 'a', rule: 'A' })],
      history: [{ date: '2026-08-05', content: 'no trailing newline' }],
    })
    for (const file of render(bundle)) {
      expect(file.content).not.toContain('\r')
      if (file.kind !== 'history') expect(file.content.endsWith('\n')).toBe(true)
    }
  })
})

describe('renderRepoFiles — PROFILE.md scoping', () => {
  it('includes PROFILE.md for the main bank', () => {
    const files = byPath(render(makeBundle({ scope: 'main' })))
    expect(files.has('PROFILE.md')).toBe(true)
    expect(files.get('PROFILE.md')!.kind).toBe('profile')
    expect(files.get('PROFILE.md')!.content).toContain('предпочитаю bun')
  })

  it('omits PROFILE.md for workspace banks even when preferences exist', () => {
    const bundle = makeBundle({ scope: 'workspace', workspaceName: 'acme', preferences: 'should not leak' })
    const files = render(bundle)
    expect(files.some(f => f.path === 'PROFILE.md')).toBe(false)
    expect(files.some(f => f.content.includes('should not leak'))).toBe(false)
  })

  it('links PROFILE.md from MEMORY.md only for the main bank', () => {
    expect(requireFile(render(makeBundle({ scope: 'main' })), 'MEMORY.md').content).toContain('[[PROFILE.md]]')
    expect(requireFile(render(makeBundle({ scope: 'workspace' })), 'MEMORY.md').content).not.toContain('PROFILE.md')
  })
})

describe('renderRepoFiles — history', () => {
  it('copies history content byte-for-byte', () => {
    const content = '# 2026-08-05\n\nстроки без завершающего перевода'
    const file = requireFile(render(makeBundle({ history: [{ date: '2026-08-05', content }] })), 'history/2026-08-05.md')
    expect(file.kind).toBe('history')
    expect(file.content).toBe(content)
  })
})

describe('renderRepoFiles — MEMORY.md rules', () => {
  it('lists one rule per lesson and the count matches', () => {
    const bundle = makeBundle({
      lessons: [
        makeLesson({ lessonKey: 'a', rule: 'Always test' }),
        makeLesson({ lessonKey: 'b', rule: 'Never ship on Friday', negative: true }),
        makeLesson({ lessonKey: 'c', rule: 'Old rule', disabled: true }),
      ],
    })
    const memory = requireFile(render(bundle), 'MEMORY.md').content
    expect(memory).toContain('## Правила (3)')
    const section = memory.split(/## Правила \(\d+\)\n/)[1] ?? ''
    const ruleLines = section.split('\n').filter(l => l.startsWith('- '))
    expect(ruleLines.length).toBe(3)
  })

  it('flags negative and disabled rules', () => {
    const bundle = makeBundle({
      lessons: [
        makeLesson({ lessonKey: 'b', rule: 'Never ship on Friday', negative: true }),
        makeLesson({ lessonKey: 'c', rule: 'Old rule', disabled: true }),
      ],
    })
    const memory = requireFile(render(bundle), 'MEMORY.md').content
    expect(memory).toMatch(/- Never ship on Friday → \[\[lessons\/[^\]]+\]\] \(negative\)/)
    expect(memory).toMatch(/- Old rule → \[\[lessons\/[^\]]+\]\] \(disabled\)/)
  })

  it('embeds the context bytes under ## Контекст', () => {
    const memory = requireFile(render(makeBundle({ context: 'ctx-body' })), 'MEMORY.md').content
    expect(memory).toContain('## Контекст\n\nctx-body')
  })

  it('resolves every wikilink to a rendered lesson path', () => {
    const bundle = makeBundle({
      lessons: [
        makeLesson({ lessonKey: 'a', rule: 'Always test' }),
        makeLesson({ lessonKey: 'b', rule: 'Третье правило', category: 'correction' }),
      ],
    })
    const files = render(bundle)
    const lessonPaths = new Set(files.filter(f => f.kind === 'lesson').map(f => f.path))
    const memory = requireFile(files, 'MEMORY.md').content
    const links = [...memory.matchAll(/\[\[(lessons\/[^\]]+)\]\]/g)].map(m => `${m[1]}.md`)
    expect(links.length).toBe(2)
    for (const link of links) expect(lessonPaths.has(link)).toBe(true)
  })
})

describe('renderRepoFiles — lesson files', () => {
  it('writes the contract frontmatter and rule body', () => {
    const lesson = makeLesson({
      lessonKey: 'always-test',
      rule: 'Always test',
      category: 'workflow',
      negative: true,
      pinned: true,
      tags: ['testing', 'ci'],
      createdAt: '2026-08-05T10:00:00.000Z',
      source: { trigger: 'explicit', sessionId: 'sess-1', proposalId: 'p_44', consent: 'c_9' },
    })
    const bundle = makeBundle({ lessons: [lesson] })
    const files = render(bundle)
    const file = files.find(f => f.kind === 'lesson')!
    expect(file.lessonKey).toBe('always-test')
    expect(file.lessonId).toBe('p:p_44')
    expect(file.ruleHash).toBe(ruleHash('Always test'))

    const fm = parseFrontmatter(file.content)
    expect(file.content.split('\n---\n')[1]).toContain('Always test')
    expect(fm).toEqual({
      id: 'p:p_44',
      scope: 'main',
      category: 'workflow',
      negative: 'true',
      pinned: 'true',
      disabled: 'false',
      tags: 'testing, ci',
      ts: '2026-08-05T10:00:00.000Z',
      'source.trigger': 'explicit',
      'source.session': 'sess-1',
      'source.proposal': 'p_44',
      'source.consent': 'c_9',
      baseHash: ruleHash('Always test'),
    })
  })

  it('omits absent source fields and tags stay empty-safe', () => {
    const file = render(makeBundle({ lessons: [makeLesson({ lessonKey: 'a', rule: 'R' })] })).find(f => f.kind === 'lesson')!
    const fm = parseFrontmatter(file.content)
    expect(fm.tags).toBe('')
    expect(Object.keys(fm).some(k => k.startsWith('source.'))).toBe(false)
  })
})

describe('renderRepoFiles — slug collisions and path safety', () => {
  it('disambiguates identical slugs with distinct --id8 suffixes', () => {
    const bundle = makeBundle({
      lessons: [
        makeLesson({ lessonKey: 'k1', rule: 'a!' }),
        makeLesson({ lessonKey: 'k2', rule: 'a?' }),
      ],
    })
    const paths = render(bundle).filter(f => f.kind === 'lesson').map(f => f.path)
    expect(paths.length).toBe(2)
    expect(new Set(paths).size).toBe(2)
    expect(paths[0]).toMatch(/^lessons\/workflow\/a--[A-Za-z0-9]+\.md$/)
    expect(paths[1]).toMatch(/^lessons\/workflow\/a--[A-Za-z0-9]+\.md$/)
  })

  it('produces Windows-safe paths (no colon)', () => {
    const bundle = makeBundle({
      lessons: [makeLesson({ lessonKey: 'x', rule: 'X', source: { proposalId: 'p_44' } })],
    })
    for (const file of render(bundle)) expect(file.path.includes(':')).toBe(false)
  })
})

describe('renderRepoFiles — no telemetry in repo files', () => {
  it('never writes telemetry field names', () => {
    const bundle = makeBundle({
      lessons: [makeLesson({ lessonKey: 'a', rule: 'Always test', tags: ['x'] })],
      history: [{ date: '2026-08-05', content: 'history body' }],
    })
    for (const file of render(bundle)) {
      expect(file.content).not.toContain('usageCount')
      expect(file.content).not.toContain('lastUsedAt')
      // `conflicts` appears only as the `.conflicts/` directory name (no key colon).
      expect(file.content).not.toMatch(/\bconflicts\s*:/)
    }
  })
})